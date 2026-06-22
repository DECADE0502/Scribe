import type { CoreMessage } from "ai";
import {
  resolveDisplayFieldNames,
  resolveIdentityFieldNames,
  resolveItemIdentityKey,
  resolveItemLabel,
  resolveItemSearchText,
} from "@scribe/shared";
import type { BookSnapshot } from "./snapshot.js";
import { recallChapters } from "./recall.js";
import { fitWithinBudget, defaultTruncate, type Section } from "./budget.js";
import { SYSTEM_PROMPT } from "../prompts/system-prompt.js";
import {
  renderWorldbookEntries,
  retrieveWorldbookEntries,
} from "../worldbook/retrieval.js";
import { renderPromptPresetBlocks } from "../presets/render.js";
import { applySillyTavernRegexScripts } from "../presets/regex-scripts.js";
import { SillyTavernRegexScriptSchema } from "@scribe/shared";

export interface BuildIntent {
  characters: string[];
  foreshadowing: string[];
  records?: string[];
  userMessage: string;
  chapterPlan?: string;
}

export interface BuildOptions {
  snapshot: BookSnapshot;
  currentChapterNo: number;
  intent: BuildIntent;
  budgetTokens?: number;
}

export interface BuildResult {
  messages: CoreMessage[];
  recalledChapterNos: number[]; // 元数据, 便于上层 logging / token 用量分类
  recentChapterNos: number[];
  droppedSectionIds: string[];
  usedTokens: number;
  diagnostics?: {
    promptPresetBlockIds: string[];
    promptRegexScriptsApplied: string[];
    worldbookEntryIds: string[];
    readerIssueIds: string[];
  };
}

// —— 分层渲染:把原本一整块 static / dynamic 拆成可独立排优先级的小块。
// 之前 static(全部角色/记录/伏笔)优先级 100、dynamic(最近章+用户指令)优先级 90,
// 预算紧张时按优先级丢最低,导致"最近章摘要/用户指令"先被批量档案挤掉——这恰恰
// 是写作最需要的连续性上下文。拆分后:核心设定与用户指令最高,最近章次之,批量
// 的角色档案/记录集合最低,确保紧预算下优先保住叙事主线。

/** 核心设定:标题/前提/调性/题材 + 写作规则。定义整本书,优先级最高。 */
export function renderSettingBlock(snapshot: BookSnapshot): string {
  const parts: string[] = [];
  parts.push(`## 故事设定`);
  parts.push(`标题:${snapshot.meta.title}`);
  if (snapshot.meta.premise) parts.push(`前提:${snapshot.meta.premise}`);
  if (snapshot.meta.tone) parts.push(`调性:${snapshot.meta.tone}`);
  if (snapshot.meta.genre) parts.push(`题材:${snapshot.meta.genre}`);
  if (snapshot.rulesMd.trim()) {
    parts.push(`\n## 写作规则(rules.md)`);
    parts.push(snapshot.rulesMd);
  }
  return parts.join("\n");
}

/** 活跃伏笔:一致性关键,优先级高于批量档案。 */
export function renderForeshadowingBlock(snapshot: BookSnapshot): string {
  if (!snapshot.activeForeshadowing.length) return "";
  const parts: string[] = [`## 活跃伏笔`];
  for (const f of snapshot.activeForeshadowing) {
    parts.push(
      `- [${f.label}]${f.description ? " " + f.description : ""}(埋于第 ${
        f.plantedChapter ?? "?"
      } 章)`
    );
  }
  return parts.join("\n");
}

/** 通用记录集合:批量档案,预算紧张时可先裁。 */
export function renderRecordsBlock(snapshot: BookSnapshot): string {
  if (!snapshot.genreSections.length) return "";
  const parts: string[] = [`## 通用记录集合`];
  for (const { section, items } of snapshot.genreSections) {
    const identity = resolveIdentityFieldNames(section).join(",") || "(未声明)";
    const display = resolveDisplayFieldNames(section).join(",") || "(未声明)";
    const search = section.searchFields?.join(",") || "(未声明)";
    parts.push(`### ${section.name} (identity:${identity}; display:${display}; search:${search})`);
    for (const item of items) {
      const label = resolveItemLabel(section, item.data, "?");
      const identityKey = resolveItemIdentityKey(section, item.data) ?? "?";
      const searchText = resolveItemSearchText(section, item.data);
      parts.push(`- ${label} | ${identityKey}${searchText ? ` | ${searchText}` : ""}`);
    }
  }
  return parts.join("\n");
}

/** 角色档案:批量,预算紧张时最先裁(最近章摘要已含当下角色动态)。 */
export function renderCharactersBlock(snapshot: BookSnapshot): string {
  if (!snapshot.characters.length) return "";
  const parts: string[] = [`## 主要角色`];
  for (const c of snapshot.characters) {
    const b = c.baseData as Record<string, unknown> | undefined;
    const items: string[] = [];
    if (b && typeof b.background === "string")
      items.push(`背景:${b.background}`);
    if (b && typeof b.motivation === "string")
      items.push(`动机:${b.motivation}`);
    if (b && typeof b.languageHabits === "string")
      items.push(`语言:${b.languageHabits}`);
    parts.push(`### ${c.name}${c.role ? ` (${c.role})` : ""}`);
    if (items.length) parts.push(items.join("\n"));
  }
  return parts.join("\n");
}

