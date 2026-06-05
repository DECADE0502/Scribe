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
});
