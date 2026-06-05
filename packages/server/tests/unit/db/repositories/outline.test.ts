import { describe, it, expect, beforeEach } from "vitest";
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
