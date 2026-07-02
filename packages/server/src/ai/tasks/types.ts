import type { LanguageModel } from "ai";
import type { BookHandle } from "../../http/book-registry.js";
import type { AgentRunRequest } from "@scribe/shared";
import type { StyleReference } from "../../config/load.js";

/** 单次 LLM 调用的 token 用量。task 在每次调用完成后经 ctx.onUsage 上报,由路由计费落库。 */
export interface TaskUsage {
  promptTokens: number;
  completionTokens: number;
  cachedTokens?: number;
  reasoningTokens?: number;
  /** 本次调用用的是写作模型还是审查/抽取模型 —— 计费时选对应价格表。 */
  modelRole: "write" | "audit";
}

export interface TaskContext {
  handle: BookHandle;
  request: AgentRunRequest;
  writeModel: LanguageModel;
  auditModel: LanguageModel;
  abortSignal?: AbortSignal;
  /**
   * 用量记录回调(路由注入)。streamLlm 的 usage 事件在 task 内部被消费、不进 SSE 流,
   * 若 task 不上报,这本书的 token 成本就会漏记 —— 所有默认实现都必须在每次
   * streamLlm / generateLlmText 调用后调它。
   */
  onUsage?: (usage: TaskUsage) => void;
  /**
   * 最深处提示词(spec 核心功能:书级覆盖 > 全局,路由已解析好)。
   * 所有默认 LLM 调用都必须用 prependDeepestPrompt 把它拼到消息最前端。
   */
  deepestPrompt?: string;
  /** 全局文风参考列表;write-chapter 传给 buildChapterWriteMessages 做风格注入。 */
  styleReferences?: StyleReference[];
}

export type TaskStreamEvent = { type: "text_delta"; delta: string };

export interface TaskDef<TParsed = unknown> {
  name: string;
  /**
   * 本任务是否写库。done.committed 如实等于它:纯对话(chat)不该让前端弹"已提交"、
   * 不该触发快照调度。apply 抛错时走 error 分支,不受此字段影响。
   */
  mutates: boolean;
  stream(ctx: TaskContext): AsyncIterable<TaskStreamEvent>;
  parse(ctx: TaskContext, streamedText: string): Promise<TParsed>;
  apply(ctx: TaskContext, parsed: TParsed): void;
}
