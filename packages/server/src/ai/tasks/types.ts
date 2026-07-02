import type { LanguageModel } from "ai";
import type { BookHandle } from "../../http/book-registry.js";
import type { AgentRunRequest } from "@scribe/shared";

export interface TaskContext {
  handle: BookHandle;
  request: AgentRunRequest;
  writeModel: LanguageModel;
  auditModel: LanguageModel;
  abortSignal?: AbortSignal;
}

export type TaskStreamEvent = { type: "text_delta"; delta: string };

export interface TaskDef<TParsed = unknown> {
  name: string;
  stream(ctx: TaskContext): AsyncIterable<TaskStreamEvent>;
  parse(ctx: TaskContext, streamedText: string): Promise<TParsed>;
  apply(ctx: TaskContext, parsed: TParsed): void;
}
