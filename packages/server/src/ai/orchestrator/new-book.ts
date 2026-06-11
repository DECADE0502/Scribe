import type { LanguageModel, CoreMessage } from "ai";
import type { SseEvent } from "@scribe/shared";
import { streamLlm } from "../llm-call.js";
import { NEW_BOOK_ONBOARD_PROMPT } from "../prompts/new-book-onboard.js";
import { prependDeepestPrompt } from "../prompts/deepest-prompt.js";
import { buildToolRegistry, type ToolRegistryDeps } from "../tools/registry.js";

export interface NewBookOrchestratorDeps {
  model: LanguageModel;
  toolDeps: ToolRegistryDeps;
  abortSignal?: AbortSignal;
  maxSteps?: number;
  /** 用户最深处提示词,原文拼到最前端 */
  deepestPrompt?: string;
}

export interface NewBookInput {
  history?: CoreMessage[]; // 之前轮次的对话(user/assistant 交替)
  message: string; // 本轮用户消息
  completenessHint?: string; // 可选:由 isOnboardComplete 注入,告知 LLM 还差哪些
}

export async function* runNewBookConversation(
  deps: NewBookOrchestratorDeps,
  input: NewBookInput,
): AsyncIterable<SseEvent> {
  const tools = buildToolRegistry(deps.toolDeps);
  const systemContent = input.completenessHint
    ? `${NEW_BOOK_ONBOARD_PROMPT}\n\n## 当前进度\n${input.completenessHint}`
    : NEW_BOOK_ONBOARD_PROMPT;
  const messages: CoreMessage[] = prependDeepestPrompt([
    { role: "system", content: systemContent },
    ...(input.history ?? []),
    { role: "user", content: input.message },
  ], deps.deepestPrompt);
  yield* streamLlm({
    model: deps.model,
    messages,
    tools,
    maxSteps: deps.maxSteps ?? 8,
    abortSignal: deps.abortSignal,
  });
}
