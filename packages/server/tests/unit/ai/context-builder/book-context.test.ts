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
import {
  buildChapterAuditContext,
  buildChapterWriteMessages,
  detectMissingRequiredSections,
  enrichUserIntentWithOutline,
  extractRequiredOutputSections,
  findChapterOutlineNode,
  resolveChapterTitle,
  findChapterOutlineSummary,
  renderCharacterStateContinuity,
  renderHardContinuityConstraints,
  renderTimelineContinuity,
} from "../../../../src/ai/context-builder/book-context.js";

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
    name: "通用记录",
    identityFields: ["代号"],
    displayFields: ["名称"],
    searchFields: ["代号", "名称"],
    schema: [
      { name: "代号", type: "string", required: true, role: "identity" },
      { name: "名称", type: "string", role: "label" },
    ],
    createdBy: "ai",
  });
  genreSectionsRepo.addItem(sec.id, { 代号: "A-1", 名称: "一号" });

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

describe("hard continuity constraints", () => {
  it("promotes recent resource availability into hard constraints", () => {
    // 动态词表:从测试数据里提取的关键词
    const dynamicTerms = new Set(["宠物球", "SP", "服从度", "林远", "王建国", "魔物"]);
    const constraints = renderHardContinuityConstraints([
      {
        chapterNo: 8,
        oneLiner: "林远追踪隐藏标记金色目标。",
        paragraph: "林远发现自身SP仅7，无宠物球可用，D级魔物仍在整合中，王建国服从度12.8。",
        keyEvents: [],
      },
    ], dynamicTerms);

    expect(constraints).toContain("Hard Continuity Constraints");
    expect(constraints).toContain("无宠物球可用");
    expect(constraints).toContain("SP仅7");
  });
});

describe("chapter outline matching", () => {
  it("matches the exact chapter node and does not treat chapter 10 as chapter 1", () => {
    const outlineRepo = {
      listAll: () => [
        {
          id: "ch10",
          parentId: null,
          level: "chapter" as const,
          title: "第10章 旧敌回归",
          summary: "只能给第十章使用",
          status: "planned" as const,
          sortOrder: 10,
          metadata: null,
        },
        {
          id: "ch1",
          parentId: null,
          level: "chapter" as const,
          title: "第1章 雨夜开局",
          summary: "第一章必须写主角在雨夜收到信",
          status: "planned" as const,
          sortOrder: 1,
          metadata: null,
        },
      ],
    };

    expect(findChapterOutlineNode(outlineRepo, 1)?.id).toBe("ch1");
    expect(findChapterOutlineSummary(outlineRepo, 1)).toBe("第一章必须写主角在雨夜收到信");
    // resolveChapterTitle:用大纲真标题,匹配章号(回归 #章节标题占位符)
    expect(resolveChapterTitle(outlineRepo, 1)).toBe("第1章 雨夜开局");
    expect(resolveChapterTitle(outlineRepo, 10)).toBe("第10章 旧敌回归");
    // 没有对应大纲节点 → 回退占位符
    expect(resolveChapterTitle(outlineRepo, 3)).toBe("第 3 章");
  });

  it("does not fall back to arc text when a chapter node is missing", () => {
    const outlineRepo = {
      listAll: () => [
        {
          id: "arc1",
          parentId: null,
          level: "arc" as const,
          title: "第一卷前半弧",
          summary: "这是弧线方向，不是第二章的精确正文安排",
          status: "planned" as const,
          sortOrder: 1,
          metadata: null,
        },
      ],
    };

    expect(findChapterOutlineNode(outlineRepo, 2)).toBeUndefined();
    expect(enrichUserIntentWithOutline(outlineRepo, 2, "继续写")).toBe("继续写");
  });

  it("injects a strict chapter-level outline block with title and required writing instruction", () => {
    const outlineRepo = {
      listAll: () => [
        {
          id: "ch2",
          parentId: null,
          level: "chapter" as const,
          title: "Chapter 2 - Lantern Market",
          summary: "本章写灯市重逢、误会解除、结尾收到黑笺",
          status: "planned" as const,
          sortOrder: 2,
          metadata: null,
        },
      ],
    };

    const enriched = enrichUserIntentWithOutline(outlineRepo, 2, "按计划写");

    expect(enriched).toContain("# 本章精确大纲");
    expect(enriched).toContain("目标章节: 第 2 章");
    expect(enriched).toContain("大纲标题: Chapter 2 - Lantern Market");
    expect(enriched).toContain("本章必须写: 本章写灯市重逢、误会解除、结尾收到黑笺");
    expect(enriched).toContain("必须优先服从这里的章级大纲");
  });
});

