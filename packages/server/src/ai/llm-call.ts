import { streamText, type LanguageModel, type CoreMessage, type Tool } from "ai";
import type { SseEvent } from "@scribe/shared";

export interface LlmCallInput {
  model: LanguageModel;
  messages: CoreMessage[];
  tools?: Record<string, Tool>;
  abortSignal?: AbortSignal;
  /**
   * Vercel AI SDK 默认 maxSteps=1(只跑一次)。要让模型在 tool_call 之后自动续写,
   * 需要让 streamText 多步执行。本字段控制最多续写多少轮,默认 5。
   */
  maxSteps?: number;
}

/**
 * B-6-002 修复:工具执行抛错时,SDK 会把整个流断掉(LLM 没机会纠正)。
 * 这里把每个工具的 execute 包一层 try/catch,错误转成普通工具结果
 * `{ success: false, error }` 返回给 LLM,让它在下一步自我修正(改参数重试等)。
 */
function withToolErrorRecovery(
  tools: Record<string, Tool> | undefined,
): Record<string, Tool> | undefined {
  if (!tools) return undefined;
  const wrapped: Record<string, Tool> = {};
  for (const [name, tool] of Object.entries(tools)) {
    const execute = tool.execute;
    if (!execute) {
      wrapped[name] = tool;
      continue;
    }
    wrapped[name] = {
      ...tool,
      execute: async (args, options) => {
        try {
          return await execute(args, options);
        } catch (e) {
          const err = e as { message?: string };
          return { success: false, error: String(err?.message ?? err) };
        }
      },
    } as Tool;
  }
  return wrapped;
}

export async function* streamLlm(input: LlmCallInput): AsyncIterable<SseEvent> {
  try {
    const result = streamText({
      model: input.model,
      messages: input.messages,
      tools: withToolErrorRecovery(input.tools),
      maxSteps: input.maxSteps ?? 5,
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
