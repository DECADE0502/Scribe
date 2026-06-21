# Task 1 Report: Shared Workflow Contracts And Policy

## Scope

Implemented Phase 1 shared workflow contracts and policy helpers for `@scribe/shared`.

Owned files changed:

- `packages/shared/src/types/agent-workflow.ts`
- `packages/shared/src/index.ts`
- `packages/shared/tests/agent-workflow.test.ts`

Report file intentionally left uncommitted per instruction to commit only the three owned files.

## RED

Command:

```powershell
pnpm --filter @scribe/shared exec vitest run tests/agent-workflow.test.ts
```

Result: failed before implementation.

Key failure:

```text
Error: Failed to load url ../src/types/agent-workflow.js ... Does the file exist?
Test Files  1 failed (1)
Tests  no tests
```

This confirmed the new test covered the missing shared workflow module.

## Implementation

Added Zod schemas, inferred TypeScript types, and helper functions:

- `ExecutionModeSchema`
- `RiskLevelSchema`
- `WorkflowTaskTypeSchema`
- `IntentContractSchema`
- `HiddenDraftSchema`
- `IntendedActionSchema`
- `ExecutionPolicySchema`
- `ExecutionStepSchema`
- `ExecutionTraceSchema`
- `CheckResultSchema`
- `AcceptanceReportSchema`
- `classifyActionRisk`
- `buildExecutionPolicy`

Added shared package export:

```ts
export * from "./types/agent-workflow.js";
```

## Policy Behavior Covered

- `low_risk_auto + chapter_write` resolves to confirm, requires confirmation, highest risk write, expected user choices, schema parses.
- `low_risk_auto + list_characters + hidden_draft` resolves to auto, no confirmation, highest risk draft.
- `plan_only + update_character` resolves to blocked, no confirmation, reason contains `plan_only`.
- `trusted_auto + delete_character` resolves to destructive risk and confirm mode.
- Common action names classify as read, draft, write, bulk_write, and destructive.
- Explicit `riskHint` overrides name classification.

## Verification

Command:

```powershell
pnpm --filter @scribe/shared exec vitest run tests/agent-workflow.test.ts
```

Result:

```text
Test Files  1 passed (1)
Tests  10 passed (10)
```

Command:

```powershell
pnpm --filter @scribe/shared typecheck
```

Result:

```text
> tsc --noEmit
```

Exit code: 0.

## Concerns

- The broader worktree contains many pre-existing unrelated dirty changes. They were not modified or staged.
- The report file is uncommitted because the commit instruction was limited to the three owned files.

## Review Fix: Default Execution Mode

Implemented reviewer fix for the missing global default execution mode:

- Added exported `DEFAULT_EXECUTION_MODE` with value `low_risk_auto`.
- Added exported `ExecutionModeWithDefaultSchema` so parsing `undefined` resolves to `low_risk_auto`.
- Updated `buildExecutionPolicy` so `configuredMode` is optional and defaults internally to `low_risk_auto`.
- Added focused coverage for default schema parsing and omitted `configuredMode` policy behavior.

Verification:

```powershell
pnpm --filter @scribe/shared exec vitest run tests/agent-workflow.test.ts
```

Result:

```text
Test Files  1 passed (1)
Tests  12 passed (12)
```

```powershell
pnpm --filter @scribe/shared typecheck
```

Result:

```text
> tsc --noEmit
```

Exit code: 0.