describe("hard continuity timer/resource facts", () => {
  it("renders deadlines and resource counts as hard continuity constraints", () => {
    const dynamicTerms = new Set(["捕捉球", "阵营", "契约", "状态栏", "系统"]);
    const constraints = renderHardContinuityConstraints([
      {
        chapterNo: 8,
        oneLiner: "阵营选择将在48小时后强制触发，普通捕捉球已经用尽。",
        paragraph: "主角确认普通捕捉球已经用尽，只剩旧契约还能维持。",
        keyEvents: [],
      },
      {
        chapterNo: 9,
        oneLiner: "距离阵营选择还剩约36小时，获得1枚高级捕捉球。",
        paragraph: "系统状态栏刷新：高级捕捉球1枚，普通捕捉球0枚。",
        keyEvents: [],
      },
    ], dynamicTerms);

    expect(constraints).toContain("48小时");
    expect(constraints).toContain("36小时");
    expect(constraints).toContain("普通捕捉球已经用尽");
    expect(constraints).toContain("高级捕捉球");
  });
});

describe("structured and timeline hard continuity", () => {
  it("renders latest character inventory state as hard facts", () => {
    const constraints = renderCharacterStateContinuity([
      {
        name: "林澈",
        currentState: {
          inventory: { normalCaptureBalls: 2, brokenCaptureBalls: 1, sp: 89, hp: 100 },
          contracts: [],
          location: "便利店",
        },
      } as never,
    ]);

    expect(constraints).toContain("Current Structured State");
    expect(constraints).toContain('"normalCaptureBalls":2');
    expect(constraints).toContain('"sp":89');
  });

  it("renders resource-changing timeline events as hard facts", () => {
    const dynamicTerms = new Set(["捕捉球", "SP", "林澈"]);
    const constraints = renderTimelineContinuity([
      {
        id: "event-1",
        chapterNo: 1,
        storyTime: "凌晨三点半",
        event: "林澈首次捕捉失败，一颗捕捉球损毁，SP降至89",
        participants: ["林澈"],
      },
    ], dynamicTerms);

    expect(constraints).toContain("Timeline Hard Facts");
    expect(constraints).toContain("一颗捕捉球损毁");
    expect(constraints).toContain("SP降至89");
  });

  it("injects structured and timeline continuity into chapter write messages", () => {
    handle.charactersRepo.create({
      name: "林澈",
      role: "protagonist",
      currentState: {
        inventory: { normalCaptureBalls: 2, brokenCaptureBalls: 1, sp: 89, hp: 100 },
        contracts: [],
      },
    });
    handle.timelineRepo = {
      listAll: () => [{
        id: "event-1",
        chapterNo: 1,
        storyTime: "凌晨三点半",
        event: "林澈首次捕捉失败，一颗捕捉球损毁，SP降至89",
        participants: ["林澈"],
      }],
    };

    const result = buildChapterWriteMessages(handle as never, 2, "继续第2章");
    const text = result.messages.map((message) => String(message.content)).join("\n");

    expect(text).toContain("Current Structured State");
    expect(text).toContain('"normalCaptureBalls":2');
    expect(text).toContain("Timeline Hard Facts");
    expect(text).toContain("SP降至89");
  });

  it("injects the selected global style reference into chapter write messages", () => {
    handle.bookMetaRepo.set("style_reference_id", "style-soft");

    const result = buildChapterWriteMessages(
      handle as never,
      2,
      "继续第二章",
      undefined,
      [
        { id: "style-soft", name: "柔和散文", content: "句子舒缓,少用口号式总结。" },
        { id: "style-hard", name: "冷硬纪实", content: "动作清楚。" },
      ],
    );
    const text = result.messages.map((message) => String(message.content)).join("\n");

    expect(text).toContain("## 文风参考");
    expect(text).toContain("柔和散文");
    expect(text).toContain("句子舒缓");
    expect(text).not.toContain("冷硬纪实");
  });
});

