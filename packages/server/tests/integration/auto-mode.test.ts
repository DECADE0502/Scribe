import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createBookRegistry } from "../../src/http/book-registry.js";
import { createApp } from "../../src/http/server.js";
import { estimateAutoModeCost, checkAutoModeBudget } from "../../src/ai/budget-check.js";
import type { ModelInfo } from "@scribe/shared";

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

const dsPro: ModelInfo = { id: "ds-pro", pricing: { input: 0.27, output: 1.1 } };
const dsFlash: ModelInfo = { id: "ds-flash", pricing: { input: 0.07, output: 0.28 } };

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
            ctrl.enqueue({ type: "text-delta", textDelta: "好的，我们继续。" });
            ctrl.enqueue({ type: "finish", finishReason: "stop", usage: { promptTokens: 10, completionTokens: 5 } });
            ctrl.close();
          },
        }),
        rawCall: { rawPrompt: null, rawSettings: {} },
      };
    },
  };
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scribe-auto-"));
  const paths = makePaths(tmp);
  fs.mkdirSync(paths.booksDir, { recursive: true });
  registry = createBookRegistry({ paths });
});

afterEach(() => {
  registry.closeAll();
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function createBook(app: ReturnType<typeof createApp>): Promise<string> {
  const res = await app.request("/api/books", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Auto workflow test" }),
  });
  return (await res.json() as { id: string }).id;
}

async function readSseText(res: Response): Promise<string> {
  return new Response(res.body).text();
}

describe("budget-check", () => {
  it("estimates multi-chapter cost from default values when history is unavailable", () => {
    const est = estimateAutoModeCost(2, dsPro, dsFlash);
    expect(est.basis).toBe("default");
    expect(est.estimatedUsd).toBeGreaterThan(0);
    expect(est.estimatedUsd).toBeCloseTo(est.perChapterUsd * 2, 10);
  });

  it("rejects over-budget runs", () => {
    const result = checkAutoModeBudget(1000, 0.01, dsPro, dsFlash);
    expect(result.ok).toBe(false);
  });

  it("uses recent write averages when available", () => {
    const est = estimateAutoModeCost(1, dsPro, dsFlash, {
      recentWriteAverage: () => ({ promptTokens: 100, completionTokens: 100 }),
    });
    expect(est.basis).toBe("history");
  });
});

describe("unified auto agent entry", () => {
  function makeApp() {
    return createApp({
      bookRegistry: registry,
      getModel: () => makeStubModel() as never,
      getAuditModel: () => makeStubModel() as never,
      budgetLimitUsd: 100,
      writeModelInfo: dsPro,
      auditModelInfo: dsFlash,
    });
  }

  it("runs auto requests through /agent/run with the 4-event stream", async () => {
    const app = makeApp();
    const id = await createBook(app);

    const res = await app.request(`/api/books/${id}/agent/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "连续写 3 章",
        source: "auto",
        target: { chapterCount: 3, defaultChapterLength: "short" },
      }),
    });

    expect(res.status).toBe(200);
    const text = await readSseText(res);
    expect(text).toContain("event: text_delta");
    expect(text).toContain("event: done");
    // 4-agent 时代的事件全部消失
    expect(text).not.toContain("event: agent_phase");
    expect(text).not.toContain("event: main_output");
    expect(text).not.toContain("event: agent_progress");
    expect(text).not.toContain("event: validation_report");
    expect(text).not.toContain("event: auto_status");
    expect(text).not.toContain("event: execution_plan");
    expect(text).not.toContain("event: tool_call_start");
    expect(text).not.toContain("event: tool_call_end");
  });

  it("rejects blank /agent/run messages", async () => {
    const app = makeApp();
    const id = await createBook(app);

    const res = await app.request(`/api/books/${id}/agent/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "   \n\t  ",
        source: "chat",
      }),
    });

    expect(res.status).toBe(400);
  });

  it("persists /agent/run visible chat by book without storing hidden drafts", async () => {
    const app = makeApp();
    const id = await createBook(app);

    const res = await app.request(`/api/books/${id}/agent/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "先讨论一下第一人称。",
        source: "chat",
      }),
    });

    expect(res.status).toBe(200);
    await readSseText(res);

    const history = await app.request(`/api/books/${id}/conversation`);
    expect(history.status).toBe(200);
    const body = await history.json() as { messages: Array<{ role: string; content: string }> };
    expect(body.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "user", content: "先讨论一下第一人称。" }),
      expect.objectContaining({ role: "assistant", content: expect.any(String) }),
    ]));
    expect(body.messages.map((m) => m.content).join("\n")).not.toContain("hidden draft");
  });

  it("legacy /auto endpoints are gone entirely (404, no stub left)", async () => {
    const app = makeApp();
    const id = await createBook(app);

    const auto = await app.request(`/api/books/${id}/auto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ n: 2 }),
    });
    expect(auto.status).toBe(404);

    const cancel = await app.request(`/api/books/${id}/auto/cancel`, { method: "POST" });
    expect(cancel.status).toBe(404);
  });
});

