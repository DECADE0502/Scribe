import type { LanguageModel } from "ai";
import type { SseEvent } from "@scribe/shared";
import { streamLlm } from "../llm-call.js";
import { REVISE_PROMPT, buildReviseUserPrompt, type ReviseContext } from "../prompts/revise-segment.js";

export interface ReviseSegmentDeps {
  model: LanguageModel;
  abortSignal?: AbortSignal;
}

/**
 * 选段改写:流式输出新段落,**不落盘**。
 * 用户在前端接受后,通过 apply-revision 路由提交才持久化。
 */
export async function* reviseSegment(
  deps: ReviseSegmentDeps,
  ctx: ReviseContext,
): AsyncIterable<SseEvent> {
  if (!ctx.chapterContent.includes(ctx.segmentText)) {
    yield {
      type: "error",
      errorClass: "segment_not_found",
      message: "选中的段落与章节内容不匹配,请刷新后重试",
    };
    return;
  }
  const messages = [
    { role: "system" as const, content: REVISE_PROMPT },
    { role: "user" as const, content: buildReviseUserPrompt(ctx) },
  ];
  yield* streamLlm({ model: deps.model, messages, abortSignal: deps.abortSignal });
}