describe("required output sections", () => {
  it("extracts status bar requirements from imported preset blocks", () => {
    const constraints = extractRequiredOutputSections([
      { content: "每章结尾必须输出状态栏，包含HP、SP、契约、捕捉球数量。" },
      { content: "普通叙事要求。" },
    ]);

    expect(constraints).toContainEqual(expect.objectContaining({
      kind: "status_section",
      requiredTerms: expect.arrayContaining(["HP", "SP", "契约", "捕捉球"]),
    }));
  });

  it("does not promote unrelated preset terms into status requirements", () => {
    const constraints = extractRequiredOutputSections([
      { content: "每章结尾必须输出状态栏，包含HP、契约、捕捉球数量。" },
      { content: "其他规则可能讨论MP、等级、技能树，但不是状态栏必填字段。" },
    ]);

    // 动态提取:HP(大写)、契约(包含列表)、捕捉球(包含列表)、状态栏(触发词)
    // 不再硬编码词表;MP/等级/技能树被排除因为它们在"不是"行里
    expect(constraints[0]?.requiredTerms).toEqual(expect.arrayContaining(["HP", "契约", "捕捉球"]));
    expect(constraints[0]?.requiredTerms).not.toContain("MP");
    expect(constraints[0]?.requiredTerms).not.toContain("等级");
  });

  it("detects missing required status terms in generated prose", () => {
    const missing = detectMissingRequiredSections("状态栏：HP 10/10，SP 3/4。", [
      {
        kind: "status_section",
        label: "状态栏",
        requiredTerms: ["HP", "SP", "契约", "捕捉球"],
        source: "preset",
      },
    ]);

    expect(missing).toEqual(["状态栏 missing required terms: 契约, 捕捉球"]);
  });
});

describe("buildChapterAuditContext", () => {
  it("builds dynamic audit context with recent and recalled summaries", () => {
    const { auditCtx, recentChapterNos, recalledChapterNos } =
      buildChapterAuditContext(handle, 7, "continue chapter seven");

    expect(recentChapterNos.sort((a, b) => a - b)).toEqual([4, 5, 6]);
    expect(auditCtx.recentSummaries?.map((s) => s.chapterNo).sort((a, b) => a - b))
      .toEqual([4, 5, 6]);
    expect(recalledChapterNos).toContain(1);
    expect(auditCtx.recalledSummaries?.map((s) => s.chapterNo)).toContain(1);
    expect(auditCtx.premise).toBeTruthy();
    expect(auditCtx.characters?.length).toBeGreaterThan(0);
  });
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
    expect(text).toContain("通用记录");            // 通用记录集合
    expect(text).toContain("A-1");                 // 记录条目
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

  it("召回聚焦续写上下文,不把无关角色的旧章一并捞回(§6.1 退化修复)", () => {
    // 另起一本:最近一章只涉及林尘;旧章 ch1 只涉及韩渊、ch2 只涉及林尘。
    const db2 = new Database(":memory:");
    const initSql = fs.readFileSync(
      path.join(__dirname, "../../../../src/db/migrations/workspace/001_init.sql"),
      "utf-8",
    );
    runMigrations(db2, [{ name: "001_init.sql", sql: initSql }]);
    const meta = createBookMetaRepo(db2);
    const chars = createCharactersRepo(db2);
    const chap = createChaptersRepo(db2);
    meta.set("title", "测试"); meta.set("premise", "x");
    chars.create({ name: "林尘", role: "protagonist", baseData: {}, currentState: {} });
    chars.create({ name: "韩渊", role: "antagonist", baseData: {}, currentState: {} });
    chap.saveSummary(summary(1, "韩渊单独行动", ["韩渊"]));   // 候选,但与续写无关
    chap.saveSummary(summary(2, "林尘旧事", ["林尘"]));        // 候选,且相关
    chap.saveSummary(summary(3, "过渡", ["林尘"]));            // 候选
    chap.saveSummary(summary(4, "近", ["林尘"]));
    chap.saveSummary(summary(5, "近", ["林尘"]));
    chap.saveSummary(summary(6, "最新只涉及林尘", ["林尘"]));  // latest → 聚焦 [林尘]

    const h2 = {
      bookId: "b2", bookMetaRepo: meta, charactersRepo: chars,
      outlineRepo: createOutlineRepo(db2), foreshadowingRepo: createForeshadowingRepo(db2),
      genreSectionsRepo: createGenreSectionsRepo(db2), chaptersRepo: chap,
      rulesMdPath: path.join(__dirname, "__none__.md"),
    };
    // currentChapter=7 → cutoff=4 → 候选 ch1/2/3
    const { recalledChapterNos } = buildChapterWriteMessages(h2 as any, 7, "继续");
    expect(recalledChapterNos).toContain(2);     // 林尘相关 → 捞回
    expect(recalledChapterNos).not.toContain(1); // 韩渊(与续写无关)→ 不捞回
    db2.close();
  });

  it("用户指令点名通用记录实体时召回相关旧章", () => {
    handle.chaptersRepo.saveSummary({
      chapterNo: 0,
      oneLiner: "A-1 的旧线索",
      paragraph: "A-1 曾经在这里留下重要伏线。",
      keyEvents: [{ event: "A-1 留下伏线", characters: [], foreshadowingRefs: [] }],
      generatedAt: 1,
      reasoningContent: null,
    });

    const { recalledChapterNos } = buildChapterWriteMessages(
      handle,
      7,
      "这一章继续处理 A-1",
    );

    expect(recalledChapterNos).toContain(0);
  });
});
