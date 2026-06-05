import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "../../../../src/db/migrations/runner.js";
import { createCharactersRepo } from "../../../../src/db/repositories/characters.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceInit = fs.readFileSync(
  path.join(__dirname, "../../../../src/db/migrations/workspace/001_init.sql"),
  "utf-8"
);

let db: any, repo: ReturnType<typeof createCharactersRepo>;
beforeEach(() => {
  db = new Database(":memory:");
  runMigrations(db, [{ name: "001_init.sql", sql: workspaceInit }]);
  repo = createCharactersRepo(db);
});

describe("characters repo", () => {
  it("create + get 默认空 JSON 字段", () => {
    const c = repo.create({ name: "李白" });
    expect(c.id).toBeTruthy();
    expect(c.name).toBe("李白");
    expect(c.role).toBeNull();
    expect(c.baseData).toEqual({});
    expect(c.currentState).toEqual({});
    expect(c.appearances).toEqual([]);
    const fetched = repo.get(c.id);
    expect(fetched?.name).toBe("李白");
  });

  it("list 返回所有角色", () => {
    repo.create({ name: "A", role: "protagonist" });
    repo.create({ name: "B", role: "antagonist" });
    expect(repo.list()).toHaveLength(2);
  });

  it("update 合并 patch 并刷新 updatedAt", async () => {
    const c = repo.create({ name: "X", baseData: { age: 20 } });
    await new Promise((r) => setTimeout(r, 5));
    const c2 = repo.update(c.id, { name: "Y", baseData: { age: 21 } });
    expect(c2.name).toBe("Y");
    expect(c2.baseData).toEqual({ age: 21 });
    expect(c2.updatedAt).toBeGreaterThan(c.updatedAt);
  });

  it("addAppearance 追加 appearance", () => {
    const c = repo.create({ name: "X" });
    const c2 = repo.addAppearance(c.id, { chapterNo: 1, brief: "登场" });
    expect(c2.appearances).toHaveLength(1);
    const c3 = repo.addAppearance(c.id, { chapterNo: 2, brief: "再战" });
    expect(c3.appearances).toHaveLength(2);
    expect(c3.appearances[1]?.chapterNo).toBe(2);
  });

  it("get 不存在的 id 返回 undefined", () => {
    expect(repo.get("nope")).toBeUndefined();
  });

  it("delete 后 list 不含该角色", () => {
    const c = repo.create({ name: "X" });
    repo.delete(c.id);
    expect(repo.get(c.id)).toBeUndefined();
    expect(repo.list()).toHaveLength(0);
  });
});
