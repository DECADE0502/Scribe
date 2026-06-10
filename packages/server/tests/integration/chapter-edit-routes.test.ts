import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createBookRegistry } from "../../src/http/book-registry.js";
import { createApp } from "../../src/http/server.js";

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

async function createBook(): Promise<string> {
  const res = await app.request("/api/books", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "编辑测试" }),
  });
  const j = await res.json() as { id: string };
  return j.id;
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scribe-edit-"));
  const paths = makePaths(tmp);
  fs.mkdirSync(paths.booksDir, { recursive: true });
  registry = createBookRegistry({ paths });
  app = createApp({ bookRegistry: registry });
});

afterEach(() => {
  registry.closeAll();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("PUT /api/books/:bookId/chapters/:no", () => {
  it("happy:保存 user_edit version + .md 落地", async () => {
    const id = await createBook();
    const res = await app.request(`/api/books/${id}/chapters/1`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "用户手写的正文", title: "第一章 初见" }),
    });
    expect(res.status).toBe(200);
    const j = await res.json() as { versionNo: number };
    expect(j.versionNo).toBe(1);

    const handle = registry.open(id);
    const versions = handle.chaptersRepo.listVersions(1);
    expect(versions).toHaveLength(1);
    expect(versions[0]!.source).toBe("user_edit");
    const file = handle.chapterFiles.read(1);
    expect(file?.content).toContain("用户手写的正文");
    expect(file?.title).toBe("第一章 初见");
  });

  it("二次保存版本递增,title 不传则保留", async () => {
    const id = await createBook();
    await app.request(`/api/books/${id}/chapters/1`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "v1", title: "标题" }),
    });
    const res = await app.request(`/api/books/${id}/chapters/1`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "v2" }),
    });
    const j = await res.json() as { versionNo: number };
    expect(j.versionNo).toBe(2);
    const handle = registry.open(id);
    const file = handle.chapterFiles.read(1);
    expect(file?.content).toContain("v2");
    expect(file?.title).toBe("标题");
  });

  it("空 content 返回 400", async () => {
    const id = await createBook();
    const res = await app.request(`/api/books/${id}/chapters/1`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "  " }),
    });
    expect(res.status).toBe(400);
  });

  it("书不存在返回 404", async () => {
    const res = await app.request("/api/books/ghost/chapters/1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "x" }),
    });
    expect(res.status).toBe(404);
  });

  it("章节号非法返回 400", async () => {
    const id = await createBook();
    const res = await app.request(`/api/books/${id}/chapters/abc`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "x" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/books/:bookId/chapters/:no 与列表", () => {
  it("读回已保存章节", async () => {
    const id = await createBook();
    await app.request(`/api/books/${id}/chapters/2`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "第二章内容", title: "第二章" }),
    });
    const res = await app.request(`/api/books/${id}/chapters/2`);
    expect(res.status).toBe(200);
    const j = await res.json() as { title: string; content: string };
    expect(j.title).toBe("第二章");
    expect(j.content).toContain("第二章内容");
  });

  it("不存在章节返回 404", async () => {
    const id = await createBook();
    const res = await app.request(`/api/books/${id}/chapters/99`);
    expect(res.status).toBe(404);
  });

  it("章节列表升序", async () => {
    const id = await createBook();
    for (const no of [2, 1]) {
      await app.request(`/api/books/${id}/chapters/${no}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: `第${no}章`, title: `第${no}章` }),
      });
    }
    const res = await app.request(`/api/books/${id}/chapters`);
    const j = await res.json() as { chapters: Array<{ chapterNo: number }> };
    expect(j.chapters.map(ch => ch.chapterNo)).toEqual([1, 2]);
  });
});
