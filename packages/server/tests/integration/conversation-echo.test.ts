import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createBookRegistry } from "../../src/http/book-registry.js";
import { createApp } from "../../src/http/server.js";

let tmp: string;
let registry: ReturnType<typeof createBookRegistry>;

function makePaths(root: string) {
  return {
    appRoot: root,
    libraryDb: path.posix.join(root, "library.db"),
    booksDir: path.posix.join(root, "books"),
    backupsDir: path.posix.join(root, "backups"),
    secretsEnv: path.posix.join(root, "secrets.env"),
    configJson: path.posix.join(root, "config.json"),
    bookDir: (id: string) => path.posix.join(root, "books", id),
    workspaceDb: (id: string) => path.posix.join(root, "books", id, "workspace.db"),
    chaptersDir: (id: string) => path.posix.join(root, "books", id, "chapters"),
    rulesMd: (id: string) => path.posix.join(root, "books", id, "rules.md"),
    exportsDir: (id: string) => path.posix.join(root, "books", id, "exports"),
    bookBackupsDir: (id: string) => path.posix.join(root, "backups", id),
  };
}

/** 聊天用 stub:流式吐一小段中文回复。 */
function makeStubModel() {
  return {
    specificationVersion: "v1" as const,
    provider: "stub",
    modelId: "stub-model",
    async doGenerate() {
      return {
        text: "ok",
        finishReason: "stop",
        usage: { promptTokens: 10, completionTokens: 5 },
        rawCall: { rawPrompt: null, rawSettings: {} },
      };
    },
    async doStream() {
      return {
        stream: new ReadableStream({
          start(ctrl) {
            ctrl.enqueue({ type: "text-delta", textDelta: "好的，" });
            ctrl.enqueue({ type: "text-delta", textDelta: "我们继续。" });
            ctrl.enqueue({ type: "finish", finishReason: "stop", usage: { promptTokens: 10, completionTokens: 5 } });
            ctrl.close();
          },
        }),
        rawCall: { rawPrompt: null, rawSettings: {} },
      };
    },
  };
}

const PROSE = "我推开门，冷风扑面而来。远处的山脊在暮色里起伏，像一头沉睡的兽。".repeat(20);

/** 写作用 stub:流式吐 ≥500 字正文(write-chapter 任务的 MIN_DRAFT_CHARS 门槛)。 */
function makeWritingModel(capture?: { prompts: unknown[] }) {
  return {
    ...makeStubModel(),
    async doStream(options: unknown) {
      capture?.prompts.push(options);
      return {
        stream: new ReadableStream({
          start(ctrl) {
            ctrl.enqueue({ type: "text-delta", textDelta: PROSE });
            ctrl.enqueue({ type: "finish", finishReason: "stop", usage: { promptTokens: 100, completionTokens: 800 } });
            ctrl.close();
          },
        }),
        rawCall: { rawPrompt: null, rawSettings: {} },
      };
    },
  };
}

/** 抽取用 stub:generateLlmText 返回结构化 JSON(角色/伏笔/时间线)。 */
function makeExtractionModel() {
  return {
    ...makeStubModel(),
    async doGenerate() {
      return {
        text: JSON.stringify({
          characters: [{ name: "林尘", role: "protagonist", baseData: {}, currentState: { location: "山脊" } }],
          foreshadowing: [{ label: "沉睡的兽", description: "山脊的隐喻", plantedChapter: 1, status: "planted", relatedCharacters: ["林尘"] }],
          timeline: [{ chapterNo: 1, storyTime: "暮色", event: "推门远眺", participants: ["林尘"] }],
        }),
        finishReason: "stop",
        usage: { promptTokens: 50, completionTokens: 100 },
        rawCall: { rawPrompt: null, rawSettings: {} },
      };
    },
  };
}

async function readSseText(res: Response): Promise<string> {
  return new Response(res.body).text();
}

async function createBook(app: ReturnType<typeof createApp>): Promise<string> {
  const res = await app.request("/api/books", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Conversation workflow test" }),
  });
  expect(res.status).toBe(201);
  return (await res.json() as { id: string }).id;
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scribe-conversation-"));
  const paths = makePaths(tmp);
  fs.mkdirSync(paths.booksDir, { recursive: true });
  registry = createBookRegistry({ paths });
});

