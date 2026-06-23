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

  it("通用记录块只露 label + summary,schema 描述不进写作 prompt", () => {
    const snap = loadBookSnapshot("b1", repos, paths);
    const r = buildWriteContext({
      snapshot: snap,
      currentChapterNo: 21,
      intent: { characters: [], foreshadowing: [], userMessage: "x" },
      budgetTokens: 500_000,
    });
    const allUser = r.messages
      .slice(1)
      .map((m) => m.content as string)
      .join("\n");

    expect(allUser).toContain("任意集合");
    expect(allUser).toContain("一号"); // label(显示名)
    expect(allUser).toContain("重要可检索信息"); // summary
    // 噪声税:schema 字样不进写作 prompt
    expect(allUser).not.toMatch(/identity:/);
    expect(allUser).not.toMatch(/display:/);
    expect(allUser).not.toMatch(/searchFields/);
  });

  it("character 块只露 currentState,不露 baseData 背景/动机/语言习惯", () => {
    // 给主角设个 currentState 以确认正向用例(否则 currentState={} 时 block 整体不出)
    const linchen = repos.charactersRepo.list().find((c: any) => c.name === "林尘")!;
    repos.charactersRepo.update(linchen.id, { currentState: { 位置: "山顶神庙", 持物: "黑剑" } });
    const snap = loadBookSnapshot("b1", repos, paths);
    const r = buildWriteContext({
      snapshot: snap,
      currentChapterNo: 21,
      intent: { characters: [], foreshadowing: [], userMessage: "" },
      budgetTokens: 500_000,
    });
    const allUser = r.messages.slice(1).map((m) => m.content as string).join("\n");
    // 当下状态出
    expect(allUser).toContain("山顶神庙");
    expect(allUser).toContain("黑剑");
    // baseData 不出(背景"弃婴" / 动机"复仇" / 语言"简洁")
    expect(allUser).not.toContain("弃婴");
    expect(allUser).not.toContain("复仇");
    expect(allUser).not.toMatch(/语言:简洁/);
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

  it("arc 全脱出 20 章窗时,塞 ArcSummary;窗内章节用小总结", () => {
    // 扩 fixture: 加 ch 21-30。outline: 卷 1 > 弧 A(ch 1-3, summary="弧 A 总结") + 弧 B(ch 4-30)
    for (let i = 21; i <= 30; i++) {
      repos.chaptersRepo.saveSummary({
        chapterNo: i,
        oneLiner: `第${i}章摘要`,
        paragraph: `这是第 ${i} 章的段落摘要。`.repeat(10),
        keyEvents: [],
        generatedAt: i * 1000,
        reasoningContent: null,
      });
    }
    const vol = repos.outlineRepo.create({ parentId: null, level: "volume", title: "卷 1", summary: null, status: "done", sortOrder: 0, metadata: null });
    const arcA = repos.outlineRepo.create({ parentId: vol.id, level: "arc", title: "弧 A", summary: "弧 A 总结-唯一锚", status: "done", sortOrder: 0, metadata: null });
    const arcB = repos.outlineRepo.create({ parentId: vol.id, level: "arc", title: "弧 B", summary: null, status: "in_progress", sortOrder: 1, metadata: null });
    for (let i = 1; i <= 3; i++) {
      repos.outlineRepo.create({ parentId: arcA.id, level: "chapter", title: `章 ${i}`, summary: null, status: "done", sortOrder: i, metadata: { chapterNo: i } });
    }
    for (let i = 4; i <= 30; i++) {
      repos.outlineRepo.create({ parentId: arcB.id, level: "chapter", title: `章 ${i}`, summary: null, status: "done", sortOrder: i, metadata: { chapterNo: i } });
    }
    // currentChapterNo=31 → windowFloor=11。弧 A(ch 1-3)全脱出窗、有 summary → 用 ArcSummary。
    const snap = loadBookSnapshot("b1", repos, paths);
    const r = buildWriteContext({
      snapshot: snap, currentChapterNo: 31,
      intent: { characters: [], foreshadowing: [], userMessage: "" },
      budgetTokens: 500_000,
    });
    const all = r.messages.slice(1).map((m) => m.content as string).join("\n");
    expect(all).toContain("弧 A 总结-唯一锚");
    // 弧 B 仍部分在窗(ch 11-30),不应被 ArcSummary 化(且其 summary 也为 null)
    // 窗内章应有小总结(第 11、20 章是 midRange 范畴)
    expect(all).toContain("第11章摘要");
    expect(all).toContain("第20章摘要");
  });

  it("arc 部分脱出窗时,不用 ArcSummary,只用小总结(窗外章被屏蔽)", () => {
    // 加 ch 21-25。outline: 卷 1 > 弧 A(ch 1-15, summary='不该出现的弧 A 总结')
    for (let i = 21; i <= 25; i++) {
      repos.chaptersRepo.saveSummary({
        chapterNo: i, oneLiner: `第${i}章摘要`,
        paragraph: `这是第 ${i} 章的段落摘要。`.repeat(10),
        keyEvents: [], generatedAt: i * 1000, reasoningContent: null,
      });
    }
    const vol = repos.outlineRepo.create({ parentId: null, level: "volume", title: "卷 1", summary: null, status: "done", sortOrder: 0, metadata: null });
    const arcA = repos.outlineRepo.create({ parentId: vol.id, level: "arc", title: "弧 A", summary: "不该出现的弧 A 总结", status: "done", sortOrder: 0, metadata: null });
    const arcB = repos.outlineRepo.create({ parentId: vol.id, level: "arc", title: "弧 B", summary: null, status: "in_progress", sortOrder: 1, metadata: null });
    for (let i = 1; i <= 15; i++) {
      repos.outlineRepo.create({ parentId: arcA.id, level: "chapter", title: `章 ${i}`, summary: null, status: "done", sortOrder: i, metadata: { chapterNo: i } });
    }
    for (let i = 16; i <= 25; i++) {
      repos.outlineRepo.create({ parentId: arcB.id, level: "chapter", title: `章 ${i}`, summary: null, status: "done", sortOrder: i, metadata: { chapterNo: i } });
    }
    // currentChapterNo=26 → windowFloor=6。弧 A(1-15)部分脱出:1-5 出窗、6-15 在窗 → 不用 ArcSummary。
    const snap = loadBookSnapshot("b1", repos, paths);
    const r = buildWriteContext({
      snapshot: snap, currentChapterNo: 26,
      intent: { characters: [], foreshadowing: [], userMessage: "" },
      budgetTokens: 500_000,
    });
    const all = r.messages.slice(1).map((m) => m.content as string).join("\n");
    expect(all).not.toContain("不该出现的弧 A 总结");
    // 第 6 章(窗内 arc A 章)应作为小总结出现
    expect(all).toContain("第6章摘要");
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

  it("POV 连续性:第 21 章 prompt 必含第 20/19/18 章全文(POV/腔调锚)", () => {
    const fixture = new Map<number, { chapterNo: number; title: string; content: string }>();
    fixture.set(18, { chapterNo: 18, title: "第 18 章", content: "[POV-18] 我推开神庙大门,冷风扑面而来。「第一人称」锚。\n\n接下来……" });
    fixture.set(19, { chapterNo: 19, title: "第 19 章", content: "[POV-19] 我握紧黑剑,不退反进。继续第一人称叙述。" });
    fixture.set(20, { chapterNo: 20, title: "第 20 章", content: "[POV-20] 我和她一前一后跃下深渊。叙事契约未变。" });
    repos.chapterFiles = { list: () => [...fixture.values()], read: (no: number) => fixture.get(no) };
    const snap = loadBookSnapshot("b1", repos, paths);
    const r = buildWriteContext({
      snapshot: snap,
      currentChapterNo: 21,
      intent: { characters: [], foreshadowing: [], userMessage: "继续第 21 章" },
      budgetTokens: 500_000,
    });
    const all = r.messages.slice(1).map((m) => m.content as string).join("\n");
    // 最近 3 章全文应出现在 prompt(紧贴任务指令前)
    expect(all).toContain("[POV-20]");
    expect(all).toContain("[POV-19]");
    expect(all).toContain("[POV-18]");
    // 已全文覆盖的章号不应再以摘要形式重复
    expect(all).not.toContain("这是第 18 章的段落摘要");
    expect(all).not.toContain("这是第 19 章的段落摘要");
    expect(all).not.toContain("这是第 20 章的段落摘要");
    // 核心设定在最前,用户指令在最后(recent-full 在两者之间)
    const settingIdx = all.indexOf("故事设定");
    const fullIdx = all.indexOf("[POV-20]");
    const instructionIdx = all.indexOf("用户最新指令");
    expect(settingIdx).toBeLessThan(fullIdx);
    expect(fullIdx).toBeLessThan(instructionIdx);
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
