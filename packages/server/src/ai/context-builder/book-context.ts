import * as fs from "node:fs";
import type { CoreMessage } from "ai";
import type { ChapterSummary, Character, TimelineEvent } from "@scribe/shared";
import {
  resolveItemIdentityKey,
  resolveItemLabel,
  resolveItemSearchText,
} from "@scribe/shared";
import type { BookHandle } from "../../http/book-registry.js";
import type { WriteChapterContext } from "../prompts/write-chapter.js";
import type { AuditContext } from "../orchestrator/audit-chapter.js";
import { loadBookSnapshot } from "./snapshot.js";
import { buildWriteContext, type BuildResult } from "./builder.js";

export interface BookPromptContext {
  writeCtx: Partial<WriteChapterContext>;
  auditCtx: Partial<Omit<AuditContext, "chapterNo" | "chapterContent">>;
}

/**
 * 从书的持久化数据组装 写作/审查 上下文(B-5-001 修复)。
 * 这是 LLM 写作不跑题的关键:premise、调性、角色卡、大纲、规则全部进 prompt。
 */
export function buildBookPromptContext(handle: BookHandle): BookPromptContext {
  const meta = Object.fromEntries(handle.bookMetaRepo.list().map(r => [r.key, r.value]));
  const characters = handle.charactersRepo.list();
  const outline = handle.outlineRepo.listAll();
  const activeForeshadowing = handle.foreshadowingRepo.list("active");
  const rulesMd = fs.existsSync(handle.rulesMdPath)
    ? fs.readFileSync(handle.rulesMdPath, "utf-8")
    : "";

  const premiseParts: string[] = [];
  if (meta.premise) premiseParts.push(meta.premise);
  if (meta.genre) premiseParts.push(`题材:${meta.genre}`);
  if (meta.tone) premiseParts.push(`调性:${meta.tone}`);
  const premise = premiseParts.join("\n");

  const charactersText = characters.map(c => {
    const b = (c.baseData ?? {}) as Record<string, unknown>;
    const parts: string[] = [`${c.name}(${c.role === "protagonist" ? "主角" : c.role === "antagonist" ? "反派" : "配角"})`];
    if (typeof b.background === "string") parts.push(`背景:${b.background}`);
    if (typeof b.motivation === "string") parts.push(`动机:${b.motivation}`);
    if (typeof b.languageHabits === "string") parts.push(`语言习惯:${b.languageHabits}`);
    return parts.join(" / ");
  }).join("\n");

  const outlineText = outline
    .filter(n => n.level === "volume" || n.level === "arc")
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(n => `[${n.level === "volume" ? "卷" : "弧"}] ${n.title}${n.summary ? `:${n.summary}` : ""}`)
    .join("\n");

  return {
    writeCtx: {
      premise,
      rules: rulesMd || undefined,
      characters: charactersText || undefined,
      outlineThis: outlineText || undefined,
    },
    auditCtx: {
      premise: meta.premise,
      tone: meta.tone,
      rulesMd: rulesMd || undefined,
      characters: characters.map(c => ({
        name: c.name,
        baseData: c.baseData,
        currentState: c.currentState,
      })),
      activeForeshadowing: activeForeshadowing.map(f => ({
        label: f.label,
        description: f.description,
        status: f.status,
      })),
    },
  };
}

export interface ChapterWriteContext {
  messages: CoreMessage[];
  recalledChapterNos: number[];
  recentChapterNos: number[];
  diagnostics?: BuildResult["diagnostics"];
}

export interface ChapterAuditPromptContext {
  auditCtx: Partial<Omit<AuditContext, "chapterNo" | "chapterContent">>;
  recalledChapterNos: number[];
  recentChapterNos: number[];
}

export interface RequiredOutputSection {
  kind: "status_section";
  label: string;
  requiredTerms: string[];
  source: "preset" | "worldbook" | "scribe";
}

