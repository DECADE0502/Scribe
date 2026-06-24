import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations/runner.js";
import { createBookMetaRepo } from "../../src/db/repositories/book-meta.js";
import { createCharactersRepo } from "../../src/db/repositories/characters.js";
import { createOutlineRepo } from "../../src/db/repositories/outline.js";
import { createGenreSectionsRepo } from "../../src/db/repositories/genre-sections.js";
import { createForeshadowingRepo } from "../../src/db/repositories/foreshadowing.js";
import { createChaptersRepo } from "../../src/db/repositories/chapters.js";
import { loadBookSnapshot } from "../../src/ai/context-builder/snapshot.js";
import { isOnboardComplete } from "../../src/ai/orchestrator/onboard-completeness.js";
import { NEW_BOOK_ONBOARD_PROMPT } from "../../src/ai/prompts/new-book-onboard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let tmp: string;
let db: Database.Database;
let repos: {
  bookMetaRepo: ReturnType<typeof createBookMetaRepo>;
  charactersRepo: ReturnType<typeof createCharactersRepo>;
  outlineRepo: ReturnType<typeof createOutlineRepo>;
  genreSectionsRepo: ReturnType<typeof createGenreSectionsRepo>;
  foreshadowingRepo: ReturnType<typeof createForeshadowingRepo>;
  chaptersRepo: ReturnType<typeof createChaptersRepo>;
};
let paths: { rulesMd: string };

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scribe-nb-"));
  db = new Database(":memory:");
  const initSql = fs.readFileSync(
    path.join(__dirname, "../../src/db/migrations/workspace/001_init.sql"),
    "utf-8",
  );
  runMigrations(db, [{ name: "001_init.sql", sql: initSql }]);
  paths = { rulesMd: path.join(tmp, "rules.md") };
  repos = {
    bookMetaRepo: createBookMetaRepo(db),
    charactersRepo: createCharactersRepo(db),
    outlineRepo: createOutlineRepo(db),
    genreSectionsRepo: createGenreSectionsRepo(db),
    foreshadowingRepo: createForeshadowingRepo(db),
    chaptersRepo: createChaptersRepo(db),
  };
});

afterEach(() => {
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("new book onboarding contract", () => {
  it("prompt asks for generic long-term records instead of genre-specific lists", () => {
    expect(NEW_BOOK_ONBOARD_PROMPT).toContain("长期保持一致");
    expect(NEW_BOOK_ONBOARD_PROMPT).toContain("create_record_collection");
    expect(NEW_BOOK_ONBOARD_PROMPT).toContain("update_record_collection_schema");
    expect(NEW_BOOK_ONBOARD_PROMPT).toContain("upsert_record_item");
    expect(NEW_BOOK_ONBOARD_PROMPT).toContain("identityFields");
    expect(NEW_BOOK_ONBOARD_PROMPT).toContain("displayFields");
    expect(NEW_BOOK_ONBOARD_PROMPT).toContain("searchFields");
    expect(NEW_BOOK_ONBOARD_PROMPT).not.toContain("create_genre_section");
    expect(NEW_BOOK_ONBOARD_PROMPT).not.toContain("修仙/玄幻 →");
    expect(NEW_BOOK_ONBOARD_PROMPT).not.toContain("都市/异能 →");
  });

  it("prompt requires precise chapter-level outline instead of arc-only planning", () => {
    expect(NEW_BOOK_ONBOARD_PROMPT).toContain('level: "chapter"');
    expect(NEW_BOOK_ONBOARD_PROMPT).toContain("本章事件");
    expect(NEW_BOOK_ONBOARD_PROMPT).toContain("本章精确大纲");
    expect(NEW_BOOK_ONBOARD_PROMPT).toContain("不能替代章级大纲");
    expect(NEW_BOOK_ONBOARD_PROMPT).not.toContain("弧级大纲是写作时防止");
  });

  it("completed setup is derived from persisted book state, not the legacy onboard agent", () => {
    repos.bookMetaRepo.set("genre", "仙侠");
    repos.bookMetaRepo.set("premise", "被废功法的弃婴重修崛起");
    repos.charactersRepo.create({
      name: "林尘",
      role: "protagonist",
      baseData: { background: "弃婴" },
      currentState: {},
    });
    repos.outlineRepo.create({
      parentId: null,
      level: "chapter",
      title: "第1章 雨夜重修",
      summary: "本章写林尘在雨夜确认旧伤、发现重修契机，结尾立下离开云岚宗的决定。",
      status: "planned",
      sortOrder: 0,
      metadata: null,
    });

    const snap = loadBookSnapshot("b1", repos, paths);
    const completeness = isOnboardComplete(snap);
    expect(completeness.ok).toBe(true);
    expect(completeness.missing).toEqual([]);
  });

  it("skipped setup remains incomplete but snapshot loading still works", () => {
    const snap = loadBookSnapshot("b1", repos, paths);
    const result = isOnboardComplete(snap);
    expect(result.ok).toBe(false);
    expect(result.missing.length).toBeGreaterThan(0);
    expect(snap.bookId).toBe("b1");
    expect(snap.characters).toEqual([]);
  });
});
