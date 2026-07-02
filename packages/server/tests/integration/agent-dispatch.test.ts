import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { agentRoutes } from "../../src/http/routes/agent.js";

function makeHandle(savedVersions: any[], opts: { appends?: any[]; usageRecords?: any[] } = {}) {
  return {
    bookId: "b1",
    workspaceDb: { transaction: (fn: () => void) => () => fn() },
    chaptersRepo: {
      saveVersion: (v: any) => {
        const r = { ...v, versionNo: savedVersions.length + 1 };
        savedVersions.push(r);
        return r;
      },
      deleteVersion: () => {},
      listSummaries: () => [],
      saveSummary: () => {},
      saveAudit: () => {},
    },
    chapterFiles: { save: () => {}, list: () => [], read: () => undefined },
    charactersRepo: { list: () => [], create: () => {}, update: () => {} },
    foreshadowingRepo: { list: () => [], create: () => {} },
    timelineRepo: { listAll: () => [], create: () => {} },
    outlineRepo: { listAll: () => [], findChapterNode: () => undefined },
    genreSectionsRepo: { listSections: () => [], listItems: () => [], addItem: () => {} },
    worldbookRepo: { list: () => [] },
    promptPresetsRepo: { listPresets: () => [], listBlocks: () => [] },
    readerIssuesRepo: { listOpen: () => [], create: () => {} },
    bookMetaRepo: { get: () => undefined, set: () => {} },
    conversationsRepo: {
      append: (m: any) => { opts.appends?.push(m); },
      listLatest: () => [],
      listSince: () => [],
      countAll: () => 0,
    },
    tokenUsageRepo: { record: (r: any) => { opts.usageRecords?.push(r); } },
  } as any;
}

function makeRegistry(handle: any, book: any | null = { id: "b1", title: "T", premise: "P" }, costs: any[] = []) {
  return {
    booksRepo: {
      get: () => book ?? undefined,
      addCost: (bookId: string, deltaUsd: number) => { costs.push({ bookId, deltaUsd }); },
    },
    open: () => handle,
    closeBook: () => {},
    acquire: () => handle,
    release: () => {},
    isMutating: () => false,
  } as any;
}

function makeStubModel() {
  return {} as any;
}

