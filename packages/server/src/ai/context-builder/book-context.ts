import * as fs from "node:fs";
import type { CoreMessage } from "ai";
import type { ChapterSummary, Character, TimelineEvent, OutlineNode } from "@scribe/shared";
import {
  resolveItemIdentityKey,
  resolveItemLabel,
  resolveItemSearchText,
} from "@scribe/shared";
import type { BookHandle } from "../../http/book-registry.js";
import type { StyleReference } from "../../config/load.js";
import type { WriteChapterContext } from "../prompts/write-chapter.js";
import type { AuditContext } from "../orchestrator/audit-chapter.js";
import { loadBookSnapshot, type BookSnapshot } from "./snapshot.js";
import { buildWriteContext, type BuildResult } from "./builder.js";

export interface BookPromptContext {
  writeCtx: Partial<WriteChapterContext>;
  auditCtx: Partial<Omit<AuditContext, "chapterNo" | "chapterContent">>;
}

export function resolveSelectedStyleReference(
  handle: Pick<BookHandle, "bookMetaRepo">,
  references: StyleReference[] = [],
): StyleReference | undefined {
  // 显式开关:关掉则不注入(即使已选了一组文风)
  if (handle.bookMetaRepo.get("style_reference_enabled") === "0") return undefined;
  const selectedId = handle.bookMetaRepo.get("style_reference_id")?.trim();
  if (!selectedId) return undefined;
  return references.find((reference) => reference.id === selectedId && reference.content.trim());
}

export function renderStyleReference(reference: StyleReference | undefined): string | undefined {
  if (!reference) return undefined;
  const content = reference.content.trim();
  if (!content) return undefined;
  return [`名称: ${reference.name}`, content].join("\n");
}

/**
 * 从书的持久化数据组装 写作/审查 上下文(B-5-001 修复)。
 * 这是 LLM 写作不跑题的关键:premise、调性、角色卡、大纲、规则全部进 prompt。
 */
