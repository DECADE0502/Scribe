# Scribe Agent Workflow And Execution Design

Date: 2026-06-21

## Purpose

This design defines a trusted agent workflow for Scribe. The goal is to stop treating conversation, prose generation, tool calls, state updates, and final verification as one loose model stream. Scribe should instead run user requests through a visible, auditable workflow:

```text
user request
-> main agent: conversation, intent, hidden drafts
-> execution agent: tool planning, permission control, read-back verification
-> acceptance agent: contract checks, process checks, domain checks
-> user-visible summary and next action
```

The design covers four priorities in this order:

1. Tool reliability.
2. Controllable writing workflow.
3. Trustworthy memory and evidence links.
4. Professional revision workflow.

The first implementation phase should build the A+C skeleton: tool reliability and workflow control. Memory evidence links and revision workflows are included as interfaces and extension points, then completed in later phases.

## Problems To Solve

Current behavior can feel unreliable to an author because several responsibilities are blended together:

- The same agent can chat, generate chapter prose, call tools, and claim completion.
- Writing prose can leak into the chat stream when it should be hidden.
- Tool calls may happen without a clear plan, visible permission, or read-back verification.
- The user may see "done" while the UI panel has not refreshed or the database was not actually changed.
- Duplicate characters or records can be created when the agent does not check existing state first.
- Final review may check generic quality but fail to return to the user's original requirements.

The new workflow makes each responsibility explicit and inspectable.

## Non-Goals

This design does not replace the existing chapter outline system with chapter-level blueprint enforcement.

This design does not make chapter outline arcs stricter. The user explicitly excluded that scope.

This design does not fully implement memory evidence links or advanced revision tools in the first phase. It defines their contracts so they can be attached to the same workflow later.

## Core Concepts

### Main Agent

The main agent is the only agent that directly performs natural conversation with the user. It understands the request, writes user-facing replies, generates hidden drafts when needed, and produces a structured intent contract.

The main agent must not directly claim that database writes, chapter writes, record updates, or deletions have already happened. It can say that it is preparing a plan or handing actions to the execution workflow.

Output shape:

```ts
type MainAgentOutput = {
  userVisibleReply: string;
  hiddenDrafts?: HiddenDraft[];
  intentContract: IntentContract;
  intendedActions: IntendedAction[];
  risks: RiskNote[];
};
```

Rules:

- `userVisibleReply` may appear in the chat.
- `hiddenDrafts` must not appear as ordinary chat text.
- `intentContract` is the first source of truth for acceptance.
- `intendedActions` are proposed actions, not completed actions.
- `risks` list ambiguity, destructive impact, likely duplicate records, or operations needing user confirmation.

### Execution Agent

The execution agent converts `intendedActions` into an executable plan. It does not write prose or invent story content. Its job is to make operations reliable.

Responsibilities:

- Classify each action by risk.
- Check existing state before creating or updating records.
- Generate an execution policy from the current UI execution mode.
- Present confirmation cards when required.
- Call tools in a traceable order.
- Read back state after write operations.
- Trigger UI refresh events for affected panels.
- Stop on failure instead of allowing a later message to claim success.
- Emit an execution trace.

### Acceptance Agent

The acceptance agent validates the result. It reads:

```text
intentContract
executionTrace
hiddenDrafts
finalState
```

It must check the main agent's acceptance criteria first. It may add additional process and domain checks, but it must not replace the user's original intent with its own standard.

Verdicts:

```ts
type AcceptanceVerdict = "pass" | "repairable" | "needs_user" | "fail";
```

The acceptance agent decides whether the system can auto-repair, needs a user decision, or must stop.

## UI Execution Modes

Scribe should expose a global execution mode selector near the conversation composer and mirror the active mode in the task panel.

```text
Execution mode: [Low-risk auto v]
```

Modes:

```ts
type ExecutionMode =
  | "trusted_auto"
  | "low_risk_auto"
  | "confirm_each"
  | "plan_only";
```

Default mode: `low_risk_auto`.

### trusted_auto

The AI may automatically execute most operations after planning. Destructive actions still require confirmation.

Examples that still require confirmation:

- Delete character.
- Delete outline node.
- Delete chapter.
- Clear memory.
- Restore snapshot.
- Overwrite existing chapter.
- Batch destructive edits.

