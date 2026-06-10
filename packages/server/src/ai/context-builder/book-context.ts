import * as fs from "node:fs";
import type { BookHandle } from "../../http/book-registry.js";
import type { WriteChapterContext } from "../prompts/write-chapter.js";
import type { AuditContext } from "../orchestrator/audit-chapter.js";

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
