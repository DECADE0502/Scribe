import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "../../../../src/db/migrations/runner.js";
import { createGenreSectionsRepo } from "../../../../src/db/repositories/genre-sections.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceInit = fs.readFileSync(
  path.join(__dirname, "../../../../src/db/migrations/workspace/001_init.sql"),
  "utf-8"
);

let db: any, repo: ReturnType<typeof createGenreSectionsRepo>;
beforeEach(() => {
  db = new Database(":memory:");
  runMigrations(db, [{ name: "001_init.sql", sql: workspaceInit }]);
  repo = createGenreSectionsRepo(db);
});

describe("genre-sections repo", () => {
  it("createSection + getSection", () => {
    const s = repo.createSection({
      name: "功法体系",
      schema: [{ name: "境界", type: "string" }],
      createdBy: "ai",
    });
    expect(s.id).toBeTruthy();
    expect(repo.getSection(s.id)?.name).toBe("功法体系");
    expect(repo.getSection(s.id)?.schema).toHaveLength(1);
  });

  it("listSections 返回全部", () => {
    repo.createSection({ name: "A", schema: [], createdBy: "ai" });
    repo.createSection({ name: "B", schema: [], createdBy: "user" });
    expect(repo.listSections()).toHaveLength(2);
  });

  it("updateSectionSchema 更新 schema", () => {
    const s = repo.createSection({ name: "X", schema: [], createdBy: "ai" });
    repo.updateSectionSchema(s.id, [
      { name: "f1", type: "number" },
      { name: "f2", type: "text" },
    ]);
    expect(repo.getSection(s.id)?.schema).toHaveLength(2);
  });

  it("addItem + getItem + listItems", () => {
    const s = repo.createSection({ name: "X", schema: [], createdBy: "ai" });
    const i1 = repo.addItem(s.id, { foo: "bar" });
    const i2 = repo.addItem(s.id, { foo: "baz" });
    expect(repo.getItem(i1.id)?.data).toEqual({ foo: "bar" });
    expect(repo.listItems(s.id)).toHaveLength(2);
    expect(i2.sectionId).toBe(s.id);
  });

  it("updateItem 修改 data 并刷新 updatedAt", async () => {
    const s = repo.createSection({ name: "X", schema: [], createdBy: "ai" });
    const i = repo.addItem(s.id, { v: 1 });
    await new Promise((r) => setTimeout(r, 5));
    const i2 = repo.updateItem(i.id, { v: 2 });
    expect(i2.data).toEqual({ v: 2 });
    expect(i2.updatedAt).toBeGreaterThan(i.updatedAt);
  });

  it("deleteItem 移除单个 item", () => {
    const s = repo.createSection({ name: "X", schema: [], createdBy: "ai" });
    const i = repo.addItem(s.id, { v: 1 });
    repo.deleteItem(i.id);
    expect(repo.getItem(i.id)).toBeUndefined();
  });

  it("deleteSection 级联删除其 items", () => {
    const s = repo.createSection({ name: "X", schema: [], createdBy: "ai" });
    repo.addItem(s.id, { v: 1 });
    repo.addItem(s.id, { v: 2 });
    repo.deleteSection(s.id);
    expect(repo.getSection(s.id)).toBeUndefined();
    expect(repo.listItems(s.id)).toHaveLength(0);
  });

  it("getSection 不存在返回 undefined", () => {
    expect(repo.getSection("nope")).toBeUndefined();
  });
});