### low_risk_auto

The AI may automatically read, retrieve, preview, diagnose, and generate hidden drafts. Formal writes and risky changes require confirmation.

This is the default because it reduces friction while protecting durable project assets.

Examples that can run automatically:

- List characters.
- List outline.
- Recall chapters.
- Preview worldbook retrieval.
- Generate hidden drafts.
- Build diagnostics.

Examples that require confirmation:

- Write a formal chapter version.
- Update a character.
- Add or modify outline nodes.
- Add foreshadowing.
- Batch write multiple chapters.
- Any overwrite, deletion, or restore.

### confirm_each

All write actions require a confirmation card before execution.

Read-only operations may still run automatically unless the user configures stricter behavior later.

### plan_only

No write operation executes. The system may produce a plan, hidden draft, and diagnostic report, but it must not mutate the workspace.

The UI should offer a follow-up action:

```text
Change to low-risk auto and execute
```

## Action Risk Levels

Every intended action receives a risk level.

```ts
type RiskLevel = "read" | "draft" | "write" | "bulk_write" | "destructive";
```

Default classifications:

- `read`: list, get, recall, preview, inspect.
- `draft`: hidden prose draft, diagnostic report, audit preview.
- `write`: create or update a single durable record, write a new chapter version.
- `bulk_write`: multi-chapter write, batch record update, merge or split operations.
- `destructive`: delete, clear, overwrite existing content, restore snapshot, irreversible import overwrite.

The execution agent may raise risk but should not lower a destructive operation.

## Confirmation Card

When the execution policy requires user approval, the UI should show a compact card:

```text
Task: Write the next three chapters
Mode: Low-risk auto
Reason for confirmation: multi-chapter formal write

Planned actions:
- Generate 3 hidden drafts
- Write chapter 1
- Write chapter 2
- Write chapter 3
- Read back written chapters
- Run acceptance checks

[Approve] [Edit plan] [Reroll] [Cancel]
```

Button semantics:

- `Approve`: run the current execution plan.
- `Edit plan`: allow the user to edit constraints or action list, then re-evaluate policy.
- `Reroll`: discard the main agent output and ask the main agent for a new plan or hidden draft.
- `Cancel`: stop the task without writing.

## Data Contracts

### IntentContract

```ts
type IntentContract = {
  taskId: string;
  userRequest: string;
  taskType:
    | "write"
    | "revise"
    | "tool_update"
    | "memory_update"
    | "diagnose"
    | "auto_run";
  mustDo: string[];
  mustNotDo: string[];
  acceptanceCriteria: string[];
  ambiguity: Array<{
    question: string;
    defaultAssumption?: string;
    requiresUser?: boolean;
  }>;
};
```

The contract is a durable task artifact. Acceptance must quote or reference its criteria.

Example for "write the first three chapters":

```json
{
  "mustDo": [
    "Generate three chapter bodies",
    "Keep chapter bodies out of ordinary chat messages",
    "Write the target chapters through chapter write operations",
    "Keep visible workflow status until the task is done"
  ],
  "mustNotDo": [
    "Do not stream chapter prose as normal chat text",
    "Do not claim completion before read-back verification"
  ],
  "acceptanceCriteria": [
    "There are three successful chapter write steps",
    "Read-back verifies all three target chapters contain content",
    "The streaming workflow remains visible until done",
    "No hidden draft prose appears as an ordinary chat message"
  ]
}
```

### HiddenDraft

```ts
type HiddenDraft = {
  id: string;
  taskId: string;
  kind: "chapter" | "revision" | "plan" | "diagnostic";
  target?: {
    chapterNo?: number;
    segmentId?: string;
    recordId?: string;
  };
  content: string;
  metadata?: Record<string, unknown>;
};
```

Hidden drafts are available to the editor, execution agent, and acceptance agent. They are not appended to chat as normal assistant prose.

### IntendedAction

```ts
type IntendedAction = {
  id: string;
  type: string;
  target?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  riskHint?: RiskLevel;
  reason: string;
};
```

### ExecutionPolicy

```ts
type ExecutionPolicy = {
  taskId: string;
  configuredMode: ExecutionMode;
  effectiveMode: "auto" | "confirm" | "blocked";
  highestRisk: RiskLevel;
  requiresConfirmation: boolean;
  reason: string;
  rollbackPlan?: string;
  userChoices: Array<"approve" | "edit_plan" | "reroll" | "cancel">;
};
```