export function buildBookPromptContext(
  handle: BookHandle,
  styleReferences: StyleReference[] = [],
): BookPromptContext {
  const meta = Object.fromEntries(handle.bookMetaRepo.list().map(r => [r.key, r.value]));
  const characters = handle.charactersRepo.list();
  const outline = handle.outlineRepo.listAll();
  const activeForeshadowing = handle.foreshadowingRepo.list("active");
  const rulesMd = fs.existsSync(handle.rulesMdPath)
    ? fs.readFileSync(handle.rulesMdPath, "utf-8")
    : "";
  const styleReference = renderStyleReference(
    resolveSelectedStyleReference(handle, styleReferences),
  );

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
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(n => {
      const levelLabel = n.level === "volume" ? "卷" : n.level === "arc" ? "弧" : "章";
      const indent = n.level === "chapter" ? "  " : "";
      return `${indent}[${levelLabel}] ${n.title}${n.summary ? `:${n.summary}` : ""}`;
    })
    .join("\n");

  return {
    writeCtx: {
      premise,
      rules: rulesMd || undefined,
      styleReference,
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function titleMatchesChapterNo(title: string, chapterNo: number): boolean {
  const escapedNo = escapeRegExp(String(chapterNo));
  const patterns = [
    new RegExp(`第\\s*${escapedNo}\\s*[章节回]`, "i"),
    new RegExp(`\\bchapter\\s*${escapedNo}\\b`, "i"),
    new RegExp(`^\\s*${escapedNo}\\s*[.、．\\-:：\\s]`),
  ];
  return patterns.some((pattern) => pattern.test(title));
}

/**
 * 查找某章对应的章级大纲节点。只匹配明确章号，避免第 1 章误命中第 10 章。
 */
export function findChapterOutlineNode(
  outlineRepo: { listAll(): OutlineNode[] },
  chapterNo: number,
): OutlineNode | undefined {
  const nodes = outlineRepo.listAll();
  return nodes.find((node) =>
    node.level === "chapter" && titleMatchesChapterNo(node.title, chapterNo)
  );
}

/**
 * 解析某章的标题:优先用对应章级大纲节点的标题(如"第1章 雨夜重返"),
 * 没有则回退"第 N 章"。写章落盘时用它,避免章节标题永远是占位符。
 */
export function resolveChapterTitle(
  outlineRepo: { listAll(): OutlineNode[] },
  chapterNo: number,
): string {
  return findChapterOutlineNode(outlineRepo, chapterNo)?.title?.trim() || `第 ${chapterNo} 章`;
}

/**
 * 查找某章对应的大纲节点，返回其摘要。写章时拼进 userIntent 让 AI 按章级大纲写。
 */
export function findChapterOutlineSummary(
  outlineRepo: { listAll(): OutlineNode[] },
  chapterNo: number,
): string | undefined {
  const node = findChapterOutlineNode(outlineRepo, chapterNo);
  return node?.summary ?? undefined;
}

/**
 * 把本章 outline 节点拼成结构化的 chapterPlan(供 buildWriteContext 的 intent.chapterPlan)。
 * 内容: 标题 + summary + metadata.keyEvents(若有)。这是"本章计划"专用 slot,与
 * enrichUserIntentWithOutline 走的是不同槽位,前者落到"## 本章计划",后者落到"## 用户最新指令"。
 */
export function buildChapterPlanFromOutline(
  outlineRepo: { listAll(): OutlineNode[] },
  chapterNo: number,
): string | undefined {
  const node = findChapterOutlineNode(outlineRepo, chapterNo);
  if (!node) return undefined;
  const parts: string[] = [`### ${node.title}`];
  if (node.summary) parts.push(node.summary);
  const meta = node.metadata as Record<string, unknown> | null;
  if (meta && Array.isArray(meta.keyEvents)) {
    parts.push("关键事件:");
    for (const e of meta.keyEvents) parts.push(`- ${String(e)}`);
  }
  return parts.length > 1 ? parts.join("\n") : undefined;
}

/**
 * 把章级大纲摘要拼进 userIntent。如果没有大纲节点则原样返回。
 */
export function enrichUserIntentWithOutline(
  outlineRepo: { listAll(): OutlineNode[] },
  chapterNo: number,
  userIntent: string,
): string {
  const node = findChapterOutlineNode(outlineRepo, chapterNo);
  if (!node?.summary) return userIntent;
  return [
    userIntent,
    "# 本章精确大纲",
    `目标章节: 第 ${chapterNo} 章`,
    `大纲标题: ${node.title}`,
    `本章必须写: ${node.summary}`,
    "要求: 本章正文必须优先服从这里的章级大纲，不要用卷/弧线替代本章事件，不要擅自跳到其它章节安排。",
  ].filter(Boolean).join("\n");
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
  // 通用的状态面板触发词(跨题材)
  if (!/(状态栏|狀態欄|status\s*bar|面板|属性面板|战斗记录|任务日志|角色卡)/i.test(joined)) return [];
  const statusLines = joined
    .split(/\r?\n|[。！？]/)
    .map((line) => line.trim())
    .filter((line) => /(状态栏|狀態欄|status\s*bar|面板|属性面板|战斗记录|任务日志|角色卡)/i.test(line))
    .filter((line) => /(必须|必須|必填|包含|包括|输出|輸出|格式|字段|欄位|include|required)/i.test(line))
    .filter((line) => !/(不是|无需|無需|不必|不要|非必填|not required)/i.test(line));
  const sourceText = statusLines.join("\n") || joined;

  // 动态提取 requiredTerms:从源文本里搜索大写英文字母组合(如 HP/SP/MP)和常见属性词
  // 不再硬编码 ["HP", "SP", "MP", "契约", "捕捉球", "等级", "时间", "倒计时"]
  const termSet = new Set<string>();

  // 1. 提取大写英文字母组合(2-5个字母,如 HP/SP/MP/EXP)
  const upperCaseMatches = sourceText.match(/\b[A-Z]{2,5}\b/g);
  if (upperCaseMatches) {
    for (const term of upperCaseMatches) termSet.add(term);
  }

  // 2. 提取冒号/等号前的属性名(如 "HP：73" 里的 "HP")
  const attrMatches = sourceText.match(/([\u4e00-\u9fffA-Za-z]{1,8})\s*[：:=＝]/g);
  if (attrMatches) {
    for (const match of attrMatches) {
      const attr = match.replace(/\s*[：:=＝]/, "").trim();
      if (attr.length >= 1 && attr.length <= 8) termSet.add(attr);
    }
  }

  // 3. 提取"包含/包括"后顿号分隔的词(如 "包含HP、契约、捕捉球" 里的 "契约"/"捕捉球")
  const includeMatch = sourceText.match(/(?:包含|包括|含有|需含)\s*([^\s。！？]+)/);
  if (includeMatch) {
    const parts = includeMatch[1]!.split(/[、,，;；]/);
    for (const part of parts) {
      const trimmed = part.trim().replace(/数量|值|等\s*$/, "").trim();
      // 只保留 1-8 个字符的词,过滤掉纯数字或太长的片段
      if (trimmed.length >= 1 && trimmed.length <= 8 && !/^\d+$/.test(trimmed)) {
        termSet.add(trimmed);
      }
    }
  }

  // 如果没有提取到任何属性词,用触发词本身作为 requiredTerm
  const triggerMatch = sourceText.match(/(状态栏|狀態欄|status\s*bar|面板|属性面板|战斗记录|任务日志|角色卡)/i);
  if (triggerMatch) termSet.add(triggerMatch[0]!);

  const requiredTerms = [...termSet];
  if (requiredTerms.length === 0) return [];

  return [{
    kind: "status_section",
    label: triggerMatch?.[0] ?? "状态栏",
    requiredTerms,
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

/** 通用的否定/变化关键词(跨题材适用) */
const GENERIC_NEGATION_TERMS = ["无", "没有", "不能", "无法", "仅", "只剩", "耗尽", "归零"];
const GENERIC_CHANGE_TERMS = ["可用", "剩余", "还剩", "获得", "用尽", "消耗", "损毁", "碎裂", "失去"];

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？!?])|\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * 从书的快照里动态构建硬状态词表。
 * 不硬编码任何题材词汇——从角色 currentState 的 key、通用记录 schema 字段名、
 * 世界书常量条目内容里自动收集。
 */
function buildDynamicHardStateTerms(snapshot: BookSnapshot): Set<string> {
  const terms = new Set<string>();
  // 1. 角色 currentState 的 key (如 normalCaptureBalls, hp, sp, location 等)
  for (const c of snapshot.characters) {
    for (const key of Object.keys(c.currentState ?? {})) {
      terms.add(key);
      // 也加角色名,这样句子里有角色名时也能匹配
      if (c.name) terms.add(c.name);
    }
  }
  // 2. 通用记录集合的 schema 字段名(identity/label/status role 的字段)
  for (const { section } of snapshot.genreSections) {
    for (const field of section.schema) {
      if (field.role === "identity" || field.role === "label" || field.role === "status" || field.isLabel) {
        terms.add(field.name);
      }
    }
    // 集合名也加入(如"系统规则与机制"里的条目名)
    terms.add(section.name);
  }
  // 3. 通用记录条目的 identity 值(如"觉醒者与标记"、"捕捉判定规则"等条目名)
  for (const { section, items } of snapshot.genreSections) {
    for (const item of items) {
      const label = resolveItemLabel(section, item.data, "");
      if (label) terms.add(label);
    }
  }
  return terms;
}

/**
 * 判断一个句子是否包含硬事实信息。
 * 不依赖硬编码词表,而是用动态构建的 terms + 通用数字/否定模式。
 */
function isHardContinuitySentence(
  sentence: string,
  dynamicTerms: Set<string>,
): boolean {
  // 检查句子里是否包含任何动态词
  const hasStateTerm = [...dynamicTerms].some((term) =>
    term.length >= 2 ? sentence.includes(term) : false,
  );
  if (!hasStateTerm) return false;
  // 必须同时包含数字、否定词、或变化词
  return (
    /[0-9]/.test(sentence) ||
    GENERIC_NEGATION_TERMS.some((term) => sentence.includes(term)) ||
    GENERIC_CHANGE_TERMS.some((term) => sentence.includes(term))
  );
}

export function renderHardContinuityConstraints(
  summaries: Pick<ChapterSummary, "chapterNo" | "oneLiner" | "paragraph" | "keyEvents">[],
  dynamicTerms?: Set<string>,
): string {
  const terms = dynamicTerms ?? new Set<string>();
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const summary of summaries) {
    const candidates = [
      summary.oneLiner,
      ...splitSentences(summary.paragraph),
      ...summary.keyEvents.flatMap((event) => splitSentences(event.event)),
    ];
    for (const sentence of candidates) {
      if (!isHardContinuitySentence(sentence, terms)) continue;
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

export function renderTimelineContinuity(
  events: TimelineEvent[],
  dynamicTerms?: Set<string>,
): string {
  const terms = dynamicTerms ?? new Set<string>();
  const lines = events
    .filter((event) => isHardContinuitySentence(event.event, terms))
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
/**
 * 渲染「创作目标与进度」块:让模型知道全书篇幅形态、目标章数、当前进度百分比、
 * 最终结局走向与续集考虑,并据此把控节奏(开篇铺垫 / 中段推进 / 临近收束)。
 * 目标信息存在 book_meta 的 goal_* 键里;未设置则返回 undefined(不注入)。
 */
export function renderGoalAndProgress(
  bookMetaRepo: { get(key: string): string | undefined },
  chapterNo: number,
): string | undefined {
  const form = bookMetaRepo.get("goal_form")?.trim();
  const ending = bookMetaRepo.get("goal_ending")?.trim();
  const sequel = bookMetaRepo.get("goal_sequel")?.trim();
  const targetRaw = bookMetaRepo.get("goal_target_chapters")?.trim();
  const target = targetRaw ? parseInt(targetRaw, 10) : NaN;

  const lines: string[] = [];
  if (form) lines.push(`篇幅形态:${form}`);
  if (Number.isFinite(target) && target > 0) {
    const pct = Math.min(100, Math.round((chapterNo / target) * 100));
    lines.push(`目标总章数:约 ${target} 章;当前写第 ${chapterNo} 章(进度约 ${pct}%)`);
    const ratio = chapterNo / target;
    const hint = ratio <= 0.15
      ? "处于开篇铺垫阶段:立人物、抛钩子,埋线为主,不要急于摊牌或加速主线。"
      : ratio >= 0.85
        ? "已接近全书结尾:推进主线收束、回收已埋伏笔、为结局蓄势,避免再引入大量新人物/新设定。"
        : "处于故事中段:稳步推进主线冲突与人物关系,适度加深或回收伏笔。";
    lines.push(`节奏把控:${hint}`);
  } else if (form || ending || sequel) {
    lines.push(`当前写第 ${chapterNo} 章。`);
  }
  if (ending) lines.push(`最终目标/结局走向:${ending}`);
  if (sequel) lines.push(`续集考虑:${sequel}`);

  if (lines.length === 0) return undefined;
  return `## 创作目标与进度\n${lines.join("\n")}`;
}

export function buildChapterWriteMessages(
  handle: BookHandle,
  chapterNo: number,
  userIntent: string,
  taskInstruction?: string,
  styleReferences: StyleReference[] = [],
  writeBudgetTokens?: number,
): ChapterWriteContext {
  const snapshot = loadBookSnapshot(
    handle.bookId,
    {
      charactersRepo: handle.charactersRepo,
      outlineRepo: handle.outlineRepo,
      foreshadowingRepo: handle.foreshadowingRepo,
      chaptersRepo: handle.chaptersRepo,
      chapterFiles: handle.chapterFiles,
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
      chapterPlan: buildChapterPlanFromOutline(handle.outlineRepo, chapterNo),
    },
    budgetTokens: writeBudgetTokens,
  });
  // 动态构建硬状态词表(不硬编码任何题材词汇)
  const dynamicTerms = buildDynamicHardStateTerms(snapshot);
  const hardContinuity = renderHardContinuityConstraints([
    ...snapshot.recentSummaries,
    ...snapshot.allSummaries
      .filter((summary) => result.recalledChapterNos.includes(summary.chapterNo))
      .slice(-5),
  ], dynamicTerms);
  const structuredContinuity = renderCharacterStateContinuity(snapshot.characters);
  const timelineContinuity = renderTimelineContinuity(handle.timelineRepo?.listAll?.() ?? [], dynamicTerms);
  const requiredOutputSections = renderRequiredOutputSections(
    extractRequiredOutputSections(snapshot.promptBlocks),
  );
  const styleReference = renderStyleReference(
    resolveSelectedStyleReference(handle, styleReferences),
  );

  const goalBlock = renderGoalAndProgress(handle.bookMetaRepo, chapterNo);

  // 追加明确的产出指令(buildWriteContext 的动态块已含用户意图,这里固定任务框架)
  const messages: CoreMessage[] = [
    ...result.messages,
    ...(goalBlock
      ? [{ role: "user" as const, content: goalBlock }]
      : []),
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
    ...(styleReference
      ? [{ role: "user" as const, content: `## 文风参考\n${styleReference}` }]
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
  writeBudgetTokens?: number,
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
    budgetTokens: writeBudgetTokens,
  });

  const recalled = new Set(result.recalledChapterNos);
  const recent = new Set(result.recentChapterNos);
  // 动态构建硬状态词表(不硬编码任何题材词汇)
  const dynamicTerms = buildDynamicHardStateTerms(snapshot);
  const hardContinuityContext = renderHardContinuityConstraints([
    ...snapshot.recentSummaries,
    ...snapshot.allSummaries
      .filter((summary) => result.recalledChapterNos.includes(summary.chapterNo))
      .slice(-5),
  ], dynamicTerms);
  const structuredContinuity = renderCharacterStateContinuity(snapshot.characters);
  const timelineContinuity = renderTimelineContinuity(handle.timelineRepo?.listAll?.() ?? [], dynamicTerms);
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
