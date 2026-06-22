import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createApp } from "../../src/http/server.js";
import { createBookRegistry } from "../../src/http/book-registry.js";
import { runChat } from "../../src/ai/orchestrator/chat.js";

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

function makeStubModel(chunks: string[]): any {
  return {
    specificationVersion: "v1",
    provider: "stub",
    modelId: "stub",
    async doGenerate() {
      // classifyIntent 走 generateText:返回 chitchat,使消息进入普通对话分支
      return {
        text: "chitchat",
        finishReason: "stop",
        usage: { promptTokens: 1, completionTokens: 1 },
        rawCall: { rawPrompt: null, rawSettings: {} },
      };
    },
    async doStream() {
      return {
        stream: new ReadableStream({
          start(ctrl) {
            for (const ch of chunks) ctrl.enqueue({ type: "text-delta", textDelta: ch });
            ctrl.enqueue({
              type: "finish",
              finishReason: "stop",
              usage: { promptTokens: 5, completionTokens: chunks.length },
            });
            ctrl.close();
          },
        }),
        rawCall: { rawPrompt: null, rawSettings: {} },
      };
    },
  };
}

async function collect(stream: AsyncIterable<any>): Promise<any[]> {
  const out: any[] = [];
  for await (const ev of stream) out.push(ev);
  return out;
}

describe("runChat 流式", () => {
  it("拼接 text-delta 输出 + usage + done", async () => {
    const evs = await collect(
      runChat({
        model: makeStubModel(["黎", "明", "时,雾气", "浸透山道"]),
        message: "测试",
      }),
    );
    const deltas = evs
      .filter((e) => e.type === "text_delta")
      .map((e) => e.delta)
      .join("");
    expect(deltas).toBe("黎明时,雾气浸透山道");
    expect(evs.at(-1)?.type).toBe("done");
    expect(evs.find((e) => e.type === "usage")?.completionTokens).toBe(4);
  });

  it("HTTP /conversation?mode=chat + model 注入,SSE 输出真实文本", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scribe-chat-"));
    const paths = makePaths(tmp);
    fs.mkdirSync(paths.booksDir, { recursive: true });
    const registry = createBookRegistry({ paths });
    const app = createApp({ getModel: () => makeStubModel(["你", "好"]), bookRegistry: registry });
    const res = await app.request("/api/books/b1/conversation?mode=chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "在吗" }),
    });
    const text = await new Response(res.body).text();
    expect(text).toContain("event: text_delta");
    expect(text).toContain('"delta":"你"');
    expect(text).toContain('"delta":"好"');
    expect(text).toContain("event: usage");
    expect(text).toContain("event: done");
    expect(text).not.toContain("[echo]");
    registry.closeAll();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("对话流把 LLM 用量与成本落库(修复前 /write 路径恒为 $0)", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scribe-cost-"));
    const paths = makePaths(tmp);
    fs.mkdirSync(paths.booksDir, { recursive: true });
    const registry = createBookRegistry({ paths });
    const app = createApp({
      getModel: () => makeStubModel(["写", "完"]),
      bookRegistry: registry,
      writeModelInfo: { id: "claude-sonnet-4-6", pricing: { input: 3, output: 15, cachedInput: 0.3 } } as any,
    });
    const created = await app.request("/api/books", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "计费测试" }),
    });
    const book = await created.json() as { id: string };

    await new Response((await app.request(`/api/books/${book.id}/conversation?mode=chat`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "在吗" }),
    })).body).text();

    const handle = registry.open(book.id);
    const records = handle.tokenUsageRepo.listRecent(10);
    expect(records.length).toBeGreaterThan(0);
    expect(records[0]!.model).toBe("claude-sonnet-4-6");
    expect(handle.tokenUsageRepo.totalCost()).toBeGreaterThan(0);

    registry.closeAll();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("accepts executionMode and emits workflow_mode over SSE", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scribe-chat-"));
    const paths = makePaths(tmp);
    fs.mkdirSync(paths.booksDir, { recursive: true });
    const registry = createBookRegistry({ paths });
    const app = createApp({ getModel: () => makeStubModel(["ok"]), bookRegistry: registry });

    const res = await app.request("/api/books/b1/conversation?mode=chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "hello", executionMode: "plan_only" }),
    });
    const text = await new Response(res.body).text();

    expect(res.status).toBe(200);
    expect(text).toContain("event: workflow_mode");
    expect(text).toContain('"mode":"plan_only"');

    registry.closeAll();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("conversation history is isolated per book", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scribe-chat-"));
    const paths = makePaths(tmp);
    fs.mkdirSync(paths.booksDir, { recursive: true });
    const registry = createBookRegistry({ paths });
    const app = createApp({ getModel: () => makeStubModel(["回", "答"]), bookRegistry: registry });

    await app.request("/api/books/book-a/conversation?mode=chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "A 的问题" }),
    });

    const emptyB = await app.request("/api/books/book-b/conversation?limit=100");
    expect((await emptyB.json() as { messages: unknown[] }).messages).toEqual([]);

    await app.request("/api/books/book-b/conversation?mode=chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "B 的问题" }),
    });

    const historyA = await app.request("/api/books/book-a/conversation?limit=100");
    const historyB = await app.request("/api/books/book-b/conversation?limit=100");
    const messagesA = (await historyA.json() as { messages: Array<{ content: string }> }).messages;
    const messagesB = (await historyB.json() as { messages: Array<{ content: string }> }).messages;

    expect(messagesA.map((message) => message.content)).toContain("A 的问题");
    expect(messagesA.map((message) => message.content)).not.toContain("B 的问题");
    expect(messagesB.map((message) => message.content)).toContain("B 的问题");
    expect(messagesB.map((message) => message.content)).not.toContain("A 的问题");

    registry.closeAll();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("无 model 注入或 mode=echo 时走回声", async () => {
    const app = createApp();
    const res = await app.request("/api/books/b1/conversation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "你好" }),
    });
    const text = await new Response(res.body).text();
    expect(text).toContain("[echo]");
  });
});
