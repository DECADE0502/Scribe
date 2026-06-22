import type { CoreMessage } from "ai";

/**
 * 用户自定义「最深处提示词」(spec 核心功能)。
 *
 * 作用域:全局默认 + 每本书可覆盖(每本覆盖优先,空则用全局)。
 * 注入方式:把用户原文**直接拼接到所有内置提示词的最前端**,不加任何包装/说明文字。
 * 即:作为第一条 system 消息,排在 SYSTEM_PROMPT / AUDIT / RECORD / ONBOARD 等之前。
 */

export interface DeepestPromptSource {
  /** 每本书的覆盖(book_meta.master_prompt) */
  perBook?: string | null;
  /** 全局默认(config.masterPrompt) */
  global?: string | null;
  /** 本书是否启用最深处提示词(book_meta.master_prompt_enabled,默认 true)。关掉则完全不注入。 */
  perBookEnabled?: boolean;
  /** 全局是否启用(config.masterPromptEnabled,默认 true) */
  globalEnabled?: boolean;
}

/**
 * 解析生效的最深处提示词:每本覆盖优先,否则全局,都没有则空串。
 * 显式开关:perBookEnabled=false 时整本书都不注入(连全局也不回落,语义=本书关掉深层提示词);
 * globalEnabled=false 时全局那份不参与。
 */
export function resolveDeepestPrompt(src: DeepestPromptSource): string {
  if (src.perBookEnabled === false) return "";
  const perBook = (src.perBook ?? "").trim();
  if (perBook) return perBook;
  if (src.globalEnabled === false) return "";
  return (src.global ?? "").trim();
}

/** 把最深处提示词作为第一条 system 消息原文拼到最前端(空则原样返回)。 */
export function prependDeepestPrompt(
  messages: CoreMessage[],
  deepest: string | undefined,
): CoreMessage[] {
  const p = (deepest ?? "").trim();
  if (!p) return messages;
  return [{ role: "system", content: p }, ...messages];
}
