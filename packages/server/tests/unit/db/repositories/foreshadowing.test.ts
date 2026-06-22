import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "../../../../src/db/migrations/runner.js";
import { createForeshadowingRepo } from "../../../../src/db/repositories/foreshadowing.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceInit = fs.readFileSync(
  path.join(__dirname, "../../../../src/db/migrations/workspace/001_init.sql"),
  "utf-8"
);

let db: any, repo: ReturnType<typeof createForeshadowingRepo>;
beforeEach(() => {
  db = new Database(":memory:");
  runMigrations(db, [{ name: "001_init.sql", sql: workspaceInit }]);
  repo = createForeshadowingRepo(db);
});

describe("foreshadowing repo", () => {
  it("create + get", () => {
    const f = repo.create({
      label: "神秘古剑",
      description: null,
      plantedChapter: 3,
      paidChapter: null,
      status: "active",
      relatedCharacters: [],
    });
    expect(f.id).toBeTruthy();
    expect(repo.get(f.id)?.label).toBe("神秘古剑");
  });

  it("list 不带 filter 返回全部", () => {
    repo.create({
      label: "A",
      description: null,
      plantedChapter: null,
      paidChapter: null,
      status: "active",
      relatedCharacters: [],
    });
    repo.create({
      label: "B",
      description: null,
      plantedChapter: null,
      paidChapter: null,
      status: "paid",
      relatedCharacters: [],
    });
    expect(repo.list()).toHaveLength(2);
  });

  it("list(status) 按状态过滤", () => {
    repo.create({
      label: "A",
      description: null,
      plantedChapter: null,
      paidChapter: null,
      status: "active",
      relatedCharacters: [],
    });
    repo.create({
      label: "B",
      description: null,
      plantedChapter: null,
      paidChapter: null,
      status: "paid",
      relatedCharacters: [],
    });
    expect(repo.list("active")).toHaveLength(1);
    expect(repo.list("paid")).toHaveLength(1);
    expect(repo.list("dropped")).toHaveLength(0);
  });

  it("update 修改字段", () => {
    const f = repo.create({
      label: "old",
      description: null,
      plantedChapter: null,
      paidChapter: null,
      status: "active",
      relatedCharacters: [],
    });
    const f2 = repo.update(f.id, { label: "new", description: "改过" });
    expect(f2.label).toBe("new");
    expect(f2.description).toBe("改过");
  });

  it("pay 改 status 与 paidChapter", () => {
    const f = repo.create({
      label: "X",
      description: null,
      plantedChapter: 2,
      paidChapter: null,
      status: "active",
      relatedCharacters: [],
    });
    const paid = repo.pay(f.id, 7);
    expect(paid.status).toBe("paid");
    expect(paid.paidChapter).toBe(7);
  });

  it("get 不存在的 id 返回 undefined", () => {
    expect(repo.get("nope")).toBeUndefined();
  });

  it("delete 后 list 不含该伏笔", () => {
    const f = repo.create({
      label: "X",
      description: null,
      plantedChapter: null,
      paidChapter: null,
      status: "active",
      relatedCharacters: [],
    });
    repo.delete(f.id);
    expect(repo.list()).toHaveLength(0);
  });

  it("deleteFromChapter 回档:埋设在范围内的整条删,早埋后还的只撤销回收(回归 #3)", () => {
    // A: 第5章埋 → 从第3章回档,埋设在范围内,应删除
    const a = repo.create({ label: "A埋在范围内", description: null, plantedChapter: 5, paidChapter: null, status: "active", relatedCharacters: [] });
    // B: 第2章埋、第10章还 → 从第3章回档,埋设在范围外(保留),回收在范围内(撤销→active)
    const b = repo.create({ label: "B早埋后还", description: null, plantedChapter: 2, paidChapter: 10, status: "paid", relatedCharacters: [] });
    // C: 第1章埋、未还 → 完全在范围外,不动
    const c = repo.create({ label: "C早埋未还", description: null, plantedChapter: 1, paidChapter: null, status: "active", relatedCharacters: [] });

    const deleted = repo.deleteFromChapter(3);
    expect(deleted).toBe(1); // 只删了 A

    expect(repo.get(a.id)).toBeUndefined(); // A 被删
    const bAfter = repo.get(b.id);
    expect(bAfter).toBeDefined();           // B 保留(没被误删)
    expect(bAfter?.status).toBe("active");  // 回收被撤销
    expect(bAfter?.paidChapter).toBeNull();
    const cAfter = repo.get(c.id);
    expect(cAfter?.status).toBe("active");  // C 不受影响
    expect(cAfter?.plantedChapter).toBe(1);
  });

  it("raw NULL related_characters 读出落到空数组", () => {
    db.prepare(
      `INSERT INTO foreshadowing(id,label,description,planted_chapter,paid_chapter,status,related_characters)
       VALUES(?,?,?,?,?,?,?)`
    ).run("raw-fs", "Z", null, null, null, "active", null);
    const f = repo.get("raw-fs");
    expect(f?.relatedCharacters).toEqual([]);
  });
});
