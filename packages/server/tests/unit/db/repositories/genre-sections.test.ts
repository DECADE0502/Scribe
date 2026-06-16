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

  const minimalSchema = [{ name: "name", type: "string" as const }];

  it("listSections 返回全部", () => {
    repo.createSection({ name: "A", schema: minimalSchema, createdBy: "ai" });
    repo.createSection({ name: "B", schema: minimalSchema, createdBy: "user" });
    expect(repo.listSections()).toHaveLength(2);
  });

  it("updateSectionSchema 更新 schema", () => {
    const s = repo.createSection({ name: "X", schema: minimalSchema, createdBy: "ai" });
    repo.updateSectionSchema(s.id, [
      { name: "f1", type: "number" },
      { name: "f2", type: "text" },
    ]);
    expect(repo.getSection(s.id)?.schema).toHaveLength(2);
  });

  it("updateSectionSchema 保留 identity/display/search 声明", () => {
    const s = repo.createSection({
      name: "任意集合",
      schema: [{ name: "代号", type: "string", role: "identity", required: true }],
      identityFields: ["代号"],
      displayFields: ["代号"],
      searchFields: ["代号"],
      createdBy: "ai",
    });

    const updated = repo.updateSectionSchema(s.id, [
      { name: "代号", type: "string", role: "identity", required: true },
      { name: "摘要", type: "text", role: "summary" },
    ]);

    expect(updated.identityFields).toEqual(["代号"]);
    expect(updated.displayFields).toEqual(["代号"]);
    expect(updated.searchFields).toEqual(["代号"]);
  });

  it("addItem + getItem + listItems", () => {
    const s = repo.createSection({ name: "X", schema: minimalSchema, createdBy: "ai" });
    const i1 = repo.addItem(s.id, { foo: "bar" });
    const i2 = repo.addItem(s.id, { foo: "baz" });
    expect(repo.getItem(i1.id)?.data).toEqual({ foo: "bar" });
    expect(repo.listItems(s.id)).toHaveLength(2);
    expect(i2.sectionId).toBe(s.id);
  });

  it("findItemByIdentity 按声明 identityFields 查找条目", () => {
    const s = repo.createSection({
      name: "任意集合",
      schema: [
        { name: "代号", type: "string", role: "identity", required: true },
        { name: "名称", type: "string", role: "label" },
      ],
      identityFields: ["代号"],
      displayFields: ["名称"],
      createdBy: "ai",
    });
    const item = repo.addItem(s.id, { 代号: "A-1", 名称: "一号" });

    expect(repo.findItemByIdentity(s, { 代号: "A-1" })?.id).toBe(item.id);
    expect(repo.findItemByIdentity(s, { 代号: "A-2" })).toBeUndefined();
  });

  it("updateItem 修改 data 并刷新 updatedAt", async () => {
    const s = repo.createSection({ name: "X", schema: minimalSchema, createdBy: "ai" });
    const i = repo.addItem(s.id, { v: 1 });
    await new Promise((r) => setTimeout(r, 5));
    const i2 = repo.updateItem(i.id, { v: 2 });
    expect(i2.data).toEqual({ v: 2 });
    expect(i2.updatedAt).toBeGreaterThan(i.updatedAt);
  });

  it("deleteItem 移除单个 item", () => {
    const s = repo.createSection({ name: "X", schema: minimalSchema, createdBy: "ai" });
    const i = repo.addItem(s.id, { v: 1 });
    repo.deleteItem(i.id);
    expect(repo.getItem(i.id)).toBeUndefined();
  });

  it("deleteSection 级联删除其 items", () => {
    const s = repo.createSection({ name: "X", schema: minimalSchema, createdBy: "ai" });
    repo.addItem(s.id, { v: 1 });
    repo.addItem(s.id, { v: 2 });
    repo.deleteSection(s.id);
    expect(repo.getSection(s.id)).toBeUndefined();
    expect(repo.listItems(s.id)).toHaveLength(0);
  });

  it("getSection 不存在返回 undefined", () => {
    expect(repo.getSection("nope")).toBeUndefined();
  });

  it("raw 空串 item.data 落到 fallback", () => {
    const s = repo.createSection({ name: "raw", schema: minimalSchema, createdBy: "ai" });
    db.prepare(
      `INSERT INTO genre_section_items(id,section_id,data,updated_at)
       VALUES(?,?,?,?)`
    ).run("raw-item", s.id, "", Date.now());
    const item = repo.getItem("raw-item");
    expect(item?.data).toEqual({});
  });
});
