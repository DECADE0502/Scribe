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

export function renderStaticBlock(snapshot: BookSnapshot): string {
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
  if (snapshot.activeForeshadowing.length) {
    parts.push(`\n## 活跃伏笔`);
    for (const f of snapshot.activeForeshadowing) {
      parts.push(
        `- [${f.label}]${f.description ? " " + f.description : ""}(埋于第 ${
          f.plantedChapter ?? "?"
        } 章)`
      );
    }
  }
  if (snapshot.genreSections.length) {
    parts.push(`\n## 通用记录集合`);
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
  }
  if (snapshot.characters.length) {
    parts.push(`\n## 主要角色`);
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
  }
  return parts.join("\n");
}

export interface DynamicRenderInput {
  recent: BookSnapshot["recentSummaries"];
  recalled: BookSnapshot["recentSummaries"];
  intent: BuildIntent;
}

export function renderDynamicBlock(input: DynamicRenderInput): string {
  const parts: string[] = [];
  if (input.recent.length) {
    parts.push(`## 最近 ${input.recent.length} 章摘要(最近优先)`);
    for (const s of input.recent) {
      parts.push(`### 第 ${s.chapterNo} 章 — ${s.oneLiner}`);
      parts.push(s.paragraph);
    }
  }
  if (input.recalled.length) {
    parts.push(`\n## 相关历史章节(召回 ${input.recalled.length} 章)`);
    for (const s of input.recalled) {
      parts.push(`### 第 ${s.chapterNo} 章 — ${s.oneLiner}`);
      parts.push(s.paragraph);
    }
  }
  if (input.intent.chapterPlan) {
    parts.push(`\n## 本章计划`);
    parts.push(input.intent.chapterPlan);
  }
  parts.push(`\n## 用户最新指令`);
  parts.push(input.intent.userMessage || "(用户未明确说,请承接前文。)");
  return parts.join("\n");
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
  const staticBlock = renderStaticBlock(opts.snapshot);
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
  const dynamicBlock = renderDynamicBlock({
    recent,
    recalled,
    intent: opts.intent,
  });

  const sections: Section[] = [
    { id: "static", priority: 100, text: staticBlock },
    ...(worldbookBlock
      ? [{ id: "worldbook", priority: 95, text: worldbookBlock }]
      : []),
    ...(readerIssuesBlock
      ? [{ id: "reader-issues", priority: 94, text: readerIssuesBlock }]
      : []),
    { id: "dynamic", priority: 90, text: dynamicBlock },
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