describe("POST /api/books/:bookId/agent/run", () => {
  it("write_chapter 场景:发 text_delta 序列 + done committed=true", async () => {
    const savedVersions: any[] = [];
    const handle = makeHandle(savedVersions);
    const registry = makeRegistry(handle);

    const app = new Hono();
    app.route("/", agentRoutes({
      registry,
      getModel: () => makeStubModel(),
      getAuditModel: () => makeStubModel(),
      resolveTask: () => ({
        name: "write-chapter",
        mutates: true,
        stream: async function* () {
          yield { type: "text_delta" as const, delta: "我推开门。".repeat(60) };
        },
        parse: async () => ({
          chapterNo: 5,
          title: "第 5 章",
          content: "我推开门。".repeat(60),
          characters: [],
          foreshadowing: [],
          timeline: [],
        }),
        apply: (ctx: any, p: any) => {
          ctx.handle.chaptersRepo.saveVersion({ chapterNo: p.chapterNo, source: "ai_write", contentMd: p.content });
        },
      }),
    }));

    const res = await app.request("/api/books/b1/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "写第 5 章", source: "editor", target: { chapterNo: 5 } }),
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(`"type":"text_delta"`);
    expect(body).toContain(`"type":"done"`);
    expect(body).toContain(`"committed":true`);
    expect(savedVersions).toHaveLength(1);
  });

  it("task 经 ctx.onUsage 上报用量 → tokenUsageRepo.record + booksRepo.addCost 都被调", async () => {
    const savedVersions: any[] = [];
    const usageRecords: any[] = [];
    const costs: any[] = [];
    const handle = makeHandle(savedVersions, { usageRecords });
    const registry = makeRegistry(handle, { id: "b1", title: "T", premise: "P" }, costs);

    const app = new Hono();
    app.route("/", agentRoutes({
      registry,
      getModel: () => makeStubModel(),
      getAuditModel: () => makeStubModel(),
      writeModelInfo: { id: "test-model", name: "Test", pricing: { input: 1, output: 2, cachedInput: 0.1 } } as any,
      resolveTask: () => ({
        name: "chat",
        mutates: false,
        stream: async function* (ctx: any) {
          ctx.onUsage?.({ promptTokens: 1000, completionTokens: 500, cachedTokens: 200, modelRole: "write" });
          yield { type: "text_delta" as const, delta: "你好。" };
        },
        parse: async (_ctx: any, text: string) => ({ reply: text }),
        apply: () => {},
      }),
    }));

    const res = await app.request("/api/books/b1/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "你好", source: "chat" }),
    });
    expect(res.status).toBe(200);
    await res.text();

    expect(usageRecords).toHaveLength(1);
    expect(usageRecords[0]).toMatchObject({
      taskType: "chat",
      model: "test-model",
      promptTokens: 1000,
      completionTokens: 500,
      cachedTokens: 200,
    });
    expect(usageRecords[0].costUsd).toBeGreaterThan(0);
    expect(costs).toHaveLength(1);
    expect(costs[0]).toMatchObject({ bookId: "b1" });
    expect(costs[0].deltaUsd).toBeCloseTo(usageRecords[0].costUsd);
  });

  it("write-chapter 的对话记录只存进度说明,不存整章正文;chat 存真实回复", async () => {
    const prose = "我推开门。".repeat(60);

    // write-chapter:对话表不应出现整章正文
    {
      const appends: any[] = [];
      const handle = makeHandle([], { appends });
      const registry = makeRegistry(handle);
      const app = new Hono();
      app.route("/", agentRoutes({
        registry,
        getModel: () => makeStubModel(),
        getAuditModel: () => makeStubModel(),
        resolveTask: () => ({
          name: "write-chapter",
          mutates: true,
          stream: async function* () { yield { type: "text_delta" as const, delta: prose }; },
          parse: async () => ({ chapterNo: 5, title: "第 5 章", content: prose, characters: [], foreshadowing: [], timeline: [] }),
          apply: () => {},
        }),
      }));
      const res = await app.request("/api/books/b1/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "写第 5 章", source: "editor", target: { chapterNo: 5 } }),
      });
      await res.text();
      const assistantAppends = appends.filter(m => m.role === "assistant");
      expect(assistantAppends.length).toBeGreaterThan(0);
      for (const m of assistantAppends) {
        expect(m.content).not.toContain(prose);
        expect(m.content.length).toBeLessThan(200);
      }
      expect(assistantAppends.some(m => String(m.content).includes("第 5 章"))).toBe(true);
    }

    // chat:真实回复原样入库
    {
      const appends: any[] = [];
      const handle = makeHandle([], { appends });
      const registry = makeRegistry(handle);
      const app = new Hono();
      app.route("/", agentRoutes({
        registry,
        getModel: () => makeStubModel(),
        getAuditModel: () => makeStubModel(),
        resolveTask: () => ({
          name: "chat",
          mutates: false,
          stream: async function* () { yield { type: "text_delta" as const, delta: "这本书的主角是林尘。" }; },
          parse: async (_ctx: any, text: string) => ({ reply: text }),
          apply: () => {},
        }),
      }));
      const res = await app.request("/api/books/b1/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "主角是谁", source: "chat" }),
      });
      const body = await res.text();
      expect(body).toContain(`"committed":false`);
      const assistantAppends = appends.filter(m => m.role === "assistant");
      expect(assistantAppends.some(m => String(m.content).includes("林尘"))).toBe(true);
    }
  });

  it("stream 抛错 → 发 error,不 apply", async () => {
    const savedVersions: any[] = [];
    const handle = makeHandle(savedVersions);
    const registry = makeRegistry(handle);
    const applySpy = vi.fn();

    const app = new Hono();
    app.route("/", agentRoutes({
      registry,
      getModel: () => makeStubModel(),
      getAuditModel: () => makeStubModel(),
      resolveTask: () => ({
        name: "x",
        mutates: true,
        stream: async function* () {
          throw new Error("bad model");
        },
        parse: async () => ({}),
        apply: applySpy,
      }),
    }));

    const res = await app.request("/api/books/b1/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "x", source: "chat" }),
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(`"errorClass":"stream_failed"`);
    expect(applySpy).not.toHaveBeenCalled();
  });

  it("请求体不合法 → 400 bad_request", async () => {
    const savedVersions: any[] = [];
    const handle = makeHandle(savedVersions);
    const registry = makeRegistry(handle);

    const app = new Hono();
    app.route("/", agentRoutes({
      registry,
      getModel: () => makeStubModel(),
      getAuditModel: () => makeStubModel(),
    }));

    const res = await app.request("/api/books/b1/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("bad_request");
  });

  it("book 不存在 → 404", async () => {
    const savedVersions: any[] = [];
    const handle = makeHandle(savedVersions);
    const registry = makeRegistry(handle, null);

    const app = new Hono();
    app.route("/", agentRoutes({
      registry,
      getModel: () => makeStubModel(),
      getAuditModel: () => makeStubModel(),
    }));

    const res = await app.request("/api/books/b1/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "x", source: "chat" }),
    });
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("book_not_found");
  });
});
