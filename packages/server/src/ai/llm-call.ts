import { streamText, type LanguageModel, type CoreMessage, type Tool } from "ai";
import type { SseEvent } from "@scribe/shared";

export interface LlmCallInput {
  model: LanguageModel;
  messages: CoreMessage[];
  tools?: Record<string, Tool>;
  abortSignal?: AbortSignal;
}

export async function* streamLlm(input: LlmCallInput): AsyncIterable<SseEvent> {
  try {
    const result = streamText({
      model: input.model,
      messages: input.messages,
      tools: input.tools,
      abortSignal: input.abortSignal,
    });
    for await (const rawPart of result.fullStream) {
      const part = rawPart as { type: string; [k: string]: unknown };
      if (part.type === "text-delta") {
        yield { type: "text_delta", delta: part.textDelta as string };
      } else if (part.type === "reasoning") {
        yield { type: "reasoning_delta", delta: part.textDelta as string };
      } else if (part.type === "tool-call") {
        yield {
          type: "tool_call_start",
          toolName: part.toolName as string,
          args: part.args,
        };
      } else if (part.type === "tool-result") {
        yield {
          type: "tool_call_end",
          toolName: part.toolName as string,
          result: part.result,
        };
      } else if (part.type === "error") {
        const err = part.error as { message?: string } | string | undefined;
        const message =
          typeof err === "string" ? err : String(err?.message ?? err ?? "unknown error");
        yield { type: "error", errorClass: "unknown", message };
        return;
      }
    }
    const usage = await result.usage;
    yield {
      type: "usage",
      promptTokens: usage.promptTokens ?? 0,
      completionTokens: usage.completionTokens ?? 0,
    };
    yield { type: "done" };
  } catch (e) {
    const err = e as { message?: string };
    yield {
      type: "error",
      errorClass: "unknown",
      message: String(err?.message ?? err),
    };
  }
}
