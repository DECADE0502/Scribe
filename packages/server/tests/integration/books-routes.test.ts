import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createBookRegistry } from "../../src/http/book-registry.js";
import { createApp } from "../../src/http/server.js";

interface BookCreated { id: string; title: string; genre: string | null; createdAt: number }
interface BookList { books: Array<{ id: string; title: string }> }
interface OnboardStatus { ok: boolean; missing: string[] }
interface SkipResp { skipped: boolean }
const json = <T>(res: Response): Promise<T> => res.json() as Promise<T>;

let tmp: string;
let registry: ReturnType<typeof createBookRegistry>;
let app: ReturnType<typeof createApp>;

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

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scribe-routes-"));
  const paths = makePaths(tmp);
  fs.mkdirSync(paths.booksDir, { recursive: true });
  registry = createBookRegistry({ paths });
  app = createApp({ bookRegistry: registry });
});

afterEach(() => {
  registry.closeAll();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("POST /api/books", () => {
  it("happy:创建空书,返回 id + 201", async () => {
    const res = await app.request("/api/books", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "测试书" }),
    });
    expect(res.status).toBe(201);
    const j = await json<BookCreated>(res);
    expect(j.id).toBeTruthy();
    expect(j.title).toBe("测试书");
  });

  it("body 缺 title 时使用默认值'未命名作品'", async () => {
    const res = await app.request("/api/books", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(201);
    const j = await json<BookCreated>(res);
    expect(j.title).toBe("未命名作品");
  });

  it("创建后 workspace.db + 章节目录被建好", async () => {
    const res = await app.request("/api/books", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "x" }),
    });
    const { id } = await json<BookCreated>(res);
    expect(fs.existsSync(path.posix.join(tmp, "books", id, "workspace.db"))).toBe(true);
    expect(fs.existsSync(path.posix.join(tmp, "books", id, "chapters"))).toBe(true);
  });
});

describe("GET /api/books", () => {
  it("空书架返回空数组", async () => {
    const res = await app.request("/api/books");
    expect(res.status).toBe(200);
    const j = await json<BookList>(res);
    expect(j.books).toEqual([]);
  });

  it("有书后能列出", async () => {
    await app.request("/api/books", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "A" }),
    });
    await app.request("/api/books", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "B" }),
    });
    const res = await app.request("/api/books");
    const j = await json<BookList>(res);
    expect(j.books).toHaveLength(2);
    expect(j.books.map((b) => b.title).sort()).toEqual(["A", "B"]);
  });
});

describe("GET /api/books/:bookId/onboard-status", () => {
  it("新书:全空 missing 4 项", async () => {
    const create = await app.request("/api/books", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "x" }),
    });
    const { id } = await json<BookCreated>(create);
    const res = await app.request(`/api/books/${id}/onboard-status`);
    expect(res.status).toBe(200);
    const j = await json<OnboardStatus>(res);
    expect(j.ok).toBe(false);
    expect(j.missing).toContain("题材");
    expect(j.missing).toContain("主角");
    expect(j.missing).toContain("一级大纲");
  });

  it("书不存在返回 404", async () => {
    const res = await app.request("/api/books/ghost-id/onboard-status");
    expect(res.status).toBe(404);
  });
});

describe("POST /api/books/:bookId/onboard/skip", () => {
  it("happy:返回 skipped=true,workspace 已建", async () => {
    const create = await app.request("/api/books", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "x" }),
    });
    const { id } = await json<BookCreated>(create);
    const res = await app.request(`/api/books/${id}/onboard/skip`, { method: "POST" });
    expect(res.status).toBe(200);
    const j = await json<SkipResp>(res);
    expect(j.skipped).toBe(true);
  });

  it("书不存在返回 404", async () => {
    const res = await app.request("/api/books/no-id/onboard/skip", { method: "POST" });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/books/:bookId/onboard", () => {
  it("空 message 返回 400", async () => {
    const create = await app.request("/api/books", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "x" }),
    });
    const { id } = await json<BookCreated>(create);
    const res = await app.request(`/api/books/${id}/onboard`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("无 model 注入返回 503", async () => {
    const create = await app.request("/api/books", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "x" }),
    });
    const { id } = await json<BookCreated>(create);
    const res = await app.request(`/api/books/${id}/onboard`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "你好" }),
    });
    expect(res.status).toBe(503);
  });

  it("书不存在返回 404", async () => {
    const res = await app.request("/api/books/no-id/onboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "x" }),
    });
    expect(res.status).toBe(404);
  });

  it("注入 stub model + 真实 toolDeps:SSE 流通,DB 落到 SQLite", async () => {
    let turn = 0;
    const stubModel = {
      specificationVersion: "v1" as const,
      provider: "stub",
      modelId: "stub",
      async doGenerate() { throw new Error("not used"); },
      async doStream() {
        const t = turn++;
        return {
          stream: new ReadableStream({
            start(ctrl) {
              if (t === 0) {
                ctrl.enqueue({
                  type: "tool-call",
                  toolCallType: "function",
                  toolCallId: "tc1",
                  toolName: "set_book_meta",
                  args: JSON.stringify({ genre: "仙侠" }),
                });
                ctrl.enqueue({ type: "finish", finishReason: "tool-calls", usage: { promptTokens: 10, completionTokens: 5 } });
              } else {
                ctrl.enqueue({ type: "text-delta", textDelta: "题材是仙侠,主角叫什么?" });
                ctrl.enqueue({ type: "finish", finishReason: "stop", usage: { promptTokens: 30, completionTokens: 10 } });
              }
              ctrl.close();
            },
          }),
          rawCall: { rawPrompt: null, rawSettings: {} },
        };
      },
    };
    const appWithModel = createApp({ bookRegistry: registry, getModel: () => stubModel as never });
    const create = await appWithModel.request("/api/books", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "x" }),
    });
    const { id } = await json<BookCreated>(create);
    const res = await appWithModel.request(`/api/books/${id}/onboard`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "我想写仙侠" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    const text = await new Response(res.body).text();
    expect(text).toContain("event: tool_call_start");
    expect(text).toContain("event: text_delta");
    expect(text).toContain("event: done");
    expect(text).toContain("题材是仙侠");
    const handle = registry.open(id);
    expect(handle.bookMetaRepo.get("genre")).toBe("仙侠");
  });
});
