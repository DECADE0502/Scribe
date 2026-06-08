import type { CoreMessage } from "ai";
import type { BookSnapshot } from "./snapshot.js";
import { recallChapters } from "./recall.js";
import { fitWithinBudget, defaultTruncate, type Section } from "./budget.js";
import { SYSTEM_PROMPT } from "../prompts/system-prompt.js";

export interface BuildIntent {
  characters: string[];
  foreshadowing: string[];
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
    parts.push(`\n## 题材专属板块`);
    for (const { section, items } of snapshot.genreSections) {
      parts.push(`### ${section.name}`);
      for (const it of items) {
        parts.push(`- ${JSON.stringify(it.data)}`);
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

export function buildWriteContext(opts: BuildOptions): BuildResult {
  const recent = opts.snapshot.recentSummaries.slice(0, 3);
  const recalled = recallChapters({
    allSummaries: opts.snapshot.allSummaries,
    currentChapterNo: opts.currentChapterNo,
    intentCharacters: opts.intent.characters,
    intentForeshadowing: opts.intent.foreshadowing,
    topK: 5,
  });
  const staticBlock = renderStaticBlock(opts.snapshot);
  const dynamicBlock = renderDynamicBlock({
    recent,
    recalled,
    intent: opts.intent,
  });

  const sections: Section[] = [
    { id: "static", priority: 100, text: staticBlock },
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
    ...orderedKept.map((s) => ({ role: "user" as const, content: s.text })),
  ];

  return {
    messages,
    recalledChapterNos: recalled.map((s) => s.chapterNo),
    recentChapterNos: recent.map((s) => s.chapterNo),
    droppedSectionIds: fitted.dropped.map((s) => s.id),
    usedTokens: fitted.usedTokens,
  };
}
