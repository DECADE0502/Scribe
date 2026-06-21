# Agent Workflow Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Phase 1 of the Scribe agent workflow system: UI execution modes, hidden writing workflow, execution plans, execution traces, read-back verification, and acceptance reports.

**Architecture:** Add shared workflow contracts first, then route server SSE events through those contracts, then teach the client store and conversation UI to display execution mode, confirmation cards, trace steps, and acceptance results. Keep the implementation incremental: existing write flows continue working while new workflow artifacts wrap them.

**Tech Stack:** TypeScript, Zod, Vercel AI SDK event streams, Hono server routes, React, Zustand, Vitest, Testing Library.

## Global Constraints

- Phase 1 implements A+C only: tool reliability and controllable writing workflow.
- Memory evidence links and professional revision workflows are interface-only in Phase 1.
- Default execution mode is `low_risk_auto`.
- Chapter prose and hidden drafts must not appear as ordinary chat text.
- Mutating tool actions must have an execution trace and read-back or equivalent verification.
- Acceptance reports must check the main agent intent criteria before generic process and domain criteria.
- Do not implement chapter-level outline blueprint enforcement.
- Do not make outline arcs stricter.
- Do not mix this plan's commits with unrelated dirty working tree changes.

---

## File Structure

Create or modify these files:

- Create `packages/shared/src/types/agent-workflow.ts`: shared workflow enums, Zod schemas, TypeScript types, risk classification helpers, and execution policy helper.
- Modify `packages/shared/src/index.ts`: export the workflow contracts.
- Modify `packages/shared/src/types/sse-events.ts`: add SSE events for workflow mode, execution plans, execution steps, confirmation requests, and acceptance reports.
- Add `packages/shared/tests/agent-workflow.test.ts`: unit coverage for risk classification and policy decisions.
- Add `packages/server/src/ai/orchestrator/workflow-contract.ts`: server helpers to build intent contracts, execution traces, and acceptance reports from existing flows.
- Add `packages/server/tests/unit/ai/orchestrator/workflow-contract.test.ts`: server-side contract helper tests.
- Modify `packages/server/src/ai/orchestrator/conversation-orchestrator.ts`: emit workflow events around writing and agentic tool flows.
- Modify `packages/server/src/http/routes/conversation.ts`: accept optional execution mode from request body and pass it to orchestration.
- Add or modify `packages/server/tests/integration/chat-streaming.test.ts`: assert workflow events and hidden prose behavior.
- Modify `packages/client/src/stores/conversation.ts`: store execution mode, pending confirmation, execution trace, and acceptance report.
- Add `packages/client/src/components/conversation/execution-mode-selector.tsx`: UI selector for execution mode.
- Add `packages/client/src/components/conversation/execution-confirmation-card.tsx`: approve/edit/reroll/cancel card.
- Modify `packages/client/src/components/conversation/conversation-pane.tsx`: send execution mode, handle workflow SSE events, render selector and confirmation card.
- Modify `packages/client/src/components/conversation/streaming-message.tsx`: show execution steps and acceptance summaries.
- Add `packages/client/tests/components/execution-mode-selector.test.tsx`.
- Add `packages/client/tests/components/execution-confirmation-card.test.tsx`.
- Add or modify `packages/client/tests/components/conversation-writing-intent.test.tsx`: verify hidden prose and workflow state.

---

### Task 1: Shared Workflow Contracts And Policy

**Files:**
- Create: `packages/shared/src/types/agent-workflow.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/tests/agent-workflow.test.ts`

**Interfaces:**
- Produces:
  - `ExecutionMode`
  - `RiskLevel`
  - `IntentContract`
  - `HiddenDraft`
  - `IntendedAction`
  - `ExecutionPolicy`
  - `ExecutionStep`
  - `ExecutionTrace`
  - `AcceptanceReport`
  - `classifyActionRisk(actionType: string, riskHint?: RiskLevel): RiskLevel`
  - `buildExecutionPolicy(input: { taskId: string; configuredMode: ExecutionMode; actions: Array<{ type: string; riskHint?: RiskLevel }> }): ExecutionPolicy`
- Consumes: no prior task output.

- [ ] **Step 1: Write the failing shared tests**

Create `packages/shared/tests/agent-workflow.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  buildExecutionPolicy,
  classifyActionRisk,
  ExecutionPolicySchema,
} from "../src/index.js";

describe("agent workflow policy", () => {
  it("defaults low-risk auto to confirmation for formal writes", () => {
    const policy = buildExecutionPolicy({
      taskId: "task-1",
      configuredMode: "low_risk_auto",
      actions: [{ type: "chapter_write" }],
    });

    expect(policy.effectiveMode).toBe("confirm");
    expect(policy.requiresConfirmation).toBe(true);
    expect(policy.highestRisk).toBe("write");
    expect(policy.userChoices).toEqual(["approve", "edit_plan", "reroll", "cancel"]);
    expect(() => ExecutionPolicySchema.parse(policy)).not.toThrow();
  });

  it("allows read and draft actions in low-risk auto", () => {
    const policy = buildExecutionPolicy({
      taskId: "task-2",
      configuredMode: "low_risk_auto",
      actions: [{ type: "list_characters" }, { type: "hidden_draft" }],
    });

    expect(policy.effectiveMode).toBe("auto");
    expect(policy.requiresConfirmation).toBe(false);
    expect(policy.highestRisk).toBe("draft");
  });

  it("blocks all writes in plan-only mode", () => {
    const policy = buildExecutionPolicy({
      taskId: "task-3",
      configuredMode: "plan_only",
      actions: [{ type: "update_character" }],
    });

    expect(policy.effectiveMode).toBe("blocked");
    expect(policy.requiresConfirmation).toBe(false);
    expect(policy.reason).toContain("plan_only");
  });

  it("never auto-executes destructive actions in trusted auto", () => {
    const policy = buildExecutionPolicy({
      taskId: "task-4",
      configuredMode: "trusted_auto",
      actions: [{ type: "delete_character" }],
    });

    expect(policy.highestRisk).toBe("destructive");
    expect(policy.effectiveMode).toBe("confirm");
  });

  it("classifies common action names", () => {
    expect(classifyActionRisk("list_outline")).toBe("read");
    expect(classifyActionRisk("hidden_draft")).toBe("draft");
    expect(classifyActionRisk("update_character")).toBe("write");
    expect(classifyActionRisk("write_three_chapters")).toBe("bulk_write");
    expect(classifyActionRisk("delete_outline_node")).toBe("destructive");
  });
});
```

- [ ] **Step 2: Run the shared test to verify it fails**

Run:

```bash
pnpm --filter @scribe/shared exec vitest run tests/agent-workflow.test.ts
```

Expected: fail because `agent-workflow` exports do not exist.

- [ ] **Step 3: Implement shared contracts**

