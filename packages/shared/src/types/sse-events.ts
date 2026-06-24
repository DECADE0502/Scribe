import { z } from "zod";
import { AgentPhaseSchema } from "./agent-workflow.js";

export const AutoStateSchema = z.enum([
  "idle",
  "planning",
  "writing",
  "auditing",
  "paused_by_critical",
  "paused_by_user",
  "done",
  "error",
]);
export type AutoState = z.infer<typeof AutoStateSchema>;

export const AgentProgressStatusSchema = z.enum(["pending", "running", "done", "error"]);

export const SseEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("usage"),
    promptTokens: z.number(),
    completionTokens: z.number(),
    cachedTokens: z.number().optional(),
    reasoningTokens: z.number().optional(),
    taskType: z.enum(["write", "audit", "chat", "intent", "segment_revise", "plan_chapter", "new_book", "other"]).optional(),
    modelRole: z.enum(["write", "audit"]).optional(),
    chapterNo: z.number().nullable().optional(),
  }),
  z.object({
    type: z.literal("agent_progress"),
    runId: z.string().optional(),
    phase: AgentPhaseSchema,
    label: z.string(),
    status: AgentProgressStatusSchema,
    detail: z.string().optional(),
  }),
  z.object({ type: z.literal("agent_phase"), phase: AgentPhaseSchema }),
  z.object({ type: z.literal("main_output"), reply: z.string(), draft: z.string().optional() }),
  z.object({
    type: z.literal("validation_report"),
    verdict: z.enum(["pass", "repairable", "needs_user", "fail"]),
    issues: z.array(z.unknown()),
    commitAllowed: z.boolean(),
  }),
  z.object({ type: z.literal("repair_plan"), steps: z.array(z.unknown()), summary: z.string() }),
  z.object({
    type: z.literal("done"),
    committed: z.boolean().optional(),
    needsUserDecision: z.boolean().optional(),
    runId: z.string().optional(),
  }),
  z.object({ type: z.literal("error"), errorClass: z.string(), message: z.string() }),
]);
export type SseEvent = z.infer<typeof SseEventSchema>;
