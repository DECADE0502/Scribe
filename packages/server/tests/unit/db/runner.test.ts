import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { runMigrations, compareMigrations } from "../../../src/db/migrations/runner.js";

describe("runMigrations", () => {
  it("首次执行所有迁移并记录,二次执行幂等", () => {
    const db = new Database(":memory:");
    const migs = [
      { name: "001_a.sql", sql: "CREATE TABLE a(id INTEGER);" },
      { name: "002_b.sql", sql: "CREATE TABLE b(id INTEGER);" },
    ];
    runMigrations(db, migs);
    const applied1 = db.prepare("SELECT name FROM _migrations ORDER BY name").all();
    expect(applied1).toEqual([{ name: "001_a.sql" }, { name: "002_b.sql" }]);
    runMigrations(db, migs);
    const applied2 = db.prepare("SELECT COUNT(*) AS c FROM _migrations").get() as { c: number };
    expect(applied2.c).toBe(2);
  });

  it("迁移按文件名升序执行,即使输入顺序混乱", () => {
    const db = new Database(":memory:");
    // 倒序输入,验证 runner 内部 sort 真的发挥作用
    const migs = [
      { name: "002_b.sql", sql: "CREATE TABLE b(id INTEGER);" },
      { name: "001_a.sql", sql: "CREATE TABLE a(id INTEGER);" },
    ];
    runMigrations(db, migs);
    // rowid 反映 INSERT 顺序,若未排序应是 002 在前 001 在后
    const applied = db.prepare("SELECT name FROM _migrations ORDER BY rowid").all();
    expect(applied).toEqual([{ name: "001_a.sql" }, { name: "002_b.sql" }]);
  });

  it("按数字前缀排序:001_init 必须排在 0008/0009 之前(回归 #1)", () => {
    const names = ["0008_worldbook.sql", "0009_sillytavern.sql", "001_init.sql"];
    const sorted = names.map((name) => ({ name })).sort(compareMigrations).map((m) => m.name);
    expect(sorted).toEqual(["001_init.sql", "0008_worldbook.sql", "0009_sillytavern.sql"]);
  });

  it("真实命名(001 + 0008 + 0009)乱序输入仍按数字顺序执行", () => {
    const db = new Database(":memory:");
    runMigrations(db, [
      { name: "0009_c.sql", sql: "CREATE TABLE c(id INTEGER);" },
      { name: "0008_b.sql", sql: "CREATE TABLE b(id INTEGER);" },
      { name: "001_init.sql", sql: "CREATE TABLE base(id INTEGER);" },
    ]);
    const applied = db.prepare("SELECT name FROM _migrations ORDER BY rowid").all();
    expect(applied).toEqual([{ name: "001_init.sql" }, { name: "0008_b.sql" }, { name: "0009_c.sql" }]);
  });

  it("失败迁移整体回滚:前面已建表也会撤销,且不写入 _migrations", () => {
    const db = new Database(":memory:");
    // 多语句迁移:第一句建表 y 成功,第二句重复建 y 触发失败
    const sql = "CREATE TABLE y(id INTEGER); CREATE TABLE y(id INTEGER);";
    expect(() => runMigrations(db, [{ name: "bad.sql", sql }])).toThrow();
    // 整体回滚:y 不应存在
    const ytable = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='y'")
      .get();
    expect(ytable).toBeUndefined();
    // _migrations 也不应记录这条失败迁移
    const recorded = db.prepare("SELECT 1 FROM _migrations WHERE name='bad.sql'").get();
    expect(recorded).toBeUndefined();
  });
});