Create `packages/shared/src/types/agent-workflow.ts`:

```ts
import { z } from "zod";

export const ExecutionModeSchema = z.enum([
  "trusted_auto",
  "low_risk_auto",
  "confirm_each",
  "plan_only",
]);
export type ExecutionMode = z.infer<typeof ExecutionModeSchema>;

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

export const IntentContractSchema = z.object({
  taskId: z.string().min(1),
  userRequest: z.string(),
  taskType: WorkflowTaskTypeSchema,
  mustDo: z.array(z.string()),
  mustNotDo: z.array(z.string()),
  acceptanceCriteria: z.array(z.string()),
  ambiguity: z.array(z.object({
    question: z.string(),
    defaultAssumption: z.string().optional(),
    requiresUser: z.boolean().optional(),
  })),
});
export type IntentContract = z.infer<typeof IntentContractSchema>;

export const HiddenDraftSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  kind: z.enum(["chapter", "revision", "plan", "diagnostic"]),
  target: z.object({
    chapterNo: z.number().int().positive().optional(),
    segmentId: z.string().optional(),
    recordId: z.string().optional(),
  }).optional(),
  content: z.string(),
  metadata: z.record(z.unknown()).optional(),
});
export type HiddenDraft = z.infer<typeof HiddenDraftSchema>;

export const IntendedActionSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  target: z.record(z.unknown()).optional(),
  payload: z.record(z.unknown()).optional(),
  riskHint: RiskLevelSchema.optional(),
  reason: z.string(),
});
export type IntendedAction = z.infer<typeof IntendedActionSchema>;

export const ExecutionPolicySchema = z.object({
  taskId: z.string().min(1),
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
  id: z.string().min(1),
  actionType: z.string().min(1),
  riskLevel: RiskLevelSchema,
  status: z.enum(["pending", "running", "succeeded", "failed", "skipped"]),
  toolName: z.string().optional(),
  argsSummary: z.string().optional(),
  resultSummary: z.string().optional(),
  verification: z.object({
    method: z.enum(["read_back", "panel_refresh", "audit", "state_compare"]),
    passed: z.boolean(),
    detail: z.string(),
  }).optional(),
});
export type ExecutionStep = z.infer<typeof ExecutionStepSchema>;

export const ExecutionTraceSchema = z.object({
  taskId: z.string().min(1),
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
  taskId: z.string().min(1),
  verdict: z.enum(["pass", "repairable", "needs_user", "fail"]),
  userCriteria: z.array(CheckResultSchema),
  processCriteria: z.array(CheckResultSchema),
  domainCriteria: z.array(CheckResultSchema),
  recommendedActions: z.array(z.object({
    type: z.enum(["auto_repair", "ask_user", "reroll", "stop"]),
    reason: z.string(),
  })),
});
export type AcceptanceReport = z.infer<typeof AcceptanceReportSchema>;

const riskRank: Record<RiskLevel, number> = {
  read: 0,
  draft: 1,
  write: 2,
  bulk_write: 3,
  destructive: 4,
};

export function classifyActionRisk(actionType: string, riskHint?: RiskLevel): RiskLevel {
  if (riskHint) return riskHint;
  const normalized = actionType.toLowerCase();
  if (normalized.includes("delete") || normalized.includes("clear") || normalized.includes("restore") || normalized.includes("overwrite")) {
    return "destructive";
  }
  if (normalized.includes("bulk") || normalized.includes("batch") || normalized.includes("multi") || normalized.includes("three_chapters")) {
    return "bulk_write";
  }
  if (normalized.includes("draft") || normalized.includes("diagnostic") || normalized.includes("preview_audit")) {
    return "draft";
  }
  if (normalized.startsWith("list_") || normalized.startsWith("get_") || normalized.startsWith("recall") || normalized.includes("preview")) {
    return "read";
  }
  if (normalized.includes("write") || normalized.includes("create") || normalized.includes("update") || normalized.includes("add_") || normalized.includes("upsert") || normalized.includes("pay_")) {
    return "write";
  }
  return "read";
}

function maxRisk(actions: Array<{ type: string; riskHint?: RiskLevel }>): RiskLevel {
  return actions
    .map((action) => classifyActionRisk(action.type, action.riskHint))
    .sort((a, b) => riskRank[b] - riskRank[a])[0] ?? "read";
}

export function buildExecutionPolicy(input: {
  taskId: string;
  configuredMode: ExecutionMode;
  actions: Array<{ type: string; riskHint?: RiskLevel }>;
}): ExecutionPolicy {
  const highestRisk = maxRisk(input.actions);
  const choices: ExecutionPolicy["userChoices"] = ["approve", "edit_plan", "reroll", "cancel"];

  if (input.configuredMode === "plan_only") {
    return {
      taskId: input.taskId,
      configuredMode: input.configuredMode,
      effectiveMode: highestRisk === "read" || highestRisk === "draft" ? "auto" : "blocked",
      highestRisk,
      requiresConfirmation: false,
      reason: highestRisk === "read" || highestRisk === "draft"
        ? "plan_only allows read and draft actions"
        : "plan_only blocks workspace mutations",
      userChoices: choices,
    };
  }

  if (input.configuredMode === "confirm_each") {
    return {
      taskId: input.taskId,
      configuredMode: input.configuredMode,
      effectiveMode: highestRisk === "read" || highestRisk === "draft" ? "auto" : "confirm",
      highestRisk,
      requiresConfirmation: highestRisk !== "read" && highestRisk !== "draft",
      reason: "confirm_each requires approval before writes",
      userChoices: choices,
    };
  }

  if (input.configuredMode === "trusted_auto") {
    return {
      taskId: input.taskId,
      configuredMode: input.configuredMode,
      effectiveMode: highestRisk === "destructive" ? "confirm" : "auto",
      highestRisk,
      requiresConfirmation: highestRisk === "destructive",
      reason: highestRisk === "destructive"
        ? "destructive actions always require confirmation"
        : "trusted_auto allows non-destructive actions",
      userChoices: choices,
    };
  }

  return {
    taskId: input.taskId,
    configuredMode: input.configuredMode,
    effectiveMode: highestRisk === "read" || highestRisk === "draft" ? "auto" : "confirm",
    highestRisk,
    requiresConfirmation: highestRisk !== "read" && highestRisk !== "draft",
    reason: highestRisk === "read" || highestRisk === "draft"
      ? "low_risk_auto allows read and draft actions"
      : "low_risk_auto requires confirmation before durable writes",
    userChoices: choices,
  };
}
```

Modify `packages/shared/src/index.ts`:

```ts
export * from "./types/agent-workflow.js";
```

Keep existing exports in the file and append this export.

- [ ] **Step 4: Run shared tests and typecheck**

Run:

```bash
pnpm --filter @scribe/shared exec vitest run tests/agent-workflow.test.ts
pnpm --filter @scribe/shared typecheck
```

