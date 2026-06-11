import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import type { ChapterSummary } from "@scribe/shared";
import { runMigrations } from "../../../../src/db/migrations/runner.js";
import { createBookMetaRepo } from "../../../../src/db/repositories/book-meta.js";
import { createCharactersRepo } from "../../../../src/db/repositories/characters.js";
import { createOutlineRepo } from "../../../../src/db/repositories/outline.js";
import { createForeshadowingRepo } from "../../../../src/db/repositories/foreshadowing.js";
import { createGenreSectionsRepo } from "../../../../src/db/repositories/genre-sections.js";
import { createChaptersRepo } from "../../../../src/db/repositories/chapters.js";
import { buildChapterWriteMessages } from "../../../../src/ai/context-builder/book-context.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let db: any, handle: any;

function summary(chapterNo: number, oneLiner: string, chars: string[]): ChapterSummary {
  return {
    chapterNo,
    oneLiner,
    paragraph: `第${chapterNo}章概要正文,涉及 ${chars.join("、")}。`,
    keyEvents: [{ event: oneLiner, characters: chars, foreshadowingRefs: [] }],
    generatedAt: 1,
    reasoningContent: null,
  };
}

beforeEach(() => {
  db = new Database(":memory:");
  const initSql = fs.readFileSync(
    path.join(__dirname, "../../../../src/db/migrations/workspace/001_init.sql"),
    "utf-8",
  );
  runMigrations(db, [{ name: "001_init.sql", sql: initSql }]);

  const bookMetaRepo = createBookMetaRepo(db);
  const charactersRepo = createCharactersRepo(db);
  const outlineRepo = createOutlineRepo(db);
  const foreshadowingRepo = createForeshadowingRepo(db);
  const genreSectionsRepo = createGenreSectionsRepo(db);
  const chaptersRepo = createChaptersRepo(db);

  bookMetaRepo.set("title", "玄剑录");
  bookMetaRepo.set("premise", "废脉少年得断剑重修");
  bookMetaRepo.set("genre", "仙侠");

  charactersRepo.create({ name: "林尘", role: "protagonist", baseData: { background: "云岚宗杂役" }, currentState: {} });
  charactersRepo.create({ name: "韩渊", role: "antagonist", baseData: {}, currentState: {} });

  foreshadowingRepo.create({
    label: "黑色碎片来历", description: "青玄身份成谜", plantedChapter: 2,
    paidChapter: null, status: "active", relatedCharacters: ["林尘"],
  });

  const sec = genreSectionsRepo.createSection({
    name: "功法体系", schema: [{ name: "功法名", type: "string", required: true }], createdBy: "ai",
  });
  genreSectionsRepo.addItem(sec.id, { 功法名: "吞天诀" });

  // 章节摘要:1..6;currentChapterNo=7 时 recent=6/5/4,召回候选=1/2/3
  // 第 1 章 keyEvents 提到林尘 → 应被召回(角色重叠)
  chaptersRepo.saveSummary(summary(1, "林尘觉醒断剑", ["林尘"]));
  chaptersRepo.saveSummary(summary(2, "青玄登场", ["林尘"]));
  chaptersRepo.saveSummary(summary(3, "矿洞寻灵石", ["林尘"]));
  chaptersRepo.saveSummary(summary(4, "韩渊夜查", ["韩渊"]));
  chaptersRepo.saveSummary(summary(5, "逃出云岚宗", ["林尘"]));
  chaptersRepo.saveSummary(summary(6, "荒野遇袭", ["林尘"]));

  handle = {
    bookId: "test-book",
    bookMetaRepo, charactersRepo, outlineRepo, foreshadowingRepo,
    genreSectionsRepo, chaptersRepo,
    rulesMdPath: path.join(__dirname, "__no_such_rules__.md"),
  };
});

afterEach(() => {
  try { db.close(); } catch {}
});

describe("buildChapterWriteMessages(§6.1 防漂移上下文)", () => {
  it("注入设定/角色/题材板块/活跃伏笔/最近摘要/召回章节", () => {
    const { messages, recalledChapterNos, recentChapterNos } =
      buildChapterWriteMessages(handle, 7, "继续写第七章");
    const text = messages.map(m => (typeof m.content === "string" ? m.content : "")).join("\n");

    // 静态块
    expect(text).toContain("废脉少年得断剑重修"); // premise
    expect(text).toContain("林尘");                // 角色
    expect(text).toContain("功法体系");            // 题材专属板块
    expect(text).toContain("吞天诀");              // 板块条目
    expect(text).toContain("黑色碎片来历");        // 活跃伏笔

    // 动态块:最近 3 章 = 6/5/4
    expect(recentChapterNos.sort((a, b) => a - b)).toEqual([4, 5, 6]);
    expect(text).toContain("第 6 章");

    // 召回:第 1 章因角色重叠被捞回(currentChapterNo-3=4,候选 1/2/3)
    expect(recalledChapterNos).toContain(1);

    // 任务框架
    expect(text).toContain("第 7 章正文");
  });

  it("无召回命中时 recalledChapterNos 为空,但不报错", () => {
    // 主角不在任何旧章 keyEvents 里时召回应为空 —— 用一本只有设定无摘要的书
    const empty = { ...handle, chaptersRepo: { listSummaries: () => [] } };
    const { messages, recalledChapterNos, recentChapterNos } =
      buildChapterWriteMessages(empty, 1, "开篇");
    expect(recalledChapterNos).toEqual([]);
    expect(recentChapterNos).toEqual([]);
    expect(messages.length).toBeGreaterThan(0);
  });
});
