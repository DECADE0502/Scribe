import { z } from "zod";
import {
  AcceptanceReportSchema,
  ExecutionModeSchema,
  ExecutionPolicySchema,
  ExecutionStepSchema,
  IntentContractSchema,
} from "./agent-workflow.js";

export const AutoStateSchema = z.enum([
  "idle", "planning", "writing", "auditing",
  "paused_by_critical", "paused_by_user", "done", "error",
]);
export type AutoState = z.infer<typeof AutoStateSchema>;

export const SseEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text_delta"), delta: z.string() }),
  z.object({ type: z.literal("reasoning_delta"), delta: z.string() }),
  z.object({ type: z.literal("tool_call_start"), toolName: z.string(), args: z.unknown().optional() }),
  z.object({ type: z.literal("tool_call_end"), toolName: z.string(), result: z.unknown() }),
  z.object({
    type: z.literal("usage"),
    promptTokens: z.number(),
    completionTokens: z.number(),
    cachedTokens: z.number().optional(),
    reasoningTokens: z.number().optional(),
    /** 计费上下文:本次调用属于哪种任务、用的哪类模型、对应章号(由编排层标注,路由据此分类+定价) */
    taskType: z.enum(["write", "audit", "chat", "intent", "segment_revise", "plan_chapter", "new_book", "other"]).optional(),
    modelRole: z.enum(["write", "audit"]).optional(),
    chapterNo: z.number().nullable().optional(),
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
      "query", "genre_section_op", "command_explicit", "delete_intent", "agentic", "other",
    ]),
    command: z.string().optional(),
  }),
  z.object({ type: z.literal("workflow_mode"), mode: ExecutionModeSchema }),
  z.object({
    type: z.literal("execution_plan"),
    taskId: z.string(),
    policy: ExecutionPolicySchema,
    steps: z.array(ExecutionStepSchema),
    intentContract: IntentContractSchema.optional(),
  }),
  z.object({
    type: z.literal("execution_step"),
    taskId: z.string(),
    step: ExecutionStepSchema,
  }),
  z.object({
    type: z.literal("confirmation_required"),
    taskId: z.string(),
    policy: ExecutionPolicySchema,
    message: z.string(),
  }),
  z.object({ type: z.literal("acceptance_report"), report: AcceptanceReportSchema }),
  // —— Agent Workflow 统一管线(2026-06-24) ——
  z.object({ type: z.literal("agent_phase"), phase: z.enum(["thinking","executing","validating","waiting_user","repairing","completed"]) }),
  z.object({ type: z.literal("main_output"), reply: z.string(), draft: z.string().optional() }),
  z.object({ type: z.literal("validation_report"), verdict: z.enum(["pass","repairable","needs_user","fail"]), issues: z.array(z.unknown()), commitAllowed: z.boolean() }),
  z.object({ type: z.literal("repair_plan"), steps: z.array(z.unknown()), summary: z.string() }),
  z.object({ type: z.literal("done"), committed: z.boolean().optional(), needsUserDecision: z.boolean().optional(), runId: z.string().optional() }),
  z.object({ type: z.literal("error"), errorClass: z.string(), message: z.string() }),
]);
export type SseEvent = z.infer<typeof SseEventSchema>;