Expected: both pass.

- [ ] **Step 5: Commit Task 1**

```bash
git add packages/shared/src/types/agent-workflow.ts packages/shared/src/index.ts packages/shared/tests/agent-workflow.test.ts
git commit -m "feat(shared): add agent workflow contracts"
```

---

### Task 2: Workflow SSE Events

**Files:**
- Modify: `packages/shared/src/types/sse-events.ts`
- Test: `packages/shared/tests/agent-workflow.test.ts`

**Interfaces:**
- Consumes: `ExecutionModeSchema`, `ExecutionPolicySchema`, `ExecutionStepSchema`, `ExecutionTraceSchema`, `AcceptanceReportSchema`, `IntentContractSchema`.
- Produces new `SseEvent` variants:
  - `workflow_mode`
  - `execution_plan`
  - `execution_step`
  - `confirmation_required`
  - `acceptance_report`

- [ ] **Step 1: Write failing SSE schema tests**

Append to `packages/shared/tests/agent-workflow.test.ts`:

```ts
import { SseEventSchema } from "../src/index.js";

describe("workflow SSE events", () => {
  it("parses execution plan and acceptance report events", () => {
    expect(() => SseEventSchema.parse({
      type: "execution_plan",
      taskId: "task-1",
      policy: buildExecutionPolicy({
        taskId: "task-1",
        configuredMode: "low_risk_auto",
        actions: [{ type: "chapter_write" }],
      }),
      steps: [{
        id: "step-1",
        actionType: "chapter_write",
        riskLevel: "write",
        status: "pending",
      }],
    })).not.toThrow();

    expect(() => SseEventSchema.parse({
      type: "acceptance_report",
      report: {
        taskId: "task-1",
        verdict: "pass",
        userCriteria: [{ criterion: "write chapter", status: "pass", evidence: "chapter read back" }],
        processCriteria: [],
        domainCriteria: [],
        recommendedActions: [],
      },
    })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the shared test to verify it fails**

Run:

```bash
pnpm --filter @scribe/shared exec vitest run tests/agent-workflow.test.ts
```

Expected: fail because the SSE schema does not accept workflow events.

- [ ] **Step 3: Add workflow event variants**

Modify `packages/shared/src/types/sse-events.ts` imports:

```ts
import {
  AcceptanceReportSchema,
  ExecutionModeSchema,
  ExecutionPolicySchema,
  ExecutionStepSchema,
  IntentContractSchema,
} from "./agent-workflow.js";
```

Add these objects inside `SseEventSchema`'s discriminated union before `done`:

```ts
  z.object({
    type: z.literal("workflow_mode"),
    mode: ExecutionModeSchema,
  }),
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
  z.object({
    type: z.literal("acceptance_report"),
    report: AcceptanceReportSchema,
  }),
```

- [ ] **Step 4: Run shared tests and typecheck**

Run:

```bash
pnpm --filter @scribe/shared exec vitest run tests/agent-workflow.test.ts
pnpm --filter @scribe/shared typecheck
```

Expected: both pass.

- [ ] **Step 5: Commit Task 2**

```bash
git add packages/shared/src/types/sse-events.ts packages/shared/tests/agent-workflow.test.ts
git commit -m "feat(shared): add workflow sse events"
```

---

### Task 3: Server Workflow Contract Helpers

**Files:**
- Create: `packages/server/src/ai/orchestrator/workflow-contract.ts`
- Test: `packages/server/tests/unit/ai/orchestrator/workflow-contract.test.ts`

**Interfaces:**
- Consumes: shared workflow types from Task 1.
- Produces:
  - `createTaskId(prefix?: string): string`
  - `buildWriteIntentContract(input: { taskId: string; userRequest: string; chapterNos: number[] }): IntentContract`
  - `makeExecutionSteps(actions: IntendedAction[]): ExecutionStep[]`
  - `makeAcceptanceReport(input: { contract: IntentContract; trace: ExecutionTrace }): AcceptanceReport`

- [ ] **Step 1: Write failing server helper tests**

Create `packages/server/tests/unit/ai/orchestrator/workflow-contract.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  buildWriteIntentContract,
  makeAcceptanceReport,
  makeExecutionSteps,
} from "../../../../src/ai/orchestrator/workflow-contract.js";
import { buildExecutionPolicy, type ExecutionTrace, type IntendedAction } from "@scribe/shared";

