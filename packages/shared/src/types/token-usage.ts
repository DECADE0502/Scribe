import { z } from "zod";
export const TaskTypeSchema = z.enum([
  "write",
  "audit",
  "chat",
  "extract",
  "revise",
  "onboard",
  "other",
]);
export const TokenUsageRecordSchema = z.object({
  id: z.number().int(),
  taskType: TaskTypeSchema,
  model: z.string(),
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  cachedTokens: z.number().int().nonnegative(),
  reasoningTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  chapterNo: z.number().int().nullable(),
  createdAt: z.number().int(),
});
export type TaskType = z.infer<typeof TaskTypeSchema>;
export type TokenUsageRecord = z.infer<typeof TokenUsageRecordSchema>;
