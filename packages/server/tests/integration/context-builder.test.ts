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
    // 分层后 user 消息按声明顺序拼接:核心设定在最前,用户指令在最后。
    expect(userMsgs[0]!.content).toContain("故事设定");
    const settingIdx = userMsgs.findIndex((m) => m.content.includes("故事设定"));
    const instructionIdx = userMsgs.findIndex((m) => m.content.includes("用户最新指令"));
    expect(instructionIdx).toBeGreaterThanOrEqual(0);
    // static(设定)必在 dynamic(用户指令)之前
    expect(settingIdx).toBeLessThan(instructionIdx);
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
    // 召回不应包含最近 10 章窗内的章节 (11-20)
    expect(r.recalledChapterNos.every((no) => no <= 10)).toBe(true);
    // recent 块覆盖第 11-20 章(无 chapterFiles 时,全 10 章都是 summary)
    expect(r.recentChapterNos).toEqual([20, 19, 18, 17, 16, 15, 14, 13, 12, 11]);
  });

  it("snapshot.recentFullChapters 注入后,对应章号小总结不再重复", () => {
    const fixture = new Map<number, { chapterNo: number; title: string; content: string }>();
    for (let n = 18; n <= 20; n++) {
      fixture.set(n, {
        chapterNo: n,
        title: `第 ${n} 章`,
        content: `[FULLTEXT-${n}] 这是第 ${n} 章正文,含有独特锚字符串。`,
      });
    }
    repos.chapterFiles = {
      list: () => [...fixture.values()],
      read: (no: number) => fixture.get(no),
    };
    const snap = loadBookSnapshot("b1", repos, paths);
    const r = buildWriteContext({
      snapshot: snap,
      currentChapterNo: 21,
      intent: { characters: [], foreshadowing: [], userMessage: "" },
      budgetTokens: 500_000,
    });
    const all = r.messages.slice(1).map((m) => m.content as string).join("\n");
    expect(all).toContain("[FULLTEXT-20]");
    expect(all).toContain("[FULLTEXT-19]");
    expect(all).toContain("[FULLTEXT-18]");
    // 这 3 章对应的小总结应被去重屏蔽(不出现 "这是第 18/19/20 章的段落摘要")
    expect(all).not.toContain("这是第 18 章的段落摘要");
    expect(all).not.toContain("这是第 19 章的段落摘要");
    expect(all).not.toContain("这是第 20 章的段落摘要");
  });

  it("midRangeSummaries(11-20 章前)注入 messages", () => {
    const snap = loadBookSnapshot("b1", repos, paths);
    const r = buildWriteContext({
      snapshot: snap,
      currentChapterNo: 21,
      intent: { characters: [], foreshadowing: [], userMessage: "" },
      budgetTokens: 500_000,
    });
    const all = r.messages.slice(1).map((m) => m.content as string).join("\n");
    // 第 1-10 章的 oneLiner 应出现(midRange 块)
    expect(all).toContain("第10章摘要");
    expect(all).toContain("第5章摘要");
    expect(all).toContain("第1章摘要");
    // 第 11-20 章也应作为 recent summary 出现
    expect(all).toContain("第20章摘要");
    expect(all).toContain("第11章摘要");
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
