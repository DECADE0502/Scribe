import type { SseEvent } from "@scribe/shared";
import type { LanguageModel, CoreMessage } from "ai";
import { streamLlm } from "../llm-call.js";
import { prependDeepestPrompt } from "../prompts/deepest-prompt.js";

const SYSTEM_PROMPT =
  "你是 Scribe,一个对话式中文长篇小说创作助手。简洁、贴近中文表达。";

export async function* runEcho(input: { message: string }): AsyncIterable<SseEvent> {
  yield { type: "text_delta", delta: "[echo] " };
  for (const ch of input.message) {
    yield { type: "text_delta", delta: ch };
    await new Promise((r) => setTimeout(r, 5));
  }
  yield { type: "done" };
}

export interface RunChatInput {
  model: LanguageModel;
  history?: CoreMessage[];
  message: string;
  abortSignal?: AbortSignal;
  /** 用户最深处提示词,原文拼到最前端 */
  deepestPrompt?: string;
}

export async function* runChat(input: RunChatInput): AsyncIterable<SseEvent> {
  const messages = prependDeepestPrompt([
    { role: "system", content: SYSTEM_PROMPT },
    ...(input.history ?? []),
    { role: "user", content: input.message },
  ], input.deepestPrompt);
  yield* streamLlm({ model: input.model, messages, abortSignal: input.abortSignal });
}
