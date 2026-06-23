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

/** 通用记录条目:写作 prompt 只露 label + 一句 summary,schema 描述属于记录员,不进写作员。 */
export function renderRecordsBlock(snapshot: BookSnapshot): string {
  if (!snapshot.genreSections.length) return "";
  const parts: string[] = [`## 通用记录条目(当前已存)`];
  for (const { section, items } of snapshot.genreSections) {
    if (!items.length) continue;
    parts.push(`### ${section.name}`);
    for (const item of items) {
      const label = resolveItemLabel(section, item.data, "?");
      const summary = resolveItemSearchText(section, item.data);
      parts.push(`- ${label}${summary ? `:${summary}` : ""}`);
    }
  }
  return parts.length > 1 ? parts.join("\n") : "";
}

/** 角色当下状态:写作时只需 currentState(位置/持物/认知);baseData 背景信息进召回层。 */
export function renderCharactersBlock(snapshot: BookSnapshot): string {
  if (!snapshot.characters.length) return "";
  const parts: string[] = [`## 当下角色状态`];
  for (const c of snapshot.characters) {
    const state = c.currentState as Record<string, unknown> | undefined;
    if (!state || Object.keys(state).length === 0) continue;
    const summary = Object.entries(state)
      .filter(([, v]) => v != null && v !== "")
      .map(([k, v]) => `${k}:${typeof v === "string" ? v : JSON.stringify(v)}`)
      .join("; ");
    if (summary) parts.push(`### ${c.name}${c.role ? `(${c.role})` : ""}\n${summary}`);
  }
  return parts.length > 1 ? parts.join("\n") : "";
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

/** 最近 10 章正文全文：叙事连续性的核心，让 AI 看到前文的原话、视角、文风。 */
export function renderRecentFullChaptersBlock(
  chapters: BookSnapshot["recentFullChapters"],
): string {
  if (!chapters.length) return "";
  const parts: string[] = [`## 最近 ${chapters.length} 章正文（全文，按章节顺序）`];
  for (const ch of chapters) {
    parts.push(`### 第 ${ch.chapterNo} 章 — ${ch.title || ""}`);
    parts.push(ch.content);
  }
  return parts.join("\n");
}

/** 已完成弧的总结(中粒度,跨越多章)。 */
export function renderArcSummariesBlock(
  arcs: BookSnapshot["arcVolumeSummaries"],
): string {
  const filtered = arcs.filter((a) => a.level === "arc");
  if (!filtered.length) return "";
  const parts: string[] = [`## 已完成弧总结(${filtered.length} 条)`];
  for (const a of filtered) {
    parts.push(`### 弧 ${a.nodeId.slice(0, 8)}`);
    parts.push(a.text);
  }
  return parts.join("\n");
}

/** 已完成卷的总结(最粗,远古卷压缩态)。 */
export function renderVolumeSummariesBlock(
  vols: BookSnapshot["arcVolumeSummaries"],
): string {
  const filtered = vols.filter((v) => v.level === "volume");
  if (!filtered.length) return "";
  const parts: string[] = [`## 已完成卷总结(${filtered.length} 条)`];
  for (const v of filtered) {
    parts.push(`### 卷 ${v.nodeId.slice(0, 8)}`);
    parts.push(v.text);
  }
  return parts.join("\n");
}

/** 11-20 章前的摘要（中距离记忆）。 */
export function renderMidRangeBlock(
  midRange: BookSnapshot["midRangeSummaries"],
): string {
  if (!midRange.length) return "";
  const parts: string[] = [`## 更早章节摘要（第 ${midRange[midRange.length - 1]?.chapterNo}-${midRange[0]?.chapterNo} 章）`];
  for (const s of midRange) {
    parts.push(`### 第 ${s.chapterNo} 章 — ${s.oneLiner}`);
    parts.push(s.paragraph);
  }
  return parts.join("\n");
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

/**
 * 层级选择算法:决定每章用哪个粒度,并选出该用的弧/卷总结。
 *
 * 规则:
 *   - 章节 N - c ∈ [1,3] 由调用方处理为全文(本函数不管)。
 *   - 章节 N - c ∈ [4,20] 默认进 summariesToShow(小总结块)。
 *   - 章节 N - c > 20:
 *       a. 该章所在 arc 已全脱出窗(全部章号 < windowFloor)且 arc 有 summary → arcsToUse 添加。
 *       b. arc 未全脱出窗(部分章号 >= windowFloor)→ 窗内章号进 summariesToShow,窗外章号被屏蔽
 *          (避免半截 arc summary 描述未来事件)。
 *       c. arc 全脱出窗但无 summary → 屏蔽(等召回兜底)。
 *   - 进一步合并:若某 volume 下所有 arc 都已 arcsToUse 且 volume 自身有 summary →
 *     用 VolumeSummary 取代,从 arcsToUse 中移除对应 arc。
 */
export function pickLayers(
  paths: BookSnapshot["chapterOutlinePaths"],
  currentChapterNo: number,
): {
  arcsToUse: Set<string>;
  volumesToUse: Set<string>;
  summariesToShow: Set<number>;
} {
  const windowFloor = currentChapterNo - 20;
  const arcsToUse = new Set<string>();
  const volumesToUse = new Set<string>();
  const summariesToShow = new Set<number>();

  // 按 arc 分组(arcNodeId 为 key,null 表示扁平 outline 或孤儿章)
  const byArc = new Map<string | null, BookSnapshot["chapterOutlinePaths"]>();
  for (const p of paths) {
    if (p.chapterNo >= currentChapterNo) continue;
    const key = p.arcNodeId;
    const list = byArc.get(key) ?? [];
    list.push(p);
    byArc.set(key, list);
  }

  for (const [arcId, chapters] of byArc) {
    if (arcId === null) {
      // 扁平 outline / 孤儿章:全部进 summariesToShow,等 T12 的 auto_digest 兜底
      for (const p of chapters) summariesToShow.add(p.chapterNo);
      continue;
    }
    const arcSummary = chapters[0]!.arcSummary;
    const allOutOfWindow = chapters.every((c) => c.chapterNo < windowFloor);
    const someInWindow = chapters.some((c) => c.chapterNo >= windowFloor);

    if (allOutOfWindow && arcSummary) {
      arcsToUse.add(arcId);
    } else if (someInWindow) {
      // 窗内章用小总结,窗外章屏蔽
      for (const c of chapters) {
        if (c.chapterNo >= windowFloor) summariesToShow.add(c.chapterNo);
      }
    }
    // else (全脱出且无 summary):屏蔽,走召回
  }

  // 卷级合并:同一 volume 下所有 arc 都已 arcsToUse 且 volume 有 summary → 改用 VolumeSummary
  const arcToVolume = new Map<string, { volumeId: string; volumeSummary: string | null }>();
  for (const p of paths) {
    if (p.arcNodeId && p.volumeNodeId) {
      arcToVolume.set(p.arcNodeId, {
        volumeId: p.volumeNodeId,
        volumeSummary: p.volumeSummary,
      });
    }
  }
  const volumeArcs = new Map<string, { arcIds: Set<string>; summary: string | null }>();
  for (const [arcId, info] of arcToVolume) {
    const entry = volumeArcs.get(info.volumeId) ?? { arcIds: new Set<string>(), summary: info.volumeSummary };
    entry.arcIds.add(arcId);
    volumeArcs.set(info.volumeId, entry);
  }
  for (const [volId, entry] of volumeArcs) {
    if (!entry.summary) continue;
    const allArcsRolledUp = [...entry.arcIds].every((a) => arcsToUse.has(a));
    if (allArcsRolledUp) {
      volumesToUse.add(volId);
      for (const a of entry.arcIds) arcsToUse.delete(a);
    }
  }

  return { arcsToUse, volumesToUse, summariesToShow };
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
  // 最近 3 章原文(asc 排,紧贴 task 指令前作 POV/腔调锚);snapshot 加载了最近 10 章,这里只取末 3。
  const recentFullForPrompt = opts.snapshot.recentFullChapters.slice(-3);
  const fullCoveredNos = new Set(recentFullForPrompt.map((c) => c.chapterNo));
  // 真正的 recent 窗 = [N-10, N-1]。 snapshot 切了"最近 10 章"但不知道 currentChapterNo,
  // 对于稀疏数据(章号跳跃)或异常 fixture 可能越界,这里再按窗口绝对位置裁一道。
  const recentWindowFloor = opts.currentChapterNo - 10;
  // 层级选择:按 outline 树决定哪些章用 ArcSummary/VolumeSummary 整条压,哪些章用小总结,
  // 哪些章被屏蔽(避免半截 arc 的 summary 描述未来事件)。
  const layers = pickLayers(opts.snapshot.chapterOutlinePaths, opts.currentChapterNo);
  // recentSummaries:去重全文覆盖 + 窗口裁定 + 层级屏蔽
  const recentSummariesForPrompt = opts.snapshot.recentSummaries
    .filter((s) => !fullCoveredNos.has(s.chapterNo))
    .filter((s) => s.chapterNo >= recentWindowFloor && s.chapterNo < opts.currentChapterNo)
    .filter((s) => layers.summariesToShow.has(s.chapterNo) || !opts.snapshot.chapterOutlinePaths.some((p) => p.chapterNo === s.chapterNo && p.arcNodeId));
  // 11-20 章小总结同样被 summariesToShow 约束。
  const midRange = opts.snapshot.midRangeSummaries.filter(
    (s) => layers.summariesToShow.has(s.chapterNo) || !opts.snapshot.chapterOutlinePaths.some((p) => p.chapterNo === s.chapterNo && p.arcNodeId),
  );
  // 召回:recall 的 cutoff 已是 N-10,与 recent 不重叠;不再加额外去重。
  const recalled = recallChapters({
    allSummaries: opts.snapshot.allSummaries,
    currentChapterNo: opts.currentChapterNo,
    intentCharacters: opts.intent.characters,
    intentForeshadowing: opts.intent.foreshadowing,
    intentRecords: opts.intent.records,
    topK: 5,
  });
  // 选出的弧/卷 summary(按 nodeId 过滤)
  const arcSummaries = opts.snapshot.arcVolumeSummaries.filter(
    (s) => s.level === "arc" && layers.arcsToUse.has(s.nodeId),
  );
  const volumeSummaries = opts.snapshot.arcVolumeSummaries.filter(
    (s) => s.level === "volume" && layers.volumesToUse.has(s.nodeId),
  );
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
  // (按时间倒序:卷/弧→中程→近期→worldbook/state→召回→前文原文→指令);
  // priority 只决定预算紧张时丢/裁的次序。
  const settingBlock = renderSettingBlock(opts.snapshot);
  const foreshadowingBlock = renderForeshadowingBlock(opts.snapshot);
  const recordsBlock = renderRecordsBlock(opts.snapshot);
  const charactersBlock = renderCharactersBlock(opts.snapshot);
  const volumeSummaryBlock = renderVolumeSummariesBlock(volumeSummaries);
  const arcSummaryBlock = renderArcSummariesBlock(arcSummaries);
  const midRangeBlock = renderMidRangeBlock(midRange);
  const recentSummariesBlock = renderRecentBlock(recentSummariesForPrompt);
  const recentFullBlock = renderRecentFullChaptersBlock(recentFullForPrompt);
  const recalledBlock = renderRecalledBlock(recalled);
  const instructionBlock = renderInstructionBlock(opts.intent);

  // 裁切优先级阶梯(T5 会在此基础上加 arc/volume 块):
  //   设定 100 > 任务指令 99 > 前文原文 97 > 最近 summary 82(预算紧时让位给全文)
  //   > 中程摘要 90 > worldbook 88 > reader-issues 85 > 活跃伏笔 95
  //   > 召回 70 > 记录集合/角色档案 40(噪声税,首先丢)
  const maybe = (id: string, priority: number, text: string): Section[] =>
    text.trim() ? [{ id, priority, text }] : [];
  const sections: Section[] = [
    ...maybe("setting", 100, settingBlock),
    ...maybe("volume-summary", 80, volumeSummaryBlock),
    ...maybe("arc-summary", 92, arcSummaryBlock),
    ...maybe("mid-range", 90, midRangeBlock),
    ...maybe("recent-summary", 82, recentSummariesBlock),
    ...maybe("worldbook", 88, worldbookBlock),
    ...maybe("reader-issues", 85, readerIssuesBlock),
    ...maybe("foreshadowing", 95, foreshadowingBlock),
    ...maybe("records", 40, recordsBlock),
    ...maybe("characters", 40, charactersBlock),
    ...maybe("recalled", 70, recalledBlock),
    ...maybe("recent-full", 97, recentFullBlock),
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
    recentChapterNos: recentSummariesForPrompt.map((s) => s.chapterNo),
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
