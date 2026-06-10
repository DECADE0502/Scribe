import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createBookRegistry } from "../../src/http/book-registry.js";
import { createApp } from "../../src/http/server.js";

let tmp: string;
let registry: ReturnType<typeof createBookRegistry>;
let app: ReturnType<typeof createApp>;
let bookId: string;

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

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scribe-sidebar-"));
  const paths = makePaths(tmp);
  fs.mkdirSync(paths.booksDir, { recursive: true });
  registry = createBookRegistry({ paths });
  app = createApp({ bookRegistry: registry });
  const res = await app.request("/api/books", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "资料测试" }),
  });
  bookId = (await res.json() as { id: string }).id;
});

afterEach(() => {
  registry.closeAll();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("sidebar 资料读取", () => {
  it("GET characters / outline / foreshadowing / timeline 空书都返回空数组", async () => {
    for (const [route, key] of [
      ["characters", "characters"],
      ["outline", "outline"],
      ["foreshadowing", "foreshadowing"],
      ["timeline", "timeline"],
    ] as const) {
      const res = await app.request(`/api/books/${bookId}/${route}`);
      expect(res.status).toBe(200);
      const j = await res.json() as Record<string, unknown[]>;
      expect(j[key]).toEqual([]);
    }
  });

  it("书不存在 404", async () => {
    const res = await app.request("/api/books/ghost/characters");
    expect(res.status).toBe(404);
  });

  it("有数据后能读回", async () => {
    const handle = registry.open(bookId);
    handle.charactersRepo.create({ name: "林尘", role: "protagonist", baseData: {}, currentState: {} });
    const res = await app.request(`/api/books/${bookId}/characters`);
    const j = await res.json() as { characters: Array<{ name: string }> };
    expect(j.characters).toHaveLength(1);
    expect(j.characters[0]!.name).toBe("林尘");
  });
});

describe("PUT characters/:cid(手动编辑 + 广播)", () => {
  it("更新角色并向对话流广播 system 消息", async () => {
    const handle = registry.open(bookId);
    const c = handle.charactersRepo.create({ name: "林尘", role: "protagonist", baseData: {}, currentState: {} });
    const res = await app.request(`/api/books/${bookId}/characters/${c.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseData: { background: "弃婴", age: 22 } }),
    });
    expect(res.status).toBe(200);
    const updated = handle.charactersRepo.get(c.id);
    expect((updated!.baseData as Record<string, unknown>).age).toBe(22);
    // 广播
    const msgs = handle.conversationsRepo.listLatest(5);
    expect(msgs.some(m => m.role === "system" && m.content.includes("林尘"))).toBe(true);
  });

  it("角色不存在 404", async () => {
    const res = await app.request(`/api/books/${bookId}/characters/ghost`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "x" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("foreshadowing 手动加/删", () => {
  it("POST 创建 active 伏笔 + 广播,DELETE 删除 + 广播", async () => {
    const create = await app.request(`/api/books/${bookId}/foreshadowing`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "黑剑", description: "出处不明", plantedChapter: 1 }),
    });
    expect(create.status).toBe(201);
    const created = await create.json() as { id: string; status: string };
    expect(created.status).toBe("active");

    const del = await app.request(`/api/books/${bookId}/foreshadowing/${created.id}`, { method: "DELETE" });
    expect(del.status).toBe(200);

    const handle = registry.open(bookId);
    expect(handle.foreshadowingRepo.list()).toHaveLength(0);
    const msgs = handle.conversationsRepo.listLatest(5);
    expect(msgs.filter(m => m.content.includes("黑剑"))).toHaveLength(2); // 加 + 删各一条
  });

  it("空 label 400;删不存在 404", async () => {
    const r400 = await app.request(`/api/books/${bookId}/foreshadowing`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: " " }),
    });
    expect(r400.status).toBe(400);
    const r404 = await app.request(`/api/books/${bookId}/foreshadowing/ghost`, { method: "DELETE" });
    expect(r404.status).toBe(404);
  });
});

describe("rules.md 读写", () => {
  it("初始为空,PUT 后能读回 + 广播", async () => {
    const empty = await app.request(`/api/books/${bookId}/rules`);
    expect((await empty.json() as { content: string }).content).toBe("");

    const put = await app.request(`/api/books/${bookId}/rules`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "## 风格\n\n禁用破折号。" }),
    });
    expect(put.status).toBe(200);

    const read = await app.request(`/api/books/${bookId}/rules`);
    expect((await read.json() as { content: string }).content).toContain("禁用破折号");

    const handle = registry.open(bookId);
    const msgs = handle.conversationsRepo.listLatest(5);
    expect(msgs.some(m => m.content.includes("写作规则"))).toBe(true);
  });
});

describe("GET genre-sections", () => {
  it("返回板块 + items 嵌套结构", async () => {
    const handle = registry.open(bookId);
    const sec = handle.genreSectionsRepo.createSection({
      name: "功法体系",
      schema: [{ name: "name", type: "string", required: true }],
      createdBy: "ai",
    });
    handle.genreSectionsRepo.addItem(sec.id, { name: "九转金身" });
    const res = await app.request(`/api/books/${bookId}/genre-sections`);
    const j = await res.json() as { sections: Array<{ section: { name: string }; items: unknown[] }> };
    expect(j.sections).toHaveLength(1);
    expect(j.sections[0]!.section.name).toBe("功法体系");
    expect(j.sections[0]!.items).toHaveLength(1);
  });
});

describe("genre-sections 写入端点", () => {
  it("POST items:schema 校验通过则 201 + 广播,缺必填 400", async () => {
    const handle = registry.open(bookId);
    const sec = handle.genreSectionsRepo.createSection({
      name: "境界",
      schema: [{ name: "name", type: "string", required: true }],
      createdBy: "ai",
    });
    const ok = await app.request(`/api/books/${bookId}/genre-sections/${sec.id}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: { name: "炼气" } }),
    });
    expect(ok.status).toBe(201);
    const bad = await app.request(`/api/books/${bookId}/genre-sections/${sec.id}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: {} }),
    });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toContain("必填");
    const msgs = handle.conversationsRepo.listLatest(5);
    expect(msgs.some(m => m.content.includes("境界"))).toBe(true);
  });

  it("PUT items merge 更新;DELETE items;DELETE section 级联 + 广播", async () => {
    const handle = registry.open(bookId);
    const sec = handle.genreSectionsRepo.createSection({
      name: "法器",
      schema: [
        { name: "name", type: "string", required: true },
        { name: "rank", type: "string" },
      ],
      createdBy: "ai",
    });
    const item = handle.genreSectionsRepo.addItem(sec.id, { name: "青锋剑" });

    const put = await app.request(`/api/books/${bookId}/genre-sections/items/${item.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: { rank: "中品" } }),
    });
    expect(put.status).toBe(200);
    const updated = handle.genreSectionsRepo.getItem(item.id);
    expect(updated!.data.name).toBe("青锋剑"); // merge 保留
    expect(updated!.data.rank).toBe("中品");

    const delSec = await app.request(`/api/books/${bookId}/genre-sections/${sec.id}`, { method: "DELETE" });
    expect(delSec.status).toBe(200);
    expect((await delSec.json() as { itemsRemoved: number }).itemsRemoved).toBe(1);
    expect(handle.genreSectionsRepo.getSection(sec.id)).toBeUndefined();
    const msgs = handle.conversationsRepo.listLatest(10);
    expect(msgs.some(m => m.content.includes("删除了板块「法器」"))).toBe(true);
  });
});
