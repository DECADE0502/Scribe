import { z } from "zod";

export const ExecutionModeSchema = z.enum([
  "trusted_auto",
  "low_risk_auto",
  "confirm_each",
  "plan_only",
]);
export type ExecutionMode = z.infer<typeof ExecutionModeSchema>;
export const DEFAULT_EXECUTION_MODE: ExecutionMode = "low_risk_auto";
export const ExecutionModeWithDefaultSchema = ExecutionModeSchema.default(DEFAULT_EXECUTION_MODE);

export const AgentRunTargetSchema = z.object({
  chapterNo: z.number().int().positive().optional(),
  chapterCount: z.number().int().min(1).max(50).optional(),
  mode: z.enum(["write", "rewrite"]).optional(),
  defaultChapterLength: z.enum(["short", "medium", "long"]).optional(),
  revisionRange: z.object({
    chapterNo: z.number().int().positive(),
    selectedText: z.string().optional(),
    start: z.number().int().nonnegative().optional(),
    end: z.number().int().nonnegative().optional(),
  }).optional(),
  auditScope: z.object({
    assets: z.array(z.enum([
      "characters",
      "outline",
      "worldbook",
      "timeline",
      "foreshadowing",
      "chapters",
      "all",
    ])).default(["all"]),
    mode: z.enum(["report_only", "report_and_fix"]).default("report_only"),
  }).optional(),
}).passthrough();
export type AgentRunTarget = z.infer<typeof AgentRunTargetSchema>;

export const AgentRunRequestSchema = z.object({
  message: z.string().trim().min(1),
  source: z.enum(["chat", "editor", "auto", "onboard", "revision", "asset_audit"]),
  executionMode: ExecutionModeSchema.optional(),
  target: AgentRunTargetSchema.optional(),
});
export type AgentRunRequest = z.infer<typeof AgentRunRequestSchema>;
