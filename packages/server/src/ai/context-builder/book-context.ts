import * as fs from "node:fs";
import type { CoreMessage } from "ai";
import type { BookHandle } from "../../http/book-registry.js";
import type { WriteChapterContext } from "../prompts/write-chapter.js";
import type { AuditContext } from "../orchestrator/audit-chapter.js";
import { loadBookSnapshot } from "./snapshot.js";
import { buildWriteContext } from "./builder.js";

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
): { characters: string[]; foreshadowing: string[] } {
  const chars = new Set<string>();
  const fore = new Set<string>();

  const latest = snapshot.recentSummaries[0]; // recentSummaries 按 chapterNo desc
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

  if (chars.size === 0 && fore.size === 0) {
    // 无续写线索(如开篇):退回全部,召回本就基本无历史
    return {
      characters: snapshot.characters.map(c => c.name),
      foreshadowing: snapshot.activeForeshadowing.map(f => f.label),
    };
  }
  return { characters: [...chars], foreshadowing: [...fore] };
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
      userMessage: userIntent,
    },
  });

  // 追加明确的产出指令(buildWriteContext 的动态块已含用户意图,这里固定任务框架)
  const messages: CoreMessage[] = [
    ...result.messages,
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
  };
}
