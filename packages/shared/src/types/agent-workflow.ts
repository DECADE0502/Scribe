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

export const RiskLevelSchema = z.enum(["read", "draft", "write", "bulk_write", "destructive"]);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export const WorkflowTaskTypeSchema = z.enum([
  "write",
  "revise",
  "tool_update",
  "memory_update",
  "diagnose",
  "auto_run",
]);
export type WorkflowTaskType = z.infer<typeof WorkflowTaskTypeSchema>;

export const IntentContractSchema = z.object({
  taskId: z.string(),
  userRequest: z.string(),
  taskType: WorkflowTaskTypeSchema,
  mustDo: z.array(z.string()),
  mustNotDo: z.array(z.string()),
  acceptanceCriteria: z.array(z.string()),
  ambiguity: z.array(
    z.object({
      question: z.string(),
      defaultAssumption: z.string().optional(),
      requiresUser: z.boolean().optional(),
    }),
  ),
});
export type IntentContract = z.infer<typeof IntentContractSchema>;

export const HiddenDraftSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  kind: z.enum(["chapter", "revision", "plan", "diagnostic"]),
  target: z
    .object({
      chapterNo: z.number().int().optional(),
      segmentId: z.string().optional(),
      recordId: z.string().optional(),
    })
    .optional(),
  content: z.string(),
  metadata: z.record(z.unknown()).optional(),
});
export type HiddenDraft = z.infer<typeof HiddenDraftSchema>;

export const IntendedActionSchema = z.object({
  id: z.string(),
  type: z.string(),
  target: z.record(z.unknown()).optional(),
  payload: z.unknown().optional(),
  riskHint: RiskLevelSchema.optional(),
  reason: z.string(),
});
export type IntendedAction = z.infer<typeof IntendedActionSchema>;

export const ExecutionPolicySchema = z.object({
  taskId: z.string(),
  configuredMode: ExecutionModeSchema,
  effectiveMode: z.enum(["auto", "confirm", "blocked"]),
  highestRisk: RiskLevelSchema,
  requiresConfirmation: z.boolean(),
  reason: z.string(),
  rollbackPlan: z.string().optional(),
  userChoices: z.array(z.enum(["approve", "edit_plan", "reroll", "cancel"])),
});
export type ExecutionPolicy = z.infer<typeof ExecutionPolicySchema>;

export const ExecutionStepSchema = z.object({
  id: z.string(),
  actionType: z.string(),
  riskLevel: RiskLevelSchema,
  status: z.enum(["pending", "running", "succeeded", "failed", "skipped"]),
  toolName: z.string().optional(),
  argsSummary: z.string().optional(),
  resultSummary: z.string().optional(),
  verification: z
    .object({
      method: z.enum(["read_back", "panel_refresh", "audit", "state_compare"]),
      passed: z.boolean(),
      detail: z.string(),
    })
    .optional(),
});
export type ExecutionStep = z.infer<typeof ExecutionStepSchema>;

export const ExecutionTraceSchema = z.object({
  taskId: z.string(),
  mode: ExecutionModeSchema,
  policy: ExecutionPolicySchema,
  steps: z.array(ExecutionStepSchema),
  finalStatus: z.enum(["succeeded", "failed", "cancelled", "needs_user"]),
});
export type ExecutionTrace = z.infer<typeof ExecutionTraceSchema>;

export const CheckResultSchema = z.object({
  criterion: z.string(),
  status: z.enum(["pass", "fail", "unknown"]),
  evidence: z.string(),
});
export type CheckResult = z.infer<typeof CheckResultSchema>;

export const AcceptanceReportSchema = z.object({
  taskId: z.string(),
  verdict: z.enum(["pass", "repairable", "needs_user", "fail"]),
  userCriteria: z.array(CheckResultSchema),
  processCriteria: z.array(CheckResultSchema),
  domainCriteria: z.array(CheckResultSchema),
  recommendedActions: z.array(
    z.object({
      type: z.enum(["auto_repair", "ask_user", "reroll", "stop"]),
      reason: z.string(),
    }),
  ),
});
export type AcceptanceReport = z.infer<typeof AcceptanceReportSchema>;

// —— Agent Workflow 统一管线(2026-06-24) ——

export const AgentPhaseSchema = z.enum([
  "thinking",
  "executing",
  "validating",
  "waiting_user",
  "repairing",
  "completed",
]);
export type AgentPhase = z.infer<typeof AgentPhaseSchema>;

export const ValidationVerdictSchema = z.enum([
  "pass",
  "repairable",
  "needs_user",
  "fail",
]);
export type ValidationVerdict = z.infer<typeof ValidationVerdictSchema>;

