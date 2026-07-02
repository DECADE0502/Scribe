import { z } from "zod";

export const SseEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("usage"),
    promptTokens: z.number(),
    completionTokens: z.number(),
    cachedTokens: z.number().optional(),
    reasoningTokens: z.number().optional(),
    taskType: z.enum(["write", "audit", "chat", "extract", "revise", "onboard", "other"]).optional(),
    modelRole: z.enum(["write", "audit"]).optional(),
    chapterNo: z.number().nullable().optional(),
  }),
  z.object({ type: z.literal("text_delta"), delta: z.string() }),
  z.object({
    type: z.literal("done"),
    committed: z.boolean(),
    detail: z.string().optional(),
  }),
  z.object({
    type: z.literal("error"),
    errorClass: z.enum(["stream_failed", "parse_failed", "apply_failed", "bad_request", "provider_error"]),
    message: z.string(),
  }),
]);
export type SseEvent = z.infer<typeof SseEventSchema>;
