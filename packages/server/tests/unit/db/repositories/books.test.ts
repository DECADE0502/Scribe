import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "../../../../src/db/migrations/runner.js";
import { createBooksRepo } from "../../../../src/db/repositories/books.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const libraryInit = fs.readFileSync(
  path.join(__dirname, "../../../../src/db/migrations/library/001_init.sql"),
  "utf-8"
);

let db: any, repo: ReturnType<typeof createBooksRepo>;
beforeEach(() => {
  db = new Database(":memory:");
  runMigrations(db, [{ name: "001_init.sql", sql: libraryInit }]);
  repo = createBooksRepo(db);
});

describe("books repo", () => {
  it("create + get + list", () => {
    const b = repo.create({ title: "测试书", genre: "仙侠" });
    expect(b.id).toBeTruthy();
    expect(repo.get(b.id)?.title).toBe("测试书");
    expect(repo.list()).toHaveLength(1);
  });
  it("rename 更新 updatedAt", async () => {
    const b = repo.create({ title: "A" });
    await new Promise((r) => setTimeout(r, 5));
    const b2 = repo.rename(b.id, "B");
    expect(b2.title).toBe("B");
    expect(b2.updatedAt).toBeGreaterThan(b.updatedAt);
  });
  it("delete 后 get 返回 undefined", () => {
    const b = repo.create({ title: "X" });
    repo.delete(b.id);
    expect(repo.get(b.id)).toBeUndefined();
  });
  it("addCost 累加", () => {
    const b = repo.create({ title: "X" });
    repo.addCost(b.id, 0.12);
    repo.addCost(b.id, 0.03);
    expect(repo.get(b.id)?.totalCostUsd).toBeCloseTo(0.15);
  });
});
