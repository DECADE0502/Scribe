import { z } from "zod";
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
  z.object({ type: z.literal("done") }),
  z.object({ type: z.literal("error"), errorClass: z.string(), message: z.string() }),
]);
export type SseEvent = z.infer<typeof SseEventSchema>;