export function extractRequiredOutputSections(
  blocks: Array<{ content: string }>,
): RequiredOutputSection[] {
  const joined = blocks
    .map((block) => block.content)
    .join("\n");
  if (!/(状态栏|狀態欄|status\s*bar|面板)/i.test(joined)) return [];
  const statusLines = joined
    .split(/\r?\n|[。！？]/)
    .map((line) => line.trim())
    .filter((line) => /(状态栏|狀態欄|status\s*bar|面板)/i.test(line))
    .filter((line) => /(必须|必須|必填|包含|包括|输出|輸出|格式|字段|欄位|include|required)/i.test(line))
    .filter((line) => !/(不是|无需|無需|不必|不要|非必填|not required)/i.test(line));
  const sourceText = statusLines.join("\n") || joined;
  const requiredTerms = ["HP", "SP", "MP", "契约", "捕捉球", "等级", "时间", "倒计时"]
    .filter((term) => sourceText.includes(term) || new RegExp(term, "i").test(sourceText));
  return [{
    kind: "status_section",
    label: "状态栏",
    requiredTerms: requiredTerms.length ? requiredTerms : ["状态栏"],
    source: "preset",
  }];
}

export function renderRequiredOutputSections(sections: RequiredOutputSection[]): string {
  if (!sections.length) return "";
  return [
    "## Required Output Sections",
    ...sections.map((section) =>
      `- ${section.label} is required by imported ${section.source}. It must appear as diegetic novel text and include: ${section.requiredTerms.join(", ")}.`,
    ),
  ].join("\n");
}

export function detectMissingRequiredSections(
  text: string,
  sections: RequiredOutputSection[],
): string[] {
  return sections
    .filter((section) => section.kind === "status_section")
    .map((section) => ({
      section,
      missingTerms: section.requiredTerms.filter((term) => !text.includes(term)),
    }))
    .filter(({ missingTerms }) => missingTerms.length > 0)
    .map(({ section, missingTerms }) =>
      `${section.label} missing required terms: ${missingTerms.join(", ")}`,
    );
}

const HARD_CONTINUITY_PATTERNS = [
  /无[^。！？\n]{0,24}(?:可用|剩余|持有|库存|宠物球|普通球)/,
  /(?:宠物球|普通球|契约|状态栏|HP|SP|服从度|好感度|成功率|剩余|库存|持有|代价|冷却|整合)[^。！？\n]{0,48}/,
  /[^。！？\n]{0,24}(?:仅|只剩|剩余|没有|不能|无法)[^。！？\n]{0,48}/,
];

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？!?])|\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

const HARD_STATE_TERMS = [
  "\u5ba0\u7269\u7403",
  "\u666e\u901a\u7403",
  "\u9ad8\u7ea7\u7403",
  "\u6355\u6349\u7403",
  "\u5951\u7ea6",
  "\u72b6\u6001\u680f",
  "\u9635\u8425",
  "\u5f3a\u5236\u89e6\u53d1",
  "\u5012\u8ba1\u65f6",
  "\u5c0f\u65f6",
  "\u5929\u540e",
  "\u65f6\u95f4",
  "HP",
  "SP",
  "MP",
  "\u670d\u4ece\u5ea6",
  "\u597d\u611f\u5ea6",
  "\u6210\u529f\u7387",
  "\u5269\u4f59",
  "\u8fd8\u5269",
  "\u8ddd\u79bb",
  "\u5e93\u5b58",
  "\u6301\u6709",
  "\u4ee3\u4ef7",
  "\u51b7\u5374",
  "\u6574\u5408",
  "\u83b7\u5f97",
  "\u7528\u5c3d",
];

const HARD_NEGATION_TERMS = [
  "\u65e0",
  "\u6ca1\u6709",
  "\u4e0d\u80fd",
  "\u65e0\u6cd5",
  "\u4ec5",
  "\u53ea\u5269",
];

