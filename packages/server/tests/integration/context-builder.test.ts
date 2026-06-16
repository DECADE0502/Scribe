import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations/runner.js";
import { createCharactersRepo } from "../../src/db/repositories/characters.js";
import { createOutlineRepo } from "../../src/db/repositories/outline.js";
import { createForeshadowingRepo } from "../../src/db/repositories/foreshadowing.js";
import { createChaptersRepo } from "../../src/db/repositories/chapters.js";
import { createGenreSectionsRepo } from "../../src/db/repositories/genre-sections.js";
import { createBookMetaRepo } from "../../src/db/repositories/book-meta.js";
import {
  loadBookSnapshot,
  buildWriteContext,
} from "../../src/ai/context-builder/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let tmp: string, db: any, repos: any, paths: any;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scribe-cb-"));
  db = new Database(":memory:");
  const initSql = fs.readFileSync(
    path.join(__dirname, "../../src/db/migrations/workspace/001_init.sql"),
    "utf-8"
  );
  runMigrations(db, [{ name: "001_init.sql", sql: initSql }]);
  repos = {
    charactersRepo: createCharactersRepo(db),
    outlineRepo: createOutlineRepo(db),
    foreshadowingRepo: createForeshadowingRepo(db),
    chaptersRepo: createChaptersRepo(db),
    genreSectionsRepo: createGenreSectionsRepo(db),
    bookMetaRepo: createBookMetaRepo(db),
  };
  paths = { rulesMd: path.join(tmp, "rules.md") };

  // fixture: 主角 + 前提 + 20 章 summaries (部分含林尘 + 黑剑)
  repos.bookMetaRepo.set("title", "玄剑录");
  repos.bookMetaRepo.set("premise", "林尘修剑事");
  repos.bookMetaRepo.set("genre", "仙侠");
  fs.writeFileSync(paths.rulesMd, "## 风格\n\n禁用破折号。", "utf-8");
  repos.charactersRepo.create({
    name: "林尘",
    role: "protagonist",
    baseData: { background: "弃婴", motivation: "复仇", languageHabits: "简洁" },
    currentState: {},
  });
  repos.foreshadowingRepo.create({
    label: "黑剑",
    description: "出处不明",
    plantedChapter: 1,
    paidChapter: null,
    status: "active",
    relatedCharacters: ["林尘"],
  });
  const generic = repos.genreSectionsRepo.createSection({
    name: "任意集合",
    identityFields: ["代号"],
    displayFields: ["名称"],
    searchFields: ["代号", "名称", "摘要"],
    schema: [
      { name: "代号", type: "string", role: "identity", required: true },
      { name: "名称", type: "string", role: "label" },
      { name: "摘要", type: "text", role: "summary" },
    ],
    createdBy: "ai",
  });
  repos.genreSectionsRepo.addItem(generic.id, {
    代号: "A-1",
    名称: "一号",
    摘要: "重要可检索信息",
  });
  for (let i = 1; i <= 20; i++) {
    const chars = i % 3 === 0 ? ["林尘", "师妹"] : ["林尘"];
    const fos = i % 5 === 0 ? ["黑剑"] : [];
    repos.chaptersRepo.saveSummary({
      chapterNo: i,
      oneLiner: `第${i}章摘要`,
      paragraph: `这是第 ${i} 章的段落摘要。`.repeat(10),
      keyEvents: [
        { event: "事件", characters: chars, foreshadowingRefs: fos },
      ],
      generatedAt: i * 1000,
      reasoningContent: null,
    });
  }
});

