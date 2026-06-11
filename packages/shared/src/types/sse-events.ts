import { z } from "zod";

export const AutoStateSchema = z.enum([
  "idle", "planning", "writing", "auditing",
  "paused_by_critical", "paused_by_user", "done", "error",
]);
export type AutoState = z.infer<typeof AutoStateSchema>;

export const SseEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text_delta"), delta: z.string() }),
  z.object({ type: z.literal("reasoning_delta"), delta: z.string() }),
  z.object({ type: z.literal("tool_call_start"), toolName: z.string(), args: z.unknown() }),
  z.object({ type: z.literal("tool_call_end"), toolName: z.string(), result: z.unknown() }),
  z.object({
    type: z.literal("usage"),
    promptTokens: z.number(),
    completionTokens: z.number(),
    cachedTokens: z.number().optional(),
    reasoningTokens: z.number().optional(),
  }),
  z.object({
    type: z.literal("auto_status"),
    state: AutoStateSchema,
    remaining: z.number().int(),
    doneChapters: z.array(z.number().int()),
    currentChapter: z.number().int().optional(),
  }),
  // 意图识别结果(spec §7.3),前端可展示"识别到的意图"
  z.object({
    type: z.literal("intent"),
    category: z.enum([
      "chitchat", "writing_intent", "revise_intent",
      "query", "genre_section_op", "command_explicit", "other",
    ]),
    command: z.string().optional(),
  }),
  z.object({ type: z.literal("done") }),
  z.object({ type: z.literal("error"), errorClass: z.string(), message: z.string() }),
]);
export type SseEvent = z.infer<typeof SseEventSchema>;