export const ValidationIssueSchema = z.object({
  severity: z.enum(["info", "warning", "critical"]),
  area: z.enum([
    "user_request", "chapter", "character", "outline",
    "worldbook", "timeline", "foreshadowing", "record", "system",
  ]),
  message: z.string(),
  evidence: z.string().optional(),
  suggestedAction: z.enum(["repair", "reroll", "ask_user", "ignore", "stop"]),
});
export type ValidationIssue = z.infer<typeof ValidationIssueSchema>;

export const ValidationReportSchema = z.object({
  verdict: ValidationVerdictSchema,
  issues: z.array(ValidationIssueSchema),
  commitAllowed: z.boolean(),
});
export type ValidationReport = z.infer<typeof ValidationReportSchema>;

export const AgentRunRequestSchema = z.object({
  message: z.string(),
  source: z.enum(["chat", "editor", "auto", "onboard", "revision", "asset_audit"]),
  executionMode: ExecutionModeSchema.optional(),
  target: z.object({
    chapterNo: z.number().int().positive().optional(),
    chapterCount: z.number().int().min(1).max(50).optional(),
    revisionRange: z.object({
      chapterNo: z.number().int().positive(),
      selectedText: z.string().optional(),
    }).optional(),
  }).optional(),
});
export type AgentRunRequest = z.infer<typeof AgentRunRequestSchema>;

const riskRank: Record<RiskLevel, number> = {
  read: 0,
  draft: 1,
  write: 2,
  bulk_write: 3,
  destructive: 4,
};

const confirmationChoices = ["approve", "edit_plan", "reroll", "cancel"] as const;

export function classifyActionRisk(actionType: string, riskHint?: RiskLevel): RiskLevel {
  if (riskHint) {
    return riskHint;
  }

  const normalized = actionType.toLowerCase();
  if (
    normalized.includes("delete") ||
    normalized.includes("clear") ||
    normalized.includes("restore") ||
    normalized.includes("overwrite")
  ) {
    return "destructive";
  }
  if (
    normalized.includes("bulk") ||
    normalized.includes("batch") ||
    normalized.includes("multi") ||
    normalized.includes("three_chapters")
  ) {
    return "bulk_write";
  }
  if (
    normalized.includes("draft") ||
    normalized.includes("diagnostic") ||
    normalized.includes("preview_audit")
  ) {
    return "draft";
  }
  if (
    normalized.startsWith("list_") ||
    normalized.startsWith("get_") ||
    normalized.startsWith("recall") ||
    normalized.includes("preview")
  ) {
    return "read";
  }
  if (
    normalized.includes("write") ||
    normalized.includes("create") ||
    normalized.includes("update") ||
    normalized.includes("add_") ||
    normalized.includes("upsert") ||
    normalized.includes("pay_")
  ) {
    return "write";
  }

  return "read";
}

export function buildExecutionPolicy(input: {
  taskId: string;
  configuredMode?: ExecutionMode;
  actions: Array<{ type: string; riskHint?: RiskLevel }>;
}): ExecutionPolicy {
  const configuredMode = input.configuredMode ?? DEFAULT_EXECUTION_MODE;
  const risks = input.actions.map(action => classifyActionRisk(action.type, action.riskHint));
  const highestRisk = risks.reduce<RiskLevel>(
    (highest, risk) => (riskRank[risk] > riskRank[highest] ? risk : highest),
    "read",
  );

  let effectiveMode: ExecutionPolicy["effectiveMode"] = "auto";
  let reason = `${configuredMode} allows ${highestRisk} actions automatically`;

  if (configuredMode === "plan_only") {
    if (riskRank[highestRisk] <= riskRank.draft) {
      effectiveMode = "auto";
      reason = "plan_only allows read and draft actions";
    } else {
      effectiveMode = "blocked";
      reason = `plan_only blocks ${highestRisk} workspace mutations`;
    }
  } else if (configuredMode === "confirm_each") {
    if (riskRank[highestRisk] <= riskRank.draft) {
      effectiveMode = "auto";
      reason = "confirm_each allows read and draft actions automatically";
    } else {
      effectiveMode = "confirm";
      reason = `confirm_each requires confirmation for ${highestRisk} actions`;
    }
  } else if (configuredMode === "trusted_auto") {
    if (highestRisk === "destructive") {
      effectiveMode = "confirm";
      reason = "trusted_auto requires confirmation for destructive actions";
    }
  } else if (riskRank[highestRisk] >= riskRank.write) {
    effectiveMode = "confirm";
    reason = `low_risk_auto requires confirmation for ${highestRisk} actions`;
  } else {
    reason = "low_risk_auto allows read and draft actions automatically";
  }

  const requiresConfirmation = effectiveMode === "confirm";

  return {
    taskId: input.taskId,
    configuredMode,
    effectiveMode,
    highestRisk,
    requiresConfirmation,
    reason,
    userChoices: requiresConfirmation ? [...confirmationChoices] : [],
  };
}