### ExecutionTrace

```ts
type ExecutionTrace = {
  taskId: string;
  mode: ExecutionMode;
  policy: ExecutionPolicy;
  steps: ExecutionStep[];
  finalStatus: "succeeded" | "failed" | "cancelled" | "needs_user";
};
```

```ts
type ExecutionStep = {
  id: string;
  actionType: string;
  riskLevel: RiskLevel;
  status: "pending" | "running" | "succeeded" | "failed" | "skipped";
  toolName?: string;
  argsSummary?: string;
  resultSummary?: string;
  verification?: {
    method: "read_back" | "panel_refresh" | "audit" | "state_compare";
    passed: boolean;
    detail: string;
  };
};
```

Write actions must have verification. A write step without read-back or equivalent verification is incomplete.

### AcceptanceReport

```ts
type AcceptanceReport = {
  taskId: string;
  verdict: AcceptanceVerdict;
  userCriteria: CheckResult[];
  processCriteria: CheckResult[];
  domainCriteria: CheckResult[];
  recommendedActions: RecommendedAction[];
};
```

```ts
type CheckResult = {
  criterion: string;
  status: "pass" | "fail" | "unknown";
  evidence: string;
};
```

```ts
type RecommendedAction = {
  type: "auto_repair" | "ask_user" | "reroll" | "stop";
  reason: string;
};
```

## User-Visible Workflow

Chat should show progress and decisions, not hidden prose.

Before execution:

```text
Understood: write three chapters.
Execution mode: low-risk auto.
Confirmation required: multi-chapter formal write.

[Approve] [Edit plan] [Reroll] [Cancel]
```

During execution:

```text
Running task
- Generating hidden drafts
- Writing chapter 1
- Read-back verification for chapter 1
- Writing chapter 2
- Read-back verification for chapter 2
- Writing chapter 3
- Read-back verification for chapter 3
- Running acceptance checks
```

After acceptance:

```text
Acceptance passed
- User criteria: 3/3 passed
- Process criteria: all write steps verified
- Domain criteria: no blocking issue found
```

If acceptance fails:

```text
Acceptance needs user
- User criterion failed: target chapters ambiguous
- Reason: existing chapters already exist, so "first three" could mean rewrite 1-3 or continue 6-8

[Rewrite 1-3] [Continue next 3] [Reroll plan] [Cancel]
```

## Tool Reliability Rules

All mutating tools should follow these rules:

1. Read existing state before creating records that can duplicate.
2. Generate a step in `executionTrace` before calling the tool.
3. Record a result summary after the tool returns.
4. Verify by reading back the affected state.
5. Trigger the affected UI refresh channel.
6. Stop the task on failed verification.
7. Never let a later assistant message claim success for a failed or unverified step.

Examples:

- `create_character` must be preceded by `list_characters` or equivalent lookup.
- `add_outline_node` must be followed by `list_outline` or a direct read.
- `chapter_write` must be followed by reading the target chapter file/version.
- `delete_*` actions must be confirmed and followed by read-back absence verification.

## Writing Workflow Rules

Chapter prose must be hidden by default.

For write tasks:

1. Main agent produces `hiddenDrafts`.
2. Execution agent decides whether the write can run automatically.
3. If approved, execution agent writes chapter content through chapter tools.
4. Execution agent verifies chapter persistence.
5. Acceptance agent checks intent criteria, workflow state, and writing-specific quality gates.
6. Only the final summary appears in chat.

Normal chat text should contain:

- Task summary.
- Current stage.
- Confirmation prompts.
- Tool results.
- Acceptance summary.

Normal chat text should not contain:

- Full chapter prose.
- Hidden draft content.
- Raw model trace.
- Tool implementation details beyond user-readable summaries.

## Workflow Control Rules

Auto writing must be resumable and stoppable.

The task panel should support:

- Cancel current task.
- Pause after current step.
- Continue after pause.
- Reroll main agent output.
- Retry failed execution step if safe.
- Open acceptance report.

For multi-step writes, each chapter should be its own traceable sub-step. Serious acceptance failure should stop later steps unless the user selected a mode that explicitly allows continuing after warnings.

## Memory Evidence Interface