/** 向后兼容:整块静态档案(设定+伏笔+记录+角色)。内部已改用分层小块。 */
export function renderStaticBlock(snapshot: BookSnapshot): string {
  return [
    renderSettingBlock(snapshot),
    renderForeshadowingBlock(snapshot),
    renderRecordsBlock(snapshot),
    renderCharactersBlock(snapshot),
  ]
    .filter((s) => s.trim())
    .join("\n\n");
}

/** 最近 N 章摘要:叙事连续性,优先级仅次于核心设定与用户指令。 */
export function renderRecentBlock(recent: BookSnapshot["recentSummaries"]): string {
  if (!recent.length) return "";
  const parts: string[] = [`## 最近 ${recent.length} 章摘要(最近优先)`];
  for (const s of recent) {
    parts.push(`### 第 ${s.chapterNo} 章 — ${s.oneLiner}`);
    parts.push(s.paragraph);
  }
  return parts.join("\n");
}

/** 召回的相关历史章节:有用但非必需,可较早裁。 */
export function renderRecalledBlock(recalled: BookSnapshot["recentSummaries"]): string {
  if (!recalled.length) return "";
  const parts: string[] = [`## 相关历史章节(召回 ${recalled.length} 章)`];
  for (const s of recalled) {
    parts.push(`### 第 ${s.chapterNo} 章 — ${s.oneLiner}`);
    parts.push(s.paragraph);
  }
  return parts.join("\n");
}

/** 本章计划 + 用户最新指令:当前要写什么,绝不能被批量档案挤掉。 */
export function renderInstructionBlock(intent: BuildIntent): string {
  const parts: string[] = [];
  if (intent.chapterPlan) {
    parts.push(`## 本章计划`);
    parts.push(intent.chapterPlan);
  }
  parts.push(`## 用户最新指令`);
  parts.push(intent.userMessage || "(用户未明确说,请承接前文。)");
  return parts.join("\n");
}

export interface DynamicRenderInput {
  recent: BookSnapshot["recentSummaries"];
  recalled: BookSnapshot["recentSummaries"];
  intent: BuildIntent;
}

/** 向后兼容:整块动态上下文。内部已改用分层小块。 */
export function renderDynamicBlock(input: DynamicRenderInput): string {
  return [
    renderRecentBlock(input.recent),
    renderRecalledBlock(input.recalled),
    renderInstructionBlock(input.intent),
  ]
    .filter((s) => s.trim())
    .join("\n\n");
}

export function renderReaderIssuesBlock(
  issues: BookSnapshot["readerIssues"],
): string {
  if (!issues.length) return "";
  const parts = ["## Reader Continuity Issues"];
  for (const issue of issues) {
    parts.push(
      `- [${issue.severity}] Chapter ${issue.chapterNo} ${issue.type}: ${issue.note}`,
    );
    if (issue.evidence) parts.push(`  Evidence: ${issue.evidence}`);
    if (issue.suggestedAction) parts.push(`  Action: ${issue.suggestedAction}`);
  }
  return parts.join("\n");
}

function extractPromptRegexScripts(snapshot: BookSnapshot) {
  return (snapshot.promptPresets ?? [])
    .filter((preset) => preset.enabled && preset.regexScriptsEnabled)
    .flatMap((preset) => {
      const raw = preset.extensions.regex_scripts;
      if (!Array.isArray(raw)) return [];
      return raw
        .map((script) => SillyTavernRegexScriptSchema.safeParse(script))
        .filter((result) => result.success)
        .map((result) => result.data);
    });
}

function applyPromptRegexScripts(
  messages: CoreMessage[],
  snapshot: BookSnapshot,
): { messages: CoreMessage[]; appliedScriptNames: string[] } {
  const scripts = extractPromptRegexScripts(snapshot);
  if (!scripts.length) return { messages, appliedScriptNames: [] };
  const applied = new Set<string>();
  const nextMessages = messages.map((message) => {
    if (message.role === "tool") return message;
    if (typeof message.content !== "string") return message;
    const result = applySillyTavernRegexScripts(message.content, scripts, {
      target: "prompt",
      depth: 0,
    });
    for (const script of result.applied) {
      applied.add(script.scriptName || script.id || "unnamed");
    }
    return { ...message, content: result.text };
  });
  return { messages: nextMessages, appliedScriptNames: [...applied] };
}