afterEach(() => {
  try {
    db.close();
  } catch {}
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("buildWriteContext 集成", () => {
  it("messages 顺序: system → static → dynamic", () => {
    const snap = loadBookSnapshot("b1", repos, paths);
    const r = buildWriteContext({
      snapshot: snap,
      currentChapterNo: 21,
      intent: {
        characters: ["林尘"],
        foreshadowing: ["黑剑"],
        userMessage: "本章林尘下山",
      },
    });
    expect(r.messages[0]!.role).toBe("system");
    expect(typeof r.messages[0]!.content).toBe("string");
    expect(r.messages[0]!.content as string).toContain("Scribe");
    // user 消息至少 1 条; static 必在 dynamic 前
    const userMsgs = r.messages.slice(1) as Array<{
      role: "user";
      content: string;
    }>;
    expect(userMsgs.length).toBeGreaterThanOrEqual(1);
    if (userMsgs.length >= 2) {
      expect(userMsgs[0]!.content).toContain("故事设定");
      expect(userMsgs[1]!.content).toContain("用户最新指令");
    } else {
      // 仅 1 条: 必含两块的关键标记
      expect(userMsgs[0]!.content).toContain("故事设定");
    }
  });

  it("static 块包含 premise / rules / 角色 / 活跃伏笔", () => {
    const snap = loadBookSnapshot("b1", repos, paths);
    const r = buildWriteContext({
      snapshot: snap,
      currentChapterNo: 21,
      intent: { characters: [], foreshadowing: [], userMessage: "x" },
    });
    const allUser = r.messages
      .slice(1)
      .map((m) => m.content as string)
      .join("\n");
    expect(allUser).toContain("玄剑录");
    expect(allUser).toContain("林尘修剑事");
    expect(allUser).toContain("禁用破折号");
    expect(allUser).toContain("林尘");
    expect(allUser).toContain("[黑剑]");
  });

  it("static 块按通用记录声明渲染记录集合", () => {
    const snap = loadBookSnapshot("b1", repos, paths);
    const r = buildWriteContext({
      snapshot: snap,
      currentChapterNo: 21,
      intent: { characters: [], foreshadowing: [], userMessage: "x" },
    });
    const allUser = r.messages
      .slice(1)
      .map((m) => m.content as string)
      .join("\n");

    expect(allUser).toContain("任意集合");
    expect(allUser).toContain("identity:代号");
    expect(allUser).toContain("display:名称");
    expect(allUser).toContain("A-1");
    expect(allUser).toContain("重要可检索信息");
  });

  it("dynamic 块含最近 3 章 + 召回 + 用户指令", () => {
    const snap = loadBookSnapshot("b1", repos, paths);
    const r = buildWriteContext({
      snapshot: snap,
      currentChapterNo: 21,
      intent: {
        characters: ["林尘"],
        foreshadowing: ["黑剑"],
        userMessage: "本章高潮",
        chapterPlan: "开场情境:山顶",
      },
    });
    const allUser = r.messages
      .slice(1)
      .map((m) => m.content as string)
      .join("\n");
    expect(allUser).toContain("最近");
    expect(allUser).toContain("第 20 章");
    expect(allUser).toContain("第 19 章");
    expect(allUser).toContain("第 18 章");
    expect(allUser).toContain("相关历史章节");
    expect(allUser).toContain("本章计划");
    expect(allUser).toContain("开场情境:山顶");
    expect(allUser).toContain("本章高潮");
    // 召回不应包含最近 3 章 (18/19/20)
    expect(r.recalledChapterNos.every((no) => no <= 17)).toBe(true);
    expect(r.recentChapterNos).toEqual([20, 19, 18]);
  });

  it("budgetTokens 极小时 dynamic 被丢或裁", () => {
    const snap = loadBookSnapshot("b1", repos, paths);
    const r = buildWriteContext({
      snapshot: snap,
      currentChapterNo: 21,
      intent: { characters: [], foreshadowing: [], userMessage: "x" },
      budgetTokens: 200, // 极小
    });
    // 至少 system + 0 或 1 个 user
    expect(r.messages.length).toBeGreaterThanOrEqual(1);
    expect(r.usedTokens).toBeLessThanOrEqual(200 + 50); // 允许微小估算偏差
    expect(r.droppedSectionIds.length).toBeGreaterThan(0);
  });

  it("空 intent 也能生成 prompt (用户什么都没说)", () => {
    const snap = loadBookSnapshot("b1", repos, paths);
    const r = buildWriteContext({
      snapshot: snap,
      currentChapterNo: 21,
      intent: { characters: [], foreshadowing: [], userMessage: "" },
    });
    expect(r.messages[0]!.role).toBe("system");
    const allUser = r.messages
      .slice(1)
      .map((m) => m.content as string)
      .join("\n");
    expect(allUser).toContain("(用户未明确说");
  });
});