Later phases should attach evidence links to durable memory. The first phase should reserve the contract:

```ts
type EvidenceLink = {
  chapterNo?: number;
  sourceType: "chapter" | "user_message" | "tool_result" | "import";
  sourceId: string;
  quote?: string;
  confidence: "confirmed" | "inferred" | "uncertain";
};
```

Records that should eventually support evidence:

- Character base data.
- Character current state.
- Relationships.
- Timeline events.
- Foreshadowing.
- Generic record items.
- World rules and hard facts.

Acceptance should eventually treat evidence-free memory updates as weaker than evidence-linked updates.

## Revision Workflow Interface

Later phases should route professional editing tasks through the same three-agent workflow.

Revision intent types:

```ts
type RevisionIntent =
  | "polish_style"
  | "reduce_ai_tone"
  | "expand_detail"
  | "tighten_pacing"
  | "fix_continuity"
  | "preserve_meaning_rewrite"
  | "split_chapter"
  | "merge_chapters";
```

Revision flow:

```text
main agent: produce revision plan and hidden revision draft
-> execution agent: write draft version or apply selected revision after permission
-> acceptance agent: verify original intent, meaning preservation, and requested edit effect
```

For revision tasks, acceptance must compare before and after text. A revision that changes core meaning when the user asked for style polishing should fail.

## Suggested Implementation Phases

### Phase 1: A+C Skeleton

Deliver:

1. Task and workflow data model.
2. UI execution mode selector with default `low_risk_auto`.
3. Main agent structured output contract.
4. Hidden draft handling for write tasks.
5. Execution agent plan generation.
6. Confirmation card for medium and high risk actions.
7. Execution trace around mutating tools.
8. Read-back verification for writes.
9. Acceptance report generated from intent contract and execution trace.
10. Unified task status display.

Acceptance for phase 1:

- A writing request can produce hidden drafts without chat prose leakage.
- A mutating tool action shows plan, mode, execution trace, result, and read-back verification.
- Duplicate-prone actions check existing records first.
- The final acceptance report checks the main agent's criteria before generic checks.
- `low_risk_auto` is the default execution mode.

### Phase 2: Memory Evidence

Deliver:

1. Evidence links on key durable records.
2. UI evidence viewer.
3. Acceptance checks for ungrounded memory updates.
4. Record correction flow that preserves old evidence.

### Phase 3: Professional Revision

Deliver:

1. Revision intent classifier.
2. Hidden revision drafts.
3. Before/after diff acceptance.
4. Revision quality checks by intent type.
5. Apply, reroll, and partial-apply controls.

## Testing Strategy

Unit tests:

- Execution mode policy decisions.
- Risk classification.
- Intent contract parsing.
- Execution trace construction.
- Acceptance report evaluation.

Integration tests:

- Natural language write request enters hidden writing workflow.
- Mutating tools verify by read-back.
- Duplicate character creation is converted into update or confirmation.
- Plan-only mode does not mutate state.
- Low-risk auto confirms formal writes.
- Acceptance agent fails when a user criterion is unmet.

Client tests:

- Execution mode selector renders and changes mode.
- Confirmation card shows correct actions.
- Hidden prose is not displayed in ordinary chat.
- Task panel remains visible until completion.
- Failed verification surfaces a retry or user-decision state.

End-to-end tests:

- User asks for multi-step writing, approves, sees trace, and receives an acceptance summary.
- User selects plan-only mode and verifies that no chapter or record is written.
- User asks to create an already existing character and sees a merge/update path instead of duplicate creation.

## Open Decisions

The user has approved these defaults:

- First implementation phase focuses on tool reliability and controllable writing workflow.
- Memory evidence and revision capability are designed as interfaces for later phases.
- Default UI execution mode is `low_risk_auto`.

Future implementation planning should still decide:

- Whether task artifacts are persisted in the workspace database from phase 1 or first held in conversation state.
- How much of the main agent structured output should be model-generated JSON versus deterministic orchestration around existing intent classification.
- Which existing mutating tools should be migrated first.

## Completion Criteria For This Design

This design is ready for implementation planning when:

- The three agent boundaries are accepted.
- The execution modes and risk levels are accepted.
- The data contracts are accepted.
- Phase 1 scope is accepted.
- A follow-up implementation plan breaks this into small, testable steps.