afterEach(() => {
  registry.closeAll();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("conversation and agent routes", () => {
  it("legacy conversation POST is gone entirely (404, no stub left)", async () => {
    const app = createApp({
      bookRegistry: registry,
      getModel: () => makeStubModel() as never,
      getAuditModel: () => makeStubModel() as never,
    });
    const bookId = await createBook(app);

    const res = await app.request(`/api/books/${bookId}/conversation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "hello" }),
    });

    expect(res.status).toBe(404);
  });

  it("streams chat through agent/run with the 4-event schema and persists the real reply", async () => {
    const app = createApp({
      bookRegistry: registry,
      getModel: () => makeStubModel() as never,
      getAuditModel: () => makeStubModel() as never,
    });
    const bookId = await createBook(app);

    const res = await app.request(`/api/books/${bookId}/agent/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "hello", source: "chat" }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    const text = await readSseText(res);
    expect(text).toContain("event: text_delta");
    expect(text).toContain("event: done");
    // chat 无副作用:committed 必须如实为 false
    expect(text).toContain('"committed":false');
    expect(text).not.toContain("event: agent_phase");
    expect(text).not.toContain("event: agent_progress");
    expect(text).not.toContain("event: main_output");
    expect(text).not.toContain("event: validation_report");
    expect(text).not.toContain("event: tool_call_start");

    // 助手真实回复入库(不再是固定占位串)
    const history = await app.request(`/api/books/${bookId}/conversation`);
    const body = await history.json() as { messages: Array<{ role: string; content: string }> };
    expect(body.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "user", content: "hello" }),
      expect.objectContaining({ role: "assistant", content: "好的，我们继续。" }),
    ]));
  });

  it("returns 503 from agent/run when no model is configured", async () => {
    const app = createApp({ bookRegistry: registry });
    const bookId = await createBook(app);

    const res = await app.request(`/api/books/${bookId}/agent/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "hello", source: "chat" }),
    });

    expect(res.status).toBe(503);
  });

  it("returns 400 from agent/run for an empty message", async () => {
    const app = createApp({ bookRegistry: registry, getModel: () => makeStubModel() as never });
    const bookId = await createBook(app);

    const res = await app.request(`/api/books/${bookId}/agent/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });

  it("writes a chapter end-to-end: streamed prose commits, state extracted, conversation keeps a short note", async () => {
    const capture = { prompts: [] as unknown[] };
    const app = createApp({
      bookRegistry: registry,
      getModel: () => makeWritingModel(capture) as never,
      getAuditModel: () => makeExtractionModel() as never,
      getMasterPrompt: () => "永远保持第一人称视角。",
    });
    const bookId = await createBook(app);

    const runRes = await app.request(`/api/books/${bookId}/agent/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "write chapter 1",
        source: "editor",
        target: { chapterNo: 1 },
      }),
    });
    expect(runRes.status).toBe(200);
    const text = await readSseText(runRes);
    expect(text).toContain("event: text_delta");
    expect(text).toContain('"committed":true');
    // staging/approve 概念不存在
    expect(text).not.toContain("needsUserDecision");
    expect(text).not.toContain("runId");

    // 章节已直接落库
    const chapter = await app.request(`/api/books/${bookId}/chapters/1`);
    expect(chapter.status).toBe(200);
    await expect(chapter.json()).resolves.toMatchObject({
      chapterNo: 1,
      content: expect.stringContaining("我推开门"),
    });

    // 最深处提示词(全局 master prompt)必须到达写作模型的消息里
    expect(capture.prompts.length).toBeGreaterThan(0);
    expect(JSON.stringify(capture.prompts[0])).toContain("永远保持第一人称视角。");

    // 抽取结果落库:角色/伏笔/时间线
    const handle = registry.open(bookId);
    expect(handle.charactersRepo.list().map((c) => c.name)).toContain("林尘");
    expect(handle.foreshadowingRepo.list().map((f) => f.label)).toContain("沉睡的兽");
    expect(handle.timelineRepo.listAll().map((t) => t.event)).toContain("推门远眺");

    // token 用量被记录(写作 + 抽取两笔)
    expect(handle.tokenUsageRepo.listRecent(10).length).toBeGreaterThanOrEqual(2);

    // 对话表只留简短进度说明,不重复整章正文
    const history = await app.request(`/api/books/${bookId}/conversation`);
    const body = await history.json() as { messages: Array<{ role: string; content: string }> };
    const assistant = body.messages.filter((m) => m.role === "assistant");
    expect(assistant.length).toBeGreaterThan(0);
    for (const m of assistant) {
      expect(m.content).not.toContain("我推开门，冷风扑面而来");
      expect(m.content.length).toBeLessThan(200);
    }
  });
});
