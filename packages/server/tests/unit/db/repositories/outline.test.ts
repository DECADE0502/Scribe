import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "../../../../src/db/migrations/runner.js";
import { createOutlineRepo } from "../../../../src/db/repositories/outline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceInit = fs.readFileSync(
  path.join(__dirname, "../../../../src/db/migrations/workspace/001_init.sql"),
  "utf-8"
);

let db: any, repo: ReturnType<typeof createOutlineRepo>;
beforeEach(() => {
  db = new Database(":memory:");
  runMigrations(db, [{ name: "001_init.sql", sql: workspaceInit }]);
  repo = createOutlineRepo(db);
});

describe("outline repo", () => {
  it("create + get", () => {
    const n = repo.create({
      parentId: null,
      level: "volume",
      title: "第一卷",
      summary: null,
      status: "planned",
      sortOrder: 0,
      metadata: null,
    });
    expect(n.id).toBeTruthy();
    expect(repo.get(n.id)?.title).toBe("第一卷");
  });

  it("listChildren 按 sort_order 升序", () => {
    const root = repo.create({
      parentId: null,
      level: "volume",
      title: "卷",
      summary: null,
      status: "planned",
      sortOrder: 0,
      metadata: null,
    });
    repo.create({
      parentId: root.id,
      level: "arc",
      title: "B",
      summary: null,
      status: "planned",
      sortOrder: 2,
      metadata: null,
    });
    repo.create({
      parentId: root.id,
      level: "arc",
      title: "A",
      summary: null,
      status: "planned",
      sortOrder: 1,
      metadata: null,
    });
    const kids = repo.listChildren(root.id);
    expect(kids.map((k) => k.title)).toEqual(["A", "B"]);
  });

  it("listChildren(null) 返回根节点", () => {
    repo.create({
      parentId: null,
      level: "volume",
      title: "Root",
      summary: null,
      status: "planned",
      sortOrder: 0,
      metadata: null,
    });
    expect(repo.listChildren(null)).toHaveLength(1);
  });

  it("update 修改字段", () => {
    const n = repo.create({
      parentId: null,
      level: "volume",
      title: "old",
      summary: null,
      status: "planned",
      sortOrder: 0,
      metadata: null,
    });
    const n2 = repo.update(n.id, { title: "new", status: "in_progress" });
    expect(n2.title).toBe("new");
    expect(n2.status).toBe("in_progress");
  });

  it("metadata nullable 写入 NULL 读出 null", () => {
    const n = repo.create({
      parentId: null,
      level: "volume",
      title: "x",
      summary: null,
      status: "planned",
      sortOrder: 0,
      metadata: null,
    });
    expect(repo.get(n.id)?.metadata).toBeNull();
  });

  it("metadata 非空对象正确序列化", () => {
    const n = repo.create({
      parentId: null,
      level: "volume",
      title: "x",
      summary: null,
      status: "planned",
      sortOrder: 0,
      metadata: { weight: 5 },
    });
    expect(repo.get(n.id)?.metadata).toEqual({ weight: 5 });
  });

  it("reorder 按 ids 顺序更新 sort_order", () => {
    const root = repo.create({
      parentId: null,
      level: "volume",
      title: "卷",
      summary: null,
      status: "planned",
      sortOrder: 0,
      metadata: null,
    });
    const a = repo.create({
      parentId: root.id,
      level: "arc",
      title: "A",
      summary: null,
      status: "planned",
      sortOrder: 1,
      metadata: null,
    });
    const b = repo.create({
      parentId: root.id,
      level: "arc",
      title: "B",
      summary: null,
      status: "planned",
      sortOrder: 2,
      metadata: null,
    });
    repo.reorder(root.id, [b.id, a.id]);
    const kids = repo.listChildren(root.id);
    expect(kids.map((k) => k.title)).toEqual(["B", "A"]);
  });

  it("delete 后 get 返回 undefined", () => {
    const n = repo.create({
      parentId: null,
      level: "volume",
      title: "x",
      summary: null,
      status: "planned",
      sortOrder: 0,
      metadata: null,
    });
    repo.delete(n.id);
    expect(repo.get(n.id)).toBeUndefined();
  });

  it("raw NULL/空串 metadata 读出落到 null", () => {
    db.prepare(
      `INSERT INTO outline_nodes(id,parent_id,level,title,summary,status,sort_order,metadata)
       VALUES(?,?,?,?,?,?,?,?)`
    ).run("raw-ol-1", null, "volume", "raw1", null, "planned", 0, null);
    db.prepare(
      `INSERT INTO outline_nodes(id,parent_id,level,title,summary,status,sort_order,metadata)
       VALUES(?,?,?,?,?,?,?,?)`
    ).run("raw-ol-2", null, "volume", "raw2", null, "planned", 1, "");
    expect(repo.get("raw-ol-1")?.metadata).toBeNull();
    expect(repo.get("raw-ol-2")?.metadata).toBeNull();
  });
});

describe("outline repo 新方法", () => {
  it("updateSummary 写入并允许清空", () => {
    const node = repo.create({
      parentId: null, level: "arc", title: "弧 1", summary: null,
      status: "planned", sortOrder: 0, metadata: null,
    });
    repo.updateSummary(node.id, "弧 1 的总结");
    expect(repo.get(node.id)?.summary).toBe("弧 1 的总结");
    repo.updateSummary(node.id, null);
    expect(repo.get(node.id)?.summary).toBeNull();
  });

  it("findChapterNode 按 metadata.chapterNo 命中", () => {
    const ch = repo.create({
      parentId: null, level: "chapter", title: "第 3 章",
      summary: null, status: "done", sortOrder: 0,
      metadata: { chapterNo: 3 },
    });
    expect(repo.findChapterNode(3)?.id).toBe(ch.id);
    expect(repo.findChapterNode(99)).toBeUndefined();
  });

  it("clearAncestorSummaries 沿父链清空,不动其它节点", () => {
    const vol = repo.create({ parentId: null, level: "volume", title: "卷 1", summary: "卷总结", status: "done", sortOrder: 0, metadata: null });
    const arc = repo.create({ parentId: vol.id, level: "arc", title: "弧 1", summary: "弧总结", status: "done", sortOrder: 0, metadata: null });
    const sibling = repo.create({ parentId: vol.id, level: "arc", title: "弧 2", summary: "弧 2 总结", status: "done", sortOrder: 1, metadata: null });
    const ch = repo.create({ parentId: arc.id, level: "chapter", title: "章 1", summary: null, status: "done", sortOrder: 0, metadata: { chapterNo: 1 } });
    repo.clearAncestorSummaries(ch.id);
    expect(repo.get(arc.id)?.summary).toBeNull();
    expect(repo.get(vol.id)?.summary).toBeNull();
    expect(repo.get(sibling.id)?.summary).toBe("弧 2 总结");
  });

  it("clearAncestorSummariesByParentId 给删除场景用,从父 id 开始向上清", () => {
    const vol = repo.create({ parentId: null, level: "volume", title: "卷 1", summary: "卷总结", status: "done", sortOrder: 0, metadata: null });
    const arc = repo.create({ parentId: vol.id, level: "arc", title: "弧 1", summary: "弧总结", status: "done", sortOrder: 0, metadata: null });
    repo.clearAncestorSummariesByParentId(arc.id);
    expect(repo.get(arc.id)?.summary).toBeNull();
    expect(repo.get(vol.id)?.summary).toBeNull();
  });

  it("clearAncestorSummariesByParentId 接收 null 是 no-op", () => {
    expect(() => repo.clearAncestorSummariesByParentId(null)).not.toThrow();
  });
});