function isHardContinuitySentence(sentence: string): boolean {
  const hasStateTerm = HARD_STATE_TERMS.some((term) => sentence.includes(term));
  if (!hasStateTerm) return false;
  return (
    /[0-9]/.test(sentence) ||
    HARD_NEGATION_TERMS.some((term) => sentence.includes(term)) ||
    sentence.includes("\u53ef\u7528") ||
    sentence.includes("\u5269\u4f59") ||
    sentence.includes("\u8fd8\u5269") ||
    sentence.includes("\u83b7\u5f97") ||
    sentence.includes("\u7528\u5c3d")
  );
}

export function renderHardContinuityConstraints(
  summaries: Pick<ChapterSummary, "chapterNo" | "oneLiner" | "paragraph" | "keyEvents">[],
): string {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const summary of summaries) {
    const candidates = [
      summary.oneLiner,
      ...splitSentences(summary.paragraph),
      ...summary.keyEvents.flatMap((event) => splitSentences(event.event)),
    ];
    for (const sentence of candidates) {
      if (!isHardContinuitySentence(sentence)) continue;
      const normalized = sentence.replace(/\s+/g, " ").trim();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      lines.push(`- Chapter ${summary.chapterNo}: ${normalized}`);
      if (lines.length >= 12) break;
    }
    if (lines.length >= 12) break;
  }
  if (!lines.length) return "";
  return [
    "## Hard Continuity Constraints",
    "Treat these as current hard facts. Do not contradict resource counts, timers, deadlines, availability, status values, contracts, inventory, or cooldowns unless the chapter explicitly shows the cause of the change.",
    ...lines,
  ].join("\n");
}

export function renderCharacterStateContinuity(
  characters: Pick<Character, "name" | "currentState">[],
): string {
  const lines = characters
    .map((character) => {
      const state = character.currentState;
      if (!state || Object.keys(state).length === 0) return "";
      return `- ${character.name}: ${JSON.stringify(state)}`;
    })
    .filter(Boolean)
    .slice(0, 8);
  if (!lines.length) return "";
  return [
    "## Current Structured State",
    "Treat this as the latest durable state. Do not contradict inventory, contracts, location, time, tasks, HP, SP, or status values unless the chapter explicitly shows the cause of the change.",
    ...lines,
  ].join("\n");
}

export function renderTimelineContinuity(events: TimelineEvent[]): string {
  const lines = events
    .filter((event) => isHardContinuitySentence(event.event))
    .slice(-12)
    .map((event) => `- Chapter ${event.chapterNo}${event.storyTime ? ` ${event.storyTime}` : ""}: ${event.event}`);
  if (!lines.length) return "";
  return [
    "## Timeline Hard Facts",
    "These are recorded timeline facts. Preserve resource changes, deadlines, locations, status values, and contract outcomes.",
    ...lines,
  ].join("\n");
}