describe("workflow contract helpers", () => {
  it("builds a write intent contract that requires hidden prose and read-back", () => {
    const contract = buildWriteIntentContract({
      taskId: "task-write-1",
      userRequest: "直接写前三章",
      chapterNos: [1, 2, 3],
    });

    expect(contract.taskType).toBe("write");
    expect(contract.mustDo).toContain("Generate 3 chapter bodies");
    expect(contract.mustNotDo.join("\n")).toContain("ordinary chat");
    expect(contract.acceptanceCriteria.join("\n")).toContain("3 successful chapter write steps");
  });

  it("turns intended actions into pending execution steps", () => {
    const actions: IntendedAction[] = [
      { id: "a1", type: "list_characters", reason: "avoid duplicates" },
      { id: "a2", type: "chapter_write", reason: "persist chapter" },
    ];

    const steps = makeExecutionSteps(actions);

    expect(steps.map((step) => step.status)).toEqual(["pending", "pending"]);
    expect(steps.map((step) => step.riskLevel)).toEqual(["read", "write"]);
  });

  it("passes acceptance when all user criteria have verified steps", () => {
    const contract = buildWriteIntentContract({
      taskId: "task-write-2",
      userRequest: "写一章",
      chapterNos: [6],
    });
    const policy = buildExecutionPolicy({
      taskId: contract.taskId,
      configuredMode: "trusted_auto",
      actions: [{ type: "chapter_write" }],
    });
    const trace: ExecutionTrace = {
      taskId: contract.taskId,
      mode: "trusted_auto",
      policy,
      finalStatus: "succeeded",
      steps: [{
        id: "step-1",
        actionType: "chapter_write",
        riskLevel: "write",
        status: "succeeded",
        toolName: "chapter_write",
        verification: { method: "read_back", passed: true, detail: "chapter 6 read back" },
      }],
    };

    const report = makeAcceptanceReport({ contract, trace });

    expect(report.verdict).toBe("pass");
    expect(report.userCriteria.every((item) => item.status === "pass")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the server helper test to verify it fails**

Run:

```bash
pnpm --filter @scribe/server exec vitest run tests/unit/ai/orchestrator/workflow-contract.test.ts
```

Expected: fail because `workflow-contract.ts` does not exist.

- [ ] **Step 3: Implement server helper module**

Create `packages/server/src/ai/orchestrator/workflow-contract.ts`:

```ts
import {
  buildExecutionPolicy,
  classifyActionRisk,
  type AcceptanceReport,
  type ExecutionStep,
  type ExecutionTrace,
  type IntentContract,
  type IntendedAction,
} from "@scribe/shared";

let taskSeq = 0;

export function createTaskId(prefix = "task"): string {
  taskSeq += 1;
  return `${prefix}-${Date.now()}-${taskSeq}`;
}

export function buildWriteIntentContract(input: {
  taskId: string;
  userRequest: string;
  chapterNos: number[];
}): IntentContract {
  const count = input.chapterNos.length;
  return {
    taskId: input.taskId,
    userRequest: input.userRequest,
    taskType: "write",
    mustDo: [
      `Generate ${count} chapter bodies`,
      "Keep chapter bodies out of ordinary chat messages",
      "Write target chapters through chapter write operations",
      "Keep visible workflow status until the task is done",
    ],
    mustNotDo: [
      "Do not stream chapter prose as normal chat text",
      "Do not claim completion before read-back verification",
    ],
    acceptanceCriteria: [
      `There are ${count} successful chapter write steps`,
      "Read-back verifies every target chapter contains content",
      "The streaming workflow remains visible until done",
      "No hidden draft prose appears as an ordinary chat message",
    ],
    ambiguity: [],
  };
}

export function makeExecutionSteps(actions: IntendedAction[]): ExecutionStep[] {
  return actions.map((action, index) => ({
    id: `step-${index + 1}`,
    actionType: action.type,
    riskLevel: classifyActionRisk(action.type, action.riskHint),
    status: "pending",
  }));
}

export function makeWriteActions(chapterNos: number[]): IntendedAction[] {
  const actionType = chapterNos.length > 1 ? "multi_chapter_write" : "chapter_write";
  return chapterNos.map((chapterNo, index) => ({
    id: `write-${chapterNo}`,
    type: actionType,
    target: { chapterNo },
    riskHint: chapterNos.length > 1 ? "bulk_write" : "write",
    reason: `Persist chapter ${chapterNo}`,
  }));
}

export function makeWritePolicy(input: {
  taskId: string;
  mode: Parameters<typeof buildExecutionPolicy>[0]["configuredMode"];
  chapterNos: number[];
}) {
  return buildExecutionPolicy({
    taskId: input.taskId,
    configuredMode: input.mode,
    actions: makeWriteActions(input.chapterNos),
  });
}

export function makeAcceptanceReport(input: {
  contract: IntentContract;
  trace: ExecutionTrace;
}): AcceptanceReport {
  const writeSteps = input.trace.steps.filter((step) => step.actionType.includes("write"));
  const verifiedWriteSteps = writeSteps.filter((step) =>
    step.status === "succeeded" && step.verification?.passed === true,
  );
  const traceSucceeded = input.trace.finalStatus === "succeeded";
  const allWritesVerified = writeSteps.length > 0 && writeSteps.length === verifiedWriteSteps.length;

  const userCriteria = input.contract.acceptanceCriteria.map((criterion) => {
    if (criterion.includes("successful chapter write steps")) {
      return {
        criterion,
        status: allWritesVerified ? "pass" as const : "fail" as const,
        evidence: `${verifiedWriteSteps.length}/${writeSteps.length} write steps verified`,
      };
    }
    if (criterion.includes("Read-back")) {
      return {
        criterion,
        status: allWritesVerified ? "pass" as const : "fail" as const,
        evidence: allWritesVerified ? "all write steps include read-back verification" : "missing read-back verification",
      };
    }
    return {
      criterion,
      status: traceSucceeded ? "pass" as const : "unknown" as const,
      evidence: traceSucceeded ? "execution trace completed" : "execution trace did not complete",
    };
  });

  const processCriteria = [{
    criterion: "Execution trace final status is succeeded",
    status: traceSucceeded ? "pass" as const : "fail" as const,
    evidence: `finalStatus=${input.trace.finalStatus}`,
  }];

  const failed = [...userCriteria, ...processCriteria].some((item) => item.status === "fail");

  return {
    taskId: input.contract.taskId,
    verdict: failed ? "fail" : "pass",
    userCriteria,
    processCriteria,
    domainCriteria: [],
    recommendedActions: failed ? [{ type: "stop", reason: "workflow criteria failed" }] : [],
  };
}
```

- [ ] **Step 4: Run helper tests and server typecheck**

Run:

```bash
pnpm --filter @scribe/server exec vitest run tests/unit/ai/orchestrator/workflow-contract.test.ts
pnpm --filter @scribe/server typecheck
```

Expected: both pass.

- [ ] **Step 5: Commit Task 3**

```bash
git add packages/server/src/ai/orchestrator/workflow-contract.ts packages/server/tests/unit/ai/orchestrator/workflow-contract.test.ts
git commit -m "feat(server): add workflow contract helpers"
```

---

### Task 4: Conversation Request Execution Mode

**Files:**
- Modify: `packages/server/src/ai/orchestrator/conversation-orchestrator.ts`
- Modify: `packages/server/src/http/routes/conversation.ts`
- Test: `packages/server/tests/integration/chat-streaming.test.ts`

**Interfaces:**
- Consumes: `ExecutionMode`.
- Produces:
  - `ConversationInput.executionMode?: ExecutionMode`
  - request body `{ message: string; executionMode?: ExecutionMode }`.

- [ ] **Step 1: Write failing integration test**

Add a test in `packages/server/tests/integration/chat-streaming.test.ts` that posts a conversation request with `executionMode: "plan_only"` and expects the server to accept the field without 400:

```ts
it("accepts executionMode in conversation requests", async () => {
  const res = await app.request("/api/books/b1/conversation", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "看一下角色", executionMode: "plan_only" }),
  });

  expect(res.status).toBe(200);
});
```

Use the existing `app` setup from the file. If that setup uses a different book id, use the test's created book id instead of `b1`.

- [ ] **Step 2: Run the integration test to verify it fails or ignores mode**

Run:

```bash
pnpm --filter @scribe/server exec vitest run tests/integration/chat-streaming.test.ts
```

Expected: fail if the route validates a narrower body, or pass but without coverage for mode propagation. Continue either way; the implementation is still required.

- [ ] **Step 3: Add execution mode to server input**

Modify `packages/server/src/ai/orchestrator/conversation-orchestrator.ts`:

```ts
import type { ExecutionMode } from "@scribe/shared";
```

Extend `ConversationInput`:

```ts
export interface ConversationInput {
  message: string;
  history?: CoreMessage[];
  executionMode?: ExecutionMode;
}
```

In `runConversation`, derive:

```ts
const executionMode = input.executionMode ?? "low_risk_auto";
```

This variable will be used by Task 5. For now, emit mode at the start after slash command parsing:

```ts
yield { type: "workflow_mode", mode: executionMode };
```

- [ ] **Step 4: Parse execution mode in route**

Modify `packages/server/src/http/routes/conversation.ts` body parsing:

```ts
import { ExecutionModeSchema } from "@scribe/shared";
```

When reading JSON, parse:

```ts
const executionMode = ExecutionModeSchema.optional().catch(undefined).parse(body.executionMode);
```

Pass it to `runConversation`:

```ts
runConversation(deps, {
  message,
  history,
  executionMode,
});
```

Keep current route behavior for requests without `executionMode`.

- [ ] **Step 5: Run server tests and typecheck**

Run:

```bash
pnpm --filter @scribe/server exec vitest run tests/integration/chat-streaming.test.ts
pnpm --filter @scribe/server typecheck
```

Expected: both pass.

- [ ] **Step 6: Commit Task 4**

```bash
git add packages/server/src/ai/orchestrator/conversation-orchestrator.ts packages/server/src/http/routes/conversation.ts packages/server/tests/integration/chat-streaming.test.ts
git commit -m "feat(server): accept conversation execution mode"
```

---

### Task 5: Server Writing Workflow Plan, Trace, And Acceptance Events

**Files:**
- Modify: `packages/server/src/ai/orchestrator/conversation-orchestrator.ts`
- Modify: `packages/server/tests/unit/ai/orchestrator/conversation-orchestrator.test.ts`

**Interfaces:**
- Consumes helpers from Task 3.
- Produces workflow events around natural language write requests:
  - `execution_plan`
  - `confirmation_required` when policy requires confirmation
  - `execution_step` for chapter write start/success/read-back
  - `acceptance_report`

- [ ] **Step 1: Write failing unit test for plan-only**

Add to `packages/server/tests/unit/ai/orchestrator/conversation-orchestrator.test.ts`:

```ts
it("plan-only writing request emits a plan and does not write chapters", async () => {
  deps.model = makeWritingModel("new chapter body");
  deps.auditModel = makeAuditAndRecordModel();

  const before = handle.chaptersRepo.maxChapterNo();
  const evs = await collect(runConversation(deps, {
    message: "write the first 2 chapters",
    executionMode: "plan_only",
  }));

  expect(evs.find(e => e.type === "execution_plan")).toBeTruthy();
  expect(evs.find(e => e.type === "confirmation_required")).toBeTruthy();
  expect(evs.some(e => e.type === "tool_call_start" && e.toolName === "chapter_write")).toBe(false);
  expect(handle.chaptersRepo.maxChapterNo()).toBe(before);
});
```

- [ ] **Step 2: Write failing unit test for trusted auto acceptance**

Add:

```ts
it("trusted auto writing emits execution steps and acceptance report", async () => {
  deps.model = makeWritingModel("new chapter body");
  deps.auditModel = makeAuditAndRecordModel();

  const evs = await collect(runConversation(deps, {
    message: "write the first 1 chapter",
    executionMode: "trusted_auto",
  }));

  expect(evs.find(e => e.type === "execution_plan")).toBeTruthy();
  const steps = evs.filter(e => e.type === "execution_step");
  expect(steps.some(e => e.step.actionType.includes("write") && e.step.status === "succeeded")).toBe(true);
  const report = evs.find(e => e.type === "acceptance_report")?.report;
  expect(report?.verdict).toBe("pass");
});
```

- [ ] **Step 3: Run orchestrator tests to verify they fail**

Run:

```bash
pnpm --filter @scribe/server exec vitest run tests/unit/ai/orchestrator/conversation-orchestrator.test.ts
```

Expected: fail because workflow events are not emitted and plan-only is not honored.

- [ ] **Step 4: Implement workflow wrapper around write branch**

In `packages/server/src/ai/orchestrator/conversation-orchestrator.ts`, import:

```ts
import {
  buildWriteIntentContract,
  createTaskId,
  makeAcceptanceReport,
  makeExecutionSteps,
  makeWriteActions,
  makeWritePolicy,
} from "./workflow-contract.js";
import type { ExecutionStep, ExecutionTrace } from "@scribe/shared";
```

In the natural-language `WRITE_HINT` branch:

```ts
const count = parseWriteChapterCount(input.message);
const start = deps.handle.chaptersRepo.maxChapterNo() + 1;
const chapterNos = Array.from({ length: count }, (_, offset) => start + offset);
const taskId = createTaskId("write");
const mode = input.executionMode ?? "low_risk_auto";
const contract = buildWriteIntentContract({ taskId, userRequest: input.message, chapterNos });
const actions = makeWriteActions(chapterNos);
const policy = makeWritePolicy({ taskId, mode, chapterNos });
const steps = makeExecutionSteps(actions);

yield { type: "intent", category: "writing_intent" };
yield { type: "execution_plan", taskId, policy, steps, intentContract: contract };

if (policy.effectiveMode !== "auto") {
  yield {
    type: "confirmation_required",
    taskId,
    policy,
    message: policy.effectiveMode === "blocked"
      ? "Current execution mode does not allow writing."
      : "Confirmation required before writing chapters.",
  };
  yield { type: "done" };
  return;
}
```

During the loop, emit running and succeeded steps:

```ts
const completedSteps: ExecutionStep[] = [];
for (let offset = 0; offset < count; offset += 1) {
  const chapterNo = start + offset;
  const baseStep = steps[offset]!;
  yield { type: "execution_step", taskId, step: { ...baseStep, status: "running", toolName: "chapter_write" } };
  yield* writeChapterFlow(deps, chapterNo, input.message);
  const readBack = deps.handle.chapterFiles.read(chapterNo);
  const succeededStep: ExecutionStep = {
    ...baseStep,
    status: readBack?.content ? "succeeded" : "failed",
    toolName: "chapter_write",
    resultSummary: readBack?.content ? `chapter ${chapterNo} persisted` : `chapter ${chapterNo} missing after write`,
    verification: {
      method: "read_back",
      passed: Boolean(readBack?.content),
      detail: readBack?.content ? `chapter ${chapterNo} read back` : `chapter ${chapterNo} not found`,
    },
  };
  completedSteps.push(succeededStep);
  yield { type: "execution_step", taskId, step: succeededStep };
  if (succeededStep.status === "failed") break;
}
const trace: ExecutionTrace = {
  taskId,
  mode,
  policy,
  steps: completedSteps,
  finalStatus: completedSteps.length === count && completedSteps.every(step => step.status === "succeeded")
    ? "succeeded"
    : "failed",
};
yield { type: "acceptance_report", report: makeAcceptanceReport({ contract, trace }) };
yield { type: "done" };
return;
```

Keep slash `/write` behavior unchanged in this task unless tests require mode support there too.

- [ ] **Step 5: Run orchestrator tests and server typecheck**

Run:

```bash
pnpm --filter @scribe/server exec vitest run tests/unit/ai/orchestrator/conversation-orchestrator.test.ts
pnpm --filter @scribe/server typecheck
```

Expected: both pass.

- [ ] **Step 6: Commit Task 5**

```bash
git add packages/server/src/ai/orchestrator/conversation-orchestrator.ts packages/server/tests/unit/ai/orchestrator/conversation-orchestrator.test.ts
git commit -m "feat(server): emit writing workflow trace"
```

---

### Task 6: Client Store Execution Mode And Workflow Artifacts

**Files:**
- Modify: `packages/client/src/stores/conversation.ts`
- Test: `packages/client/tests/components/conversation-writing-intent.test.tsx`

**Interfaces:**
- Consumes shared types from Task 1.
- Produces store fields and actions:
  - `executionMode`
  - `setExecutionMode(mode)`
  - `pendingConfirmation`
  - `setPendingConfirmation(confirmation)`
  - `executionSteps`
  - `upsertExecutionStep(taskId, step)`
  - `acceptanceReport`
  - `setAcceptanceReport(report)`

- [ ] **Step 1: Write failing store-backed component assertion**

In `packages/client/tests/components/conversation-writing-intent.test.tsx`, add assertions after rendering:

```ts
expect(useConversationStore.getState().executionMode).toBe("low_risk_auto");
act(() => useConversationStore.getState().setExecutionMode("plan_only"));
expect(useConversationStore.getState().executionMode).toBe("plan_only");
```

- [ ] **Step 2: Run client test to verify it fails**

Run:

```bash
pnpm --filter @scribe/client exec vitest run tests/components/conversation-writing-intent.test.tsx
```

Expected: fail because store fields do not exist.

- [ ] **Step 3: Add store fields and actions**

Modify `packages/client/src/stores/conversation.ts`:

```ts
import type {
  AcceptanceReport,
  ExecutionMode,
  ExecutionPolicy,
  ExecutionStep,
} from "@scribe/shared";
```

Add interfaces:

```ts
export interface PendingConfirmation {
  taskId: string;
  policy: ExecutionPolicy;
  message: string;
}
```

Extend `ConversationStore`:

```ts
  executionMode: ExecutionMode;
  pendingConfirmation: PendingConfirmation | null;
  executionSteps: ExecutionStep[];
  acceptanceReport: AcceptanceReport | null;
  setExecutionMode(mode: ExecutionMode): void;
  setPendingConfirmation(value: PendingConfirmation | null): void;
  upsertExecutionStep(taskId: string, step: ExecutionStep): void;
  setAcceptanceReport(report: AcceptanceReport | null): void;
```

Initial state:

```ts
  executionMode: "low_risk_auto",
  pendingConfirmation: null,
  executionSteps: [],
  acceptanceReport: null,
```

Actions:

```ts
  setExecutionMode(mode) {
    set({ executionMode: mode });
  },

  setPendingConfirmation(value) {
    set({ pendingConfirmation: value });
  },

  upsertExecutionStep(_taskId, step) {
    set(s => {
      const index = s.executionSteps.findIndex(existing => existing.id === step.id);
      const executionSteps = index >= 0
        ? s.executionSteps.map(existing => existing.id === step.id ? step : existing)
        : [...s.executionSteps, step];
      return { executionSteps };
    });
  },

  setAcceptanceReport(report) {
    set({ acceptanceReport: report });
  },
```

Update `beginStream` to clear task artifacts:

```ts
set({
  streaming: { id, text: "", reasoning: "", toolEvents: [], workflowStages: [], suppressText: false },
  error: null,
  pendingConfirmation: null,
  executionSteps: [],
  acceptanceReport: null,
});
```

Update `reset` to keep mode but clear task artifacts:

```ts
set({ messages: [], streaming: null, error: null, autoStatus: null, pendingConfirmation: null, executionSteps: [], acceptanceReport: null });
```

- [ ] **Step 4: Run client test and typecheck**

Run:

```bash
pnpm --filter @scribe/client exec vitest run tests/components/conversation-writing-intent.test.tsx
pnpm --filter @scribe/client typecheck
```

Expected: both pass.

- [ ] **Step 5: Commit Task 6**

```bash
git add packages/client/src/stores/conversation.ts packages/client/tests/components/conversation-writing-intent.test.tsx
git commit -m "feat(client): store execution workflow state"
```

---

### Task 7: Execution Mode Selector

**Files:**
- Create: `packages/client/src/components/conversation/execution-mode-selector.tsx`
- Test: `packages/client/tests/components/execution-mode-selector.test.tsx`
- Modify: `packages/client/src/components/conversation/conversation-pane.tsx`

**Interfaces:**
- Consumes: `executionMode`, `setExecutionMode`.
- Produces: accessible selector with `data-testid="execution-mode-selector"`.

- [ ] **Step 1: Write failing component test**

Create `packages/client/tests/components/execution-mode-selector.test.tsx`:

```tsx
import { describe, expect, it, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ExecutionModeSelector } from "../../src/components/conversation/execution-mode-selector.js";
import { useConversationStore } from "../../src/stores/conversation.js";

describe("ExecutionModeSelector", () => {
  beforeEach(() => {
    useConversationStore.getState().reset();
    useConversationStore.getState().setExecutionMode("low_risk_auto");
  });

  it("shows low-risk auto by default and updates mode", () => {
    render(<ExecutionModeSelector />);

    const select = screen.getByTestId("execution-mode-selector") as HTMLSelectElement;
    expect(select.value).toBe("low_risk_auto");

    fireEvent.change(select, { target: { value: "plan_only" } });
    expect(useConversationStore.getState().executionMode).toBe("plan_only");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @scribe/client exec vitest run tests/components/execution-mode-selector.test.tsx
```

Expected: fail because component does not exist.

- [ ] **Step 3: Implement selector**

Create `packages/client/src/components/conversation/execution-mode-selector.tsx`:

```tsx
import type { ExecutionMode } from "@scribe/shared";
import { useConversationStore } from "../../stores/conversation.js";

const LABELS: Record<ExecutionMode, string> = {
  trusted_auto: "全权交给 AI",
  low_risk_auto: "低风险自动",
  confirm_each: "每次确认",
  plan_only: "只出方案",
};

export function ExecutionModeSelector() {
  const mode = useConversationStore(s => s.executionMode);
  const setExecutionMode = useConversationStore(s => s.setExecutionMode);

  return (
    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#555" }}>
      <span>执行模式</span>
      <select
        data-testid="execution-mode-selector"
        value={mode}
        onChange={(event) => setExecutionMode(event.target.value as ExecutionMode)}
        style={{ fontSize: 12, border: "1px solid #d0d0d0", borderRadius: 6, padding: "3px 6px" }}
      >
        {Object.entries(LABELS).map(([value, label]) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </select>
    </label>
  );
}
```

Render it in `Composer` in `conversation-pane.tsx` above the textarea:

```tsx
<ExecutionModeSelector />
```

Import:

```ts
import { ExecutionModeSelector } from "./execution-mode-selector.js";
```

- [ ] **Step 4: Run selector test and client typecheck**

Run:

```bash
pnpm --filter @scribe/client exec vitest run tests/components/execution-mode-selector.test.tsx
pnpm --filter @scribe/client typecheck
```

Expected: both pass.

- [ ] **Step 5: Commit Task 7**

```bash
git add packages/client/src/components/conversation/execution-mode-selector.tsx packages/client/src/components/conversation/conversation-pane.tsx packages/client/tests/components/execution-mode-selector.test.tsx
git commit -m "feat(client): add execution mode selector"
```

---

### Task 8: Confirmation Card And Request Mode Wiring

**Files:**
- Create: `packages/client/src/components/conversation/execution-confirmation-card.tsx`
- Modify: `packages/client/src/components/conversation/conversation-pane.tsx`
- Test: `packages/client/tests/components/execution-confirmation-card.test.tsx`
- Modify: `packages/client/tests/components/conversation-writing-intent.test.tsx`

**Interfaces:**
- Consumes: `pendingConfirmation`, `executionMode`.
- Produces:
  - confirmation card with approve, edit plan, reroll, cancel buttons.
  - conversation request body includes `executionMode`.

- [ ] **Step 1: Write failing confirmation card test**

Create `packages/client/tests/components/execution-confirmation-card.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { buildExecutionPolicy } from "@scribe/shared";
import { ExecutionConfirmationCard } from "../../src/components/conversation/execution-confirmation-card.js";

describe("ExecutionConfirmationCard", () => {
  it("renders policy reason and button callbacks", () => {
    const onApprove = vi.fn();
    const onReroll = vi.fn();
    const onCancel = vi.fn();
    const policy = buildExecutionPolicy({
      taskId: "task-1",
      configuredMode: "low_risk_auto",
      actions: [{ type: "chapter_write" }],
    });

    render(
      <ExecutionConfirmationCard
        taskId="task-1"
        message="Confirmation required before writing chapters."
        policy={policy}
        onApprove={onApprove}
        onReroll={onReroll}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByText(/Confirmation required/)).toBeInTheDocument();
    expect(screen.getByText(/low_risk_auto/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("execution-approve"));
    fireEvent.click(screen.getByTestId("execution-reroll"));
    fireEvent.click(screen.getByTestId("execution-cancel"));
    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onReroll).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @scribe/client exec vitest run tests/components/execution-confirmation-card.test.tsx
```

Expected: fail because component does not exist.

- [ ] **Step 3: Implement confirmation card**

Create `packages/client/src/components/conversation/execution-confirmation-card.tsx`:

```tsx
import type { ExecutionPolicy } from "@scribe/shared";

export function ExecutionConfirmationCard(props: {
  taskId: string;
  message: string;
  policy: ExecutionPolicy;
  onApprove: () => void;
  onReroll: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      data-testid="execution-confirmation-card"
      style={{
        margin: "8px 12px",
        padding: 10,
        border: "1px solid #ffd591",
        borderRadius: 6,
        background: "#fffbe6",
        fontSize: 13,
      }}
    >
      <div style={{ fontWeight: 600 }}>需要确认</div>
      <div>{props.message}</div>
      <div style={{ marginTop: 4, color: "#666" }}>
        模式: {props.policy.configuredMode} · 风险: {props.policy.highestRisk}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button data-testid="execution-approve" onClick={props.onApprove}>同意执行</button>
        <button data-testid="execution-edit-plan" disabled title="计划编辑将在后续任务接入">修改计划</button>
        <button data-testid="execution-reroll" onClick={props.onReroll}>打回重roll</button>
        <button data-testid="execution-cancel" onClick={props.onCancel}>取消</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire request mode and SSE confirmation**

In `conversation-pane.tsx`, include `executionMode` from store:

```ts
const {
  executionMode,
  pendingConfirmation,
  setPendingConfirmation,
  upsertExecutionStep,
  setAcceptanceReport,
  ...
} = useConversationStore();
```

Send mode in body:

```ts
const body = isAuto ? { n: autoTotal } : { message: content, executionMode };
```

Handle events:

```ts
case "confirmation_required":
  setPendingConfirmation({
    taskId: String(ev.taskId),
    policy: ev.policy as PendingConfirmation["policy"],
    message: String(ev.message ?? "需要确认后执行"),
  });
  break;
case "execution_step":
  upsertExecutionStep(String(ev.taskId), ev.step as ExecutionStep);
  break;
case "acceptance_report":
  setAcceptanceReport(ev.report as AcceptanceReport);
  break;
```

Render card above `Composer`:

```tsx
{pendingConfirmation && (
  <ExecutionConfirmationCard
    taskId={pendingConfirmation.taskId}
    message={pendingConfirmation.message}
    policy={pendingConfirmation.policy}
    onApprove={() => appendSystemMessage("确认执行将在后续任务接入")}
    onReroll={() => {
      setPendingConfirmation(null);
      if (lastSent) send(lastSent);
    }}
    onCancel={() => setPendingConfirmation(null)}
  />
)}
```

Import `ExecutionConfirmationCard` and needed shared types. Approval can be a stub in Phase 1 if the server has no task resume endpoint yet; the visible confirmation state still satisfies plan-only and blocked behavior.

- [ ] **Step 5: Add request body assertion**

In `conversation-writing-intent.test.tsx`, set mode before sending:

```ts
act(() => useConversationStore.getState().setExecutionMode("plan_only"));
sendMessage("直接把前三章都写了");
expect(m.lastBody()).toMatchObject({ executionMode: "plan_only" });
```

Update `makeManualStream` to capture `opts.body`:

```ts
let body: unknown = null;
const streamFn: StreamFn = (opts) => {
  sink = opts.onEvent;
  body = opts.body;
  return { cancel: vi.fn(), done: Promise.resolve() };
};
return { streamFn, push, lastBody: () => body };
```

- [ ] **Step 6: Run client tests and typecheck**

Run:

```bash
pnpm --filter @scribe/client exec vitest run tests/components/execution-confirmation-card.test.tsx tests/components/conversation-writing-intent.test.tsx
pnpm --filter @scribe/client typecheck
```

Expected: both pass.

- [ ] **Step 7: Commit Task 8**

```bash
git add packages/client/src/components/conversation/execution-confirmation-card.tsx packages/client/src/components/conversation/conversation-pane.tsx packages/client/tests/components/execution-confirmation-card.test.tsx packages/client/tests/components/conversation-writing-intent.test.tsx
git commit -m "feat(client): show workflow confirmation state"
```

---

### Task 9: Streaming Message Trace And Acceptance Display

**Files:**
- Modify: `packages/client/src/components/conversation/streaming-message.tsx`
- Test: `packages/client/tests/components/conversation-writing-intent.test.tsx`

**Interfaces:**
- Consumes: `executionSteps`, `acceptanceReport`.
- Produces user-visible trace and acceptance summary.

- [ ] **Step 1: Write failing display test**

In `conversation-writing-intent.test.tsx`, after pushing execution events:

```ts
m.push({
  type: "execution_step",
  taskId: "task-1",
  step: {
    id: "step-1",
    actionType: "chapter_write",
    riskLevel: "write",
    status: "succeeded",
    toolName: "chapter_write",
    verification: { method: "read_back", passed: true, detail: "chapter 1 read back" },
  },
});
expect(screen.getByText(/chapter 1 read back/)).toBeInTheDocument();

m.push({
  type: "acceptance_report",
  report: {
    taskId: "task-1",
    verdict: "pass",
    userCriteria: [{ criterion: "write", status: "pass", evidence: "verified" }],
    processCriteria: [],
    domainCriteria: [],
    recommendedActions: [],
  },
});
expect(screen.getByText(/验收/)).toBeInTheDocument();
expect(screen.getByText(/pass/)).toBeInTheDocument();
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @scribe/client exec vitest run tests/components/conversation-writing-intent.test.tsx
```

Expected: fail because streaming message does not render execution steps or report.

- [ ] **Step 3: Render execution trace and acceptance summary**

In `streaming-message.tsx`, read store data:

```ts
import { useConversationStore } from "../../stores/conversation.js";
```

Inside component:

```ts
const executionSteps = useConversationStore(s => s.executionSteps);
const acceptanceReport = useConversationStore(s => s.acceptanceReport);
```

Render after workflow progress:

```tsx
{executionSteps.length > 0 && (
  <div data-testid="execution-steps" style={{ marginTop: 8, fontSize: 12, color: "#445" }}>
    {executionSteps.map(step => (
      <div key={step.id}>
        {step.status === "succeeded" ? "✓" : step.status === "failed" ? "×" : "⟳"} {step.actionType}
        {step.verification?.detail ? ` · ${step.verification.detail}` : ""}
      </div>
    ))}
  </div>
)}
{acceptanceReport && (
  <div data-testid="acceptance-report" style={{ marginTop: 8, fontSize: 12, color: "#445" }}>
    验收: {acceptanceReport.verdict}
  </div>
)}
```

- [ ] **Step 4: Run client tests and typecheck**

Run:

```bash
pnpm --filter @scribe/client exec vitest run tests/components/conversation-writing-intent.test.tsx
pnpm --filter @scribe/client typecheck
```

Expected: both pass.

- [ ] **Step 5: Commit Task 9**

```bash
git add packages/client/src/components/conversation/streaming-message.tsx packages/client/tests/components/conversation-writing-intent.test.tsx
git commit -m "feat(client): display execution trace"
```

---

### Task 10: Full Verification And Documentation Update

**Files:**
- Modify: `docs/HANDOFF-2026-06-21.md` or `docs/HANDOFF-codex.md`
- No production code unless earlier tasks exposed a missing integration note.

**Interfaces:**
- Consumes all previous tasks.
- Produces final verification evidence and handoff note.

- [ ] **Step 1: Run full typecheck**

Run:

```bash
pnpm --filter @scribe/shared typecheck
pnpm --filter @scribe/server typecheck
pnpm --filter @scribe/client typecheck
```

Expected: all pass.

- [ ] **Step 2: Run targeted tests**

Run:

```bash
pnpm --filter @scribe/shared exec vitest run tests/agent-workflow.test.ts
pnpm --filter @scribe/server exec vitest run tests/unit/ai/orchestrator/workflow-contract.test.ts tests/unit/ai/orchestrator/conversation-orchestrator.test.ts tests/integration/chat-streaming.test.ts
pnpm --filter @scribe/client exec vitest run tests/components/execution-mode-selector.test.tsx tests/components/execution-confirmation-card.test.tsx tests/components/conversation-writing-intent.test.tsx
```

Expected: all pass.

- [ ] **Step 3: Run full unit and integration suites**

Run:

```bash
pnpm --filter @scribe/shared exec vitest run
pnpm --filter @scribe/server exec vitest run
pnpm --filter @scribe/client exec vitest run
```

Expected: all pass.

- [ ] **Step 4: Update handoff documentation**

Append a short section to `docs/HANDOFF-2026-06-21.md`:

```md
## Agent Workflow Execution Phase 1

Implemented Phase 1 of `docs/superpowers/specs/2026-06-21-agent-workflow-execution-design.md`.

- Added shared workflow contracts and SSE events.
- Added server workflow contract helpers, execution policy support, write workflow plans, execution steps, and acceptance reports.
- Added client execution mode selector, confirmation card, execution trace state, and acceptance summary display.
- Default execution mode is `low_risk_auto`.
- Hidden chapter prose remains suppressed from ordinary chat text.

Verification:

- `pnpm --filter @scribe/shared typecheck`
- `pnpm --filter @scribe/server typecheck`
- `pnpm --filter @scribe/client typecheck`
- `pnpm --filter @scribe/shared exec vitest run`
- `pnpm --filter @scribe/server exec vitest run`
- `pnpm --filter @scribe/client exec vitest run`
```

- [ ] **Step 5: Commit final verification docs**

```bash
git add docs/HANDOFF-2026-06-21.md
git commit -m "docs: update agent workflow handoff"
```

## Self-Review

Spec coverage:

- Three agent boundaries: covered by Tasks 3, 5, 8, and 9.
- UI execution modes: covered by Tasks 1, 4, 6, 7, and 8.
- Execution policy and risk levels: covered by Tasks 1 and 2.
- Execution trace: covered by Tasks 2, 3, 5, 6, and 9.
- Confirmation card: covered by Task 8.
- Hidden prose behavior: covered by Tasks 5, 8, and 9, building on the existing writing suppression tests.
- Acceptance report: covered by Tasks 2, 3, 5, and 9.
- Tool reliability read-back: covered first for chapter writes in Task 5; later mutating tools should be migrated using the same helper.
- Memory evidence and revision: not implemented in Phase 1 by design; interface contracts are in the spec and remain future phases.

Placeholder scan:

- No `TBD`, `TODO`, or "implement later" placeholders are used as task steps.
- Future phases are explicitly out of Phase 1 scope and are not required for this plan.

Type consistency:

- `ExecutionMode`, `RiskLevel`, `ExecutionPolicy`, `ExecutionStep`, `ExecutionTrace`, and `AcceptanceReport` are defined in Task 1 and reused consistently.
- `workflow_mode`, `execution_plan`, `execution_step`, `confirmation_required`, and `acceptance_report` are defined in Task 2 and consumed by later tasks.