describe("version routes", () => {
  it("lists versions in descending order and restore-version creates a user_edit version", async () => {
    const app = createApp({ bookRegistry: registry });
    const id = await createBook(app);

    await app.request(`/api/books/${id}/chapters/1`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "v1 content", title: "Chapter 1" }),
    });
    await app.request(`/api/books/${id}/chapters/1`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "v2 content" }),
    });

    const list = await app.request(`/api/books/${id}/chapters/1/versions`);
    const j = await list.json() as { versions: Array<{ versionNo: number; source: string }> };
    expect(j.versions.map(v => v.versionNo)).toEqual([2, 1]);

    const restore = await app.request(`/api/books/${id}/chapters/1/restore-version`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionNo: 1 }),
    });
    expect(restore.status).toBe(200);
    const restored = await restore.json() as { versionNo: number; restoredFrom: number };
    expect(restored.versionNo).toBe(3);
    expect(restored.restoredFrom).toBe(1);
    const handle = registry.open(id);
    expect(handle.chapterFiles.read(1)?.content).toContain("v1 content");
    expect(handle.chaptersRepo.listVersions(1)).toHaveLength(3);
  });

  it("returns 404 when restoring an unknown version", async () => {
    const app = createApp({ bookRegistry: registry });
    const id = await createBook(app);
    const res = await app.request(`/api/books/${id}/chapters/1/restore-version`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionNo: 99 }),
    });
    expect(res.status).toBe(404);
  });
});

describe("usage and settings routes", () => {
  it("aggregates usage summary", async () => {
    const app = createApp({ bookRegistry: registry });
    const id = await createBook(app);
    const handle = registry.open(id);
    handle.tokenUsageRepo.record({
      taskType: "write", model: "ds-pro", promptTokens: 100, completionTokens: 200,
      cachedTokens: 0, reasoningTokens: 0, costUsd: 0.5, chapterNo: 1,
    });
    handle.tokenUsageRepo.record({
      taskType: "audit", model: "ds-flash", promptTokens: 50, completionTokens: 20,
      cachedTokens: 0, reasoningTokens: 0, costUsd: 0.1, chapterNo: 1,
    });

    const res = await app.request(`/api/books/${id}/usage/summary`);
    const j = await res.json() as {
      totalUsd: number;
      byTaskType: Array<{ taskType: string; costUsd: number }>;
      byModel: Array<{ model: string }>;
      byChapter: Array<{ chapterNo: number | null; costUsd: number }>;
    };

    expect(j.totalUsd).toBeCloseTo(0.6, 5);
    expect(j.byTaskType).toHaveLength(2);
    expect(j.byModel.map(m => m.model).sort()).toEqual(["ds-flash", "ds-pro"]);
    expect(j.byChapter[0]!.costUsd).toBeCloseTo(0.6, 5);
  });

  it("lists recent usage records", async () => {
    const app = createApp({ bookRegistry: registry });
    const id = await createBook(app);
    const handle = registry.open(id);
    handle.tokenUsageRepo.record({
      taskType: "chat", model: "ds-pro", promptTokens: 10, completionTokens: 5,
      cachedTokens: 0, reasoningTokens: 0, costUsd: 0.01, chapterNo: null,
    });

    const res = await app.request(`/api/books/${id}/usage/recent?limit=10`);
    const j = await res.json() as { records: Array<{ taskType: string }> };
    expect(j.records).toHaveLength(1);
    expect(j.records[0]!.taskType).toBe("chat");
  });

  it("reads and writes the budget setting", async () => {
    const configPath = path.posix.join(tmp, "config.json");
    const app = createApp({ bookRegistry: registry, configJsonPath: configPath });
    const get1 = await app.request("/api/settings");
    expect((await get1.json() as { singleBudgetUsd: number }).singleBudgetUsd).toBe(5);

    const put = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ singleBudgetUsd: 10 }),
    });
    expect((await put.json() as { singleBudgetUsd: number }).singleBudgetUsd).toBe(10);

    const get2 = await app.request("/api/settings");
    expect((await get2.json() as { singleBudgetUsd: number }).singleBudgetUsd).toBe(10);
  });
});
