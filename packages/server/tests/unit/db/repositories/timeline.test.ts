import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "../../../../src/db/migrations/runner.js";
import { createTimelineRepo } from "../../../../src/db/repositories/timeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceInit = fs.readFileSync(
  path.join(__dirname, "../../../../src/db/migrations/workspace/001_init.sql"),
  "utf-8"
);

let db: any, repo: ReturnType<typeof createTimelineRepo>;
beforeEach(() => {
  db = new Database(":memory:");
  runMigrations(db, [{ name: "001_init.sql", sql: workspaceInit }]);
  repo = createTimelineRepo(db);
});

describe("timeline repo", () => {
  it("create + get", () => {
    const e = repo.create({
      chapterNo: 1,
      storyTime: "贞观三年春",
      event: "初遇",
      participants: ["c1", "c2"],
    });
    expect(e.id).toBeTruthy();
    expect(repo.get(e.id)?.event).toBe("初遇");
  });

  it("listByChapter 仅返回该章事件", () => {
    repo.create({ chapterNo: 1, storyTime: "a", event: "A", participants: [] });
    repo.create({ chapterNo: 2, storyTime: "b", event: "B", participants: [] });
    repo.create({ chapterNo: 1, storyTime: "c", event: "C", participants: [] });
    expect(repo.listByChapter(1)).toHaveLength(2);
    expect(repo.listByChapter(2)).toHaveLength(1);
  });

  it("listAll 按 chapter_no, story_time 升序", () => {
    repo.create({ chapterNo: 2, storyTime: "x", event: "B", participants: [] });
    repo.create({ chapterNo: 1, storyTime: "z", event: "A2", participants: [] });
    repo.create({ chapterNo: 1, storyTime: "a", event: "A1", participants: [] });
    const all = repo.listAll();
    expect(all.map((e) => e.event)).toEqual(["A1", "A2", "B"]);
  });

  it("get 不存在的 id 返回 undefined", () => {
    expect(repo.get("nope")).toBeUndefined();
  });

  it("delete 后 listAll 不含该事件", () => {
    const e = repo.create({
      chapterNo: 1,
      storyTime: "a",
      event: "A",
      participants: [],
    });
    repo.delete(e.id);
    expect(repo.listAll()).toHaveLength(0);
  });

  it("participants 空数组与多元素均能往返", () => {
    const e1 = repo.create({
      chapterNo: 1,
      storyTime: "a",
      event: "A",
      participants: [],
    });
    const e2 = repo.create({
      chapterNo: 1,
      storyTime: "b",
      event: "B",
      participants: ["c1", "c2", "c3"],
    });
    expect(repo.get(e1.id)?.participants).toEqual([]);
    expect(repo.get(e2.id)?.participants).toEqual(["c1", "c2", "c3"]);
  });
});
