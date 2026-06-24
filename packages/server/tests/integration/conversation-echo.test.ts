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

function makeStubModel() {
  return {
    specificationVersion: "v1" as const,
    provider: "stub",
    modelId: "stub-model",
    async doGenerate() {
      return {
        text: JSON.stringify({ intent: "query_only", reply: "ok" }),
        finishReason: "stop",
        usage: { promptTokens: 10, completionTokens: 5 },
        rawCall: { rawPrompt: null, rawSettings: {} },
      };
    },
    async doStream() {
      return {
        stream: new ReadableStream({
          start(ctrl) {
            ctrl.enqueue({ type: "finish", finishReason: "stop", usage: { promptTokens: 10, completionTokens: 5 } });
            ctrl.close();
          },
        }),
        rawCall: { rawPrompt: null, rawSettings: {} },
      };
    },
  };
}

function makeWritingModel() {
  return {
    ...makeStubModel(),
    async doGenerate() {
      return {
        text: JSON.stringify({
          intent: "write_chapter",
          reply: "prepared",
          draft: "This approved chapter body is long enough to pass validation. ".repeat(4),
          targetChapterNo: 1,
          chapterTitle: "Chapter 1",
        }),
        finishReason: "stop",
        usage: { promptTokens: 10, completionTokens: 5 },
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
  it("rejects legacy conversation POST execution", async () => {
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

    expect(res.status).toBe(410);
    await expect(res.json()).resolves.toMatchObject({ error: "legacy_conversation_post_removed" });
  });

  it("streams unified agent workflow events through agent/run", async () => {
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
    expect(text).toContain("event: agent_phase");
    expect(text).toContain("event: agent_progress");
    expect(text).toContain("event: main_output");
    expect(text).toContain("event: validation_report");
    expect(text).toContain("event: done");
    expect(text).not.toContain("event: text_delta");
    expect(text).not.toContain("event: tool_call_start");
    expect(text).not.toContain("event: execution_plan");
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

  it("approves a paused low-risk write run without rerunning the prompt", async () => {
    const app = createApp({
      bookRegistry: registry,
      getModel: () => makeWritingModel() as never,
      getAuditModel: () => makeWritingModel() as never,
    });
    const bookId = await createBook(app);

    const runRes = await app.request(`/api/books/${bookId}/agent/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "write chapter 1",
        source: "chat",
        executionMode: "low_risk_auto",
        target: { chapterNo: 1 },
      }),
    });
    expect(runRes.status).toBe(200);
    const text = await readSseText(runRes);
    const runId = /"runId":"([^"]+)"/.exec(text)?.[1];
    expect(runId).toBeTruthy();
    expect(text).toContain("\"needsUserDecision\":true");

    const approve = await app.request(`/api/books/${bookId}/agent/runs/${runId}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(approve.status).toBe(200);

    const chapter = await app.request(`/api/books/${bookId}/chapters/1`);
    expect(chapter.status).toBe(200);
    await expect(chapter.json()).resolves.toMatchObject({
      chapterNo: 1,
      content: expect.stringContaining("approved chapter body"),
    });
  });
});