function extractMessageBlock(messages: CoreMessage[], heading: string): string | undefined {
  const text = messages.map((message) => String(message.content)).join("\n");
  const start = text.indexOf(heading);
  if (start < 0) return undefined;
  const rest = text.slice(start + heading.length).trimStart();
  const nextHeading = rest.search(/\n## /);
  return (nextHeading >= 0 ? rest.slice(0, nextHeading) : rest).trim() || undefined;
}

/**
 * 召回意图 = "本章紧接着什么"。spec §6.1.1 的召回是按"本章涉及的角色/伏笔"与
 * 旧章重叠度排序;若把全部角色都塞进 intent,等于按"出场人数"排序,失去相关性。
 *
 * 因此聚焦到续写上下文:
 * - 最近一章(若有)keyEvents 里出现的角色 / 伏笔(承接的线索)
 * - userIntent 文本里点名提到的角色名 / 活跃伏笔标签(用户的明确指向)
 * 二者并集为空时(如全书第一章),回退到全部 —— 此时召回本就无历史可捞。
 */
function deriveRecallIntent(
  snapshot: ReturnType<typeof loadBookSnapshot>,
  userIntent: string,
): { characters: string[]; foreshadowing: string[]; records: string[] } {
  const chars = new Set<string>();
  const fore = new Set<string>();
  const records = new Set<string>();

  const latest = snapshot.recentSummaries[0]; // recentSummaries 按 chapterNo desc
  const latestText = latest
    ? [
        latest.oneLiner,
        latest.paragraph,
        ...latest.keyEvents.flatMap((ev) => [
          ev.event,
          ...ev.characters,
          ...ev.foreshadowingRefs,
        ]),
      ].join("\n")
    : "";
  if (latest) {
    for (const ev of latest.keyEvents) {
      for (const c of ev.characters) chars.add(c);
      for (const f of ev.foreshadowingRefs) fore.add(f);
    }
  }
  // userIntent 里点名的实体
  for (const c of snapshot.characters) {
    if (c.name && userIntent.includes(c.name)) chars.add(c.name);
  }
  for (const f of snapshot.activeForeshadowing) {
    if (f.label && userIntent.includes(f.label)) fore.add(f.label);
  }
  for (const { section, items } of snapshot.genreSections) {
    for (const item of items) {
      const terms = [
        resolveItemLabel(section, item.data, ""),
        resolveItemIdentityKey(section, item.data) ?? "",
        ...resolveItemSearchText(section, item.data).split(/\s+/),
      ].filter((term) => term && term.trim());
      for (const term of terms) {
        if (userIntent.includes(term) || latestText.includes(term)) {
          records.add(term);
        }
      }
    }
  }

  if (chars.size === 0 && fore.size === 0 && records.size === 0) {
    // 无续写线索(如开篇):退回全部,召回本就基本无历史
    return {
      characters: snapshot.characters.map(c => c.name),
      foreshadowing: snapshot.activeForeshadowing.map(f => f.label),
      records: snapshot.genreSections.flatMap(({ section, items }) =>
        items
          .map((item) => resolveItemLabel(section, item.data, ""))
          .filter(Boolean),
      ),
    };
  }
  return { characters: [...chars], foreshadowing: [...fore], records: [...records] };
}

/**
 * 为"写第 chapterNo 章"组装 spec §6.1 要求的完整防漂移上下文。
 *
 * 用 BookSnapshot + 召回算法(recall.ts)产出 messages,内容含:
 * - 故事设定 / 规则 / 角色卡 / 活跃伏笔 / 题材专属板块(静态块,prompt cache 友好)
 * - 最近 3 章摘要 + 召回的 5 章相关历史 + 用户意图(动态块)
 */
export function buildChapterWriteMessages(
  handle: BookHandle,
  chapterNo: number,
  userIntent: string,
  /** 覆盖默认"写第 N 章"任务指令(如 /rewrite 传入"重写并改进 + 现有正文") */
  taskInstruction?: string,
): ChapterWriteContext {
  const snapshot = loadBookSnapshot(
    handle.bookId,
    {
      charactersRepo: handle.charactersRepo,
      outlineRepo: handle.outlineRepo,
      foreshadowingRepo: handle.foreshadowingRepo,
      chaptersRepo: handle.chaptersRepo,
      genreSectionsRepo: handle.genreSectionsRepo,
      worldbookRepo: handle.worldbookRepo,
      promptPresetsRepo: handle.promptPresetsRepo,
      readerIssuesRepo: handle.readerIssuesRepo,
      bookMetaRepo: handle.bookMetaRepo,
    },
    { rulesMd: handle.rulesMdPath },
  );

  const recallIntent = deriveRecallIntent(snapshot, userIntent);
  const result = buildWriteContext({
    snapshot,
    currentChapterNo: chapterNo,
    intent: {
      characters: recallIntent.characters,
      foreshadowing: recallIntent.foreshadowing,
      records: recallIntent.records,
      userMessage: userIntent,
    },
  });
  const hardContinuity = renderHardContinuityConstraints([
    ...snapshot.recentSummaries,
    ...snapshot.allSummaries
      .filter((summary) => result.recalledChapterNos.includes(summary.chapterNo))
      .slice(-5),
  ]);
  const structuredContinuity = renderCharacterStateContinuity(snapshot.characters);
  const timelineContinuity = renderTimelineContinuity(handle.timelineRepo?.listAll?.() ?? []);
  const requiredOutputSections = renderRequiredOutputSections(
    extractRequiredOutputSections(snapshot.promptBlocks),
  );

  // 追加明确的产出指令(buildWriteContext 的动态块已含用户意图,这里固定任务框架)
  const messages: CoreMessage[] = [
    ...result.messages,
    ...(hardContinuity
      ? [{ role: "user" as const, content: hardContinuity }]
      : []),
    ...(structuredContinuity
      ? [{ role: "user" as const, content: structuredContinuity }]
      : []),
    ...(timelineContinuity
      ? [{ role: "user" as const, content: timelineContinuity }]
      : []),
    ...(requiredOutputSections
      ? [{ role: "user" as const, content: requiredOutputSections }]
      : []),
    {
      role: "user",
      content:
        taskInstruction ??
        `# 任务\n现在写第 ${chapterNo} 章正文。直接输出正文,不要写标题、不要前言、不要解释。`,
    },
  ];

  return {
    messages,
    recalledChapterNos: result.recalledChapterNos,
    recentChapterNos: result.recentChapterNos,
    diagnostics: result.diagnostics,
  };
}

export function buildChapterAuditContext(
  handle: BookHandle,
  chapterNo: number,
  userIntent: string,
  chapterPlan?: string,
): ChapterAuditPromptContext {
  const base = buildBookPromptContext(handle).auditCtx;
  const snapshot = loadBookSnapshot(
    handle.bookId,
    {
      charactersRepo: handle.charactersRepo,
      outlineRepo: handle.outlineRepo,
      foreshadowingRepo: handle.foreshadowingRepo,
      chaptersRepo: handle.chaptersRepo,
      genreSectionsRepo: handle.genreSectionsRepo,
      worldbookRepo: handle.worldbookRepo,
      promptPresetsRepo: handle.promptPresetsRepo,
      readerIssuesRepo: handle.readerIssuesRepo,
      bookMetaRepo: handle.bookMetaRepo,
    },
    { rulesMd: handle.rulesMdPath },
  );

  const recallIntent = deriveRecallIntent(snapshot, userIntent);
  const result = buildWriteContext({
    snapshot,
    currentChapterNo: chapterNo,
    intent: {
      characters: recallIntent.characters,
      foreshadowing: recallIntent.foreshadowing,
      records: recallIntent.records,
      userMessage: userIntent,
      chapterPlan,
    },
  });

  const recalled = new Set(result.recalledChapterNos);
  const recent = new Set(result.recentChapterNos);
  const hardContinuityContext = renderHardContinuityConstraints([
    ...snapshot.recentSummaries,
    ...snapshot.allSummaries
      .filter((summary) => result.recalledChapterNos.includes(summary.chapterNo))
      .slice(-5),
  ]);
  const structuredContinuity = renderCharacterStateContinuity(snapshot.characters);
  const timelineContinuity = renderTimelineContinuity(handle.timelineRepo?.listAll?.() ?? []);
  return {
    auditCtx: {
      ...base,
      chapterPlan,
      worldbookContext: extractMessageBlock(result.messages, "## Worldbook"),
      readerIssuesContext: extractMessageBlock(result.messages, "## Reader Continuity Issues"),
      hardContinuityContext: [
        hardContinuityContext,
        structuredContinuity,
        timelineContinuity,
      ].filter(Boolean).join("\n\n"),
      recentSummaries: snapshot.recentSummaries.filter((s) => recent.has(s.chapterNo)),
      recalledSummaries: snapshot.allSummaries.filter((s) => recalled.has(s.chapterNo)),
    },
    recalledChapterNos: result.recalledChapterNos,
    recentChapterNos: result.recentChapterNos,
  };
}
