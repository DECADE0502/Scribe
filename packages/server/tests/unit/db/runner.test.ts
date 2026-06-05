import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../../src/db/migrations/runner.js";

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
    const applied2 = db.prepare("SELECT COUNT(*) AS c FROM _migrations").get() as any;
    expect(applied2.c).toBe(2);
  });

  it("失败迁移整体回滚", () => {
    const db = new Database(":memory:");
    expect(() => runMigrations(db, [{ name: "bad.sql", sql: "CREATE TABLE x(); -- syntax error" }]))
      .toThrow();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    expect(tables.find((t: any) => t.name === "x")).toBeUndefined();
  });
});
