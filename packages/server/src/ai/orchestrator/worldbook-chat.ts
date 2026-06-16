import type { CoreMessage, LanguageModel } from "ai";
import type { SseEvent } from "@scribe/shared";
import { streamLlm } from "../llm-call.js";
import { WORLDBOOK_CHAT_PROMPT } from "../prompts/worldbook-chat.js";
import { makeWorldbookTools, type WorldbookToolsDeps } from "../tools/worldbook-tools.js";

export interface WorldbookChatDeps {
  model: LanguageModel;
  toolDeps: WorldbookToolsDeps;
  abortSignal?: AbortSignal;
  maxSteps?: number;
}

export interface WorldbookChatInput {
  message: string;
  history?: CoreMessage[];
}

export async function* runWorldbookChat(
  deps: WorldbookChatDeps,
  input: WorldbookChatInput,
): AsyncIterable<SseEvent> {
  const messages: CoreMessage[] = [
    { role: "system", content: WORLDBOOK_CHAT_PROMPT },
    ...(input.history ?? []),
    { role: "user", content: input.message },
  ];
  yield* streamLlm({
    model: deps.model,
    messages,
    tools: makeWorldbookTools(deps.toolDeps),
    maxSteps: deps.maxSteps ?? 8,
    abortSignal: deps.abortSignal,
  });
}
