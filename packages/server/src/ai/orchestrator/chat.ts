import type { SseEvent } from "@scribe/shared";
import type { LanguageModel, CoreMessage } from "ai";
import { streamLlm } from "../llm-call.js";

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
}

export async function* runChat(input: RunChatInput): AsyncIterable<SseEvent> {
  const messages: CoreMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...(input.history ?? []),
    { role: "user", content: input.message },
  ];
  yield* streamLlm({ model: input.model, messages, abortSignal: input.abortSignal });
}