export function buildWriteContext(opts: BuildOptions): BuildResult {
  const recent = opts.snapshot.recentSummaries.slice(0, 3);
  const recalled = recallChapters({
    allSummaries: opts.snapshot.allSummaries,
    currentChapterNo: opts.currentChapterNo,
    intentCharacters: opts.intent.characters,
    intentForeshadowing: opts.intent.foreshadowing,
    intentRecords: opts.intent.records,
    topK: 5,
  });
  const now = new Date();
  const activePromptBlocks = (opts.snapshot.promptBlocks ?? [])
    .filter((block) => block.enabled && block.stackIndex !== null)
    .sort((a, b) => {
      const stackDelta = (a.stackIndex ?? 999_999) - (b.stackIndex ?? 999_999);
      if (stackDelta !== 0) return stackDelta;
      return a.sourceIdentifier.localeCompare(b.sourceIdentifier);
    });
  const renderedPresetMessages = renderPromptPresetBlocks(activePromptBlocks, {
      user: "",
      char: opts.snapshot.meta.title,
      lastUserMessage: opts.intent.userMessage,
      date: now.toISOString().slice(0, 10),
      time: now.toTimeString().slice(0, 5),
    });
  const presetRegexResult = applyPromptRegexScripts(
    renderedPresetMessages,
    opts.snapshot,
  );
  const presetMessages = presetRegexResult.messages;
  const worldbook = retrieveWorldbookEntries({
    entries: opts.snapshot.worldbookEntries,
    query: opts.intent.userMessage,
    extraText: [
      opts.intent.chapterPlan ?? "",
      ...opts.snapshot.recentSummaries.map((summary) =>
        [
          summary.oneLiner,
          summary.paragraph,
          ...summary.keyEvents.flatMap((event) => [
            event.event,
            ...event.characters,
            ...event.foreshadowingRefs,
          ]),
        ].join("\n"),
      ),
      ...opts.intent.characters,
      ...opts.intent.foreshadowing,
      ...(opts.intent.records ?? []),
    ],
    tokenBudget: 4_000,
  });
  const worldbookBlock = renderWorldbookEntries(worldbook.selected);
  const readerIssuesBlock = renderReaderIssuesBlock(opts.snapshot.readerIssues ?? []);

  // 分层小块,各自排优先级。final 消息顺序由下面 sections 数组的声明顺序决定
  // (prompt-cache 友好:静态在前、动态在后);priority 只决定预算紧张时丢/裁的次序。
  const settingBlock = renderSettingBlock(opts.snapshot);
  const foreshadowingBlock = renderForeshadowingBlock(opts.snapshot);
  const recordsBlock = renderRecordsBlock(opts.snapshot);
  const charactersBlock = renderCharactersBlock(opts.snapshot);
  const recalledBlock = renderRecalledBlock(recalled);
  const recentBlock = renderRecentBlock(recent);
  const instructionBlock = renderInstructionBlock(opts.intent);

  // 优先级阶梯(数值越大越先保留):
  //   设定 100 > 用户指令 99 > 最近章 96 > worldbook 95 > reader-issues 94
  //   > 活跃伏笔 93 > 召回历史 80 > 记录集合 70 > 角色档案 65
  // 数组顺序=最终拼接顺序(缓存友好),与上面的丢弃优先级解耦。
  const maybe = (id: string, priority: number, text: string): Section[] =>
    text.trim() ? [{ id, priority, text }] : [];
  const sections: Section[] = [
    ...maybe("setting", 100, settingBlock),
    ...maybe("foreshadowing", 93, foreshadowingBlock),
    ...maybe("records", 70, recordsBlock),
    ...maybe("characters", 65, charactersBlock),
    ...maybe("worldbook", 95, worldbookBlock),
    ...maybe("reader-issues", 94, readerIssuesBlock),
    ...maybe("recalled", 80, recalledBlock),
    ...maybe("recent", 96, recentBlock),
    ...maybe("instruction", 99, instructionBlock),
  ];
  const fitted = fitWithinBudget(sections, {
    budgetTokens: opts.budgetTokens ?? 32_000,
    truncate: defaultTruncate,
  });

  // 重组顺序保持 static 在前 (prompt cache 友好), 不管原 sort 顺序
  const orderedKept = sections
    .filter((s) => fitted.kept.some((k) => k.id === s.id))
    .map((orig) => fitted.kept.find((k) => k.id === orig.id)!);

  const messages: CoreMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...presetMessages,
    ...orderedKept.map((s) => ({ role: "user" as const, content: s.text })),
  ];

  return {
    messages,
    recalledChapterNos: recalled.map((s) => s.chapterNo),
    recentChapterNos: recent.map((s) => s.chapterNo),
    droppedSectionIds: fitted.dropped.map((s) => s.id),
    usedTokens: fitted.usedTokens,
    diagnostics: {
      promptPresetBlockIds: activePromptBlocks.map((block) => block.id),
      promptRegexScriptsApplied: presetRegexResult.appliedScriptNames,
      worldbookEntryIds: worldbook.selected.map((item) => item.entry.id),
      readerIssueIds: (opts.snapshot.readerIssues ?? []).map((issue) => issue.id),
    },
  };
}
