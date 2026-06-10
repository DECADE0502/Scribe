import { generateText, type LanguageModel } from "ai";
import {
  AUDIT_SUMMARIZE_PROMPT,
  parseAuditOutput,
} from "../prompts/audit-summarize.js";
import type { ChapterAuditOutput } from "@scribe/shared";

export interface AuditContext {
  chapterNo: number;
  chapterContent: string;
  premise?: string;
  tone?: string;
  rulesMd?: string;
  characters?: Array<{
    name: string;
    baseData?: unknown;
    currentState?: unknown;
  }>;
  activeForeshadowing?: Array<{
    label: string;
    description?: string | null;
    status: string;
  }>;
  chapterPlan?: string;
}

export interface AuditDeps {
  model: LanguageModel;
  abortSignal?: AbortSignal;
}

export interface AuditResult {
  output: ChapterAuditOutput;
  usage: {
    promptTokens: number;
    completionTokens: number;
    cachedTokens: number;
    reasoningTokens: number;
  };
  rawText: string;
  reasoningText?: string;
}

/**
 * 章末审查 + 摘要生成的非流式编排器。
 *
 * 一次 LLM 调用同时产出 7 维审查与三层摘要(oneLiner / paragraph / keyEvents)。
 * 流式不是必要的(审查无需 UI 实时显示),用 generateText 简化错误处理。
 *
 * 容错:SDK 偶发解析失败 / LLM 偶发输出坏 JSON,各重试至多 2 次。
 */
export async function auditChapter(
  deps: AuditDeps,
  ctx: AuditContext,
): Promise<AuditResult> {
  const userMsg = buildAuditUserPrompt(ctx);
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (deps.abortSignal?.aborted) break;
    try {
      const result = await generateText({
        model: deps.model,
        messages: [
          { role: "system", content: AUDIT_SUMMARIZE_PROMPT },
          { role: "user", content: userMsg },
        ],
        abortSignal: deps.abortSignal,
      });
      const output = parseAuditOutput(result.text);
      return {
        output,
        usage: {
          promptTokens: result.usage.promptTokens ?? 0,
          completionTokens: result.usage.completionTokens ?? 0,
          cachedTokens: 0,
          reasoningTokens: 0,
        },
        rawText: result.text,
        reasoningText: result.reasoning ?? undefined,
      };
    } catch (e) {
      lastError = e;
      // abort 不重试
      if ((e as Error)?.name === "AbortError") break;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * 拼接审查请求的 user prompt:正文 + 上下文(premise/tone/rules/角色/伏笔/计划)。
 *
 * 仅输出存在的字段对应的段落标题,缺字段不留空段。
 */
export function buildAuditUserPrompt(ctx: AuditContext): string {
  const sections: string[] = [];
  sections.push(`## 第 ${ctx.chapterNo} 章正文`);
  sections.push(ctx.chapterContent);
  if (ctx.premise) {
    sections.push("## 故事前提");
    sections.push(ctx.premise);
  }
  if (ctx.tone) {
    sections.push("## 调性");
    sections.push(ctx.tone);
  }
  if (ctx.rulesMd) {
    sections.push("## 写作规则(rules.md)");
    sections.push(ctx.rulesMd);
  }
  if (ctx.characters?.length) {
    sections.push("## 主要角色");
    for (const c of ctx.characters) {
      const brief = (() => {
        const b = c.baseData as Record<string, unknown> | undefined;
        if (!b) return "";
        const items: string[] = [];
        if (typeof b.background === "string")
          items.push(`背景:${b.background}`);
        if (typeof b.motivation === "string")
          items.push(`动机:${b.motivation}`);
        return items.length ? `(${items.join(";")})` : "";
      })();
      sections.push(`${c.name}: ${brief}`);
    }
  }
  if (ctx.activeForeshadowing?.length) {
    sections.push("## 活跃伏笔");
    for (const f of ctx.activeForeshadowing) {
      sections.push(`[${f.label}] ${f.description ?? ""}(状态:${f.status})`);
    }
  }
  if (ctx.chapterPlan) {
    sections.push("## 本章计划");
    sections.push(ctx.chapterPlan);
  }
  return sections.join("\n\n");
}
