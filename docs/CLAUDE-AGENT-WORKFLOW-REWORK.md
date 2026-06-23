# Claude Agent Workflow Rework Brief

Audience: Claude or any next implementation agent working on Scribe.

This document is intentionally direct. The current workflow is overgrown, partially migrated, and mixes several generations of orchestration. Your job is to simplify it into one reliable pipeline. Do not add yet another parallel flow.

Codex will review the implementation after you finish. Be conservative, prove behavior with tests, and do not paper over failures with UI success messages.

## Product Goal

Scribe should feel like one efficient writing assistant, not a bundle of competing agents.

The desired workflow has four logical roles:

1. **Main Agent**
   - Talks to the user.
   - Understands the request.
   - Generates hidden prose drafts when writing is needed.
   - Produces a structured task proposal.
   - Does not directly mutate durable book assets.

2. **Executor Agent**
   - The only role allowed to execute tools or write durable state.
   - Converts the Main Agent output into concrete actions.
   - Writes to staging first.
   - Commits only after validation passes or after an explicit user decision allows commit.

3. **Validator Agent**
   - Replaces the scattered audit / hard-fact / workflow acceptance checks.
   - Checks whether the user's request was actually completed.
   - Checks whether required assets were updated.
   - Reports problems in one consistent format.
   - Does not invent a new goal; it validates the Main Agent's task criteria first.

4. **Repair Agent**
   - Runs only after Validator reports `repairable` and the user chooses repair, or when policy allows automatic repair.
   - Uses tools to fix the Validator's specific issues.
   - Reports what changed.
   - Must go through Validator again.

The UI should show only:

```text
Thinking
Executing
Validating
Needs user decision / Completed
```

Do not expose old internal terms such as "chapter audit", "hard fact gate", or "record state" as primary workflow steps.

## Current Problem

The project currently has multiple AI entry points and workflow fragments:

| Entry point | Current flow | Problem |
|---|---|---|
| `POST /api/books/:bookId/conversation` | `runConversation` | Mixes chatting, trigger tools, writing, audit, delete, active audit, workflow contracts. |
| `POST /api/books/:bookId/chapters/:no/write` | `writeWithAudit -> recordChapterState` | Separate full-write flow. |
| `POST /api/books/:bookId/chapters/:no/write-draft` | `writeChapterSimple` | Writes prose only; no validation or durable state update. |
| `POST /api/books/:bookId/chapters/:no/finalize` | `auditChapter -> repairChapter -> hardFactGate -> recordChapterState` | Separate confirmation flow. |
| `POST /api/books/:bookId/auto` | `runAutoMode -> writeWithAudit -> recordChapterState` | Separate multi-chapter flow. |
| `POST /api/books/:bookId/onboard` | `runNewBookOnboard` | Separate setup agent and tool flow. |
| `POST /api/books/:bookId/worldbook/chat` | `runWorldbookChat` | Separate worldbook tool agent. |
| `POST /api/books/:bookId/chapters/:no/revise-segment` | `reviseSegment` | Separate generation flow. |
| `POST /api/books/:bookId/chapters/:no/apply-revision` | Direct save | Bypasses validation. |
| Sidebar CRUD routes | Direct repo writes | Fine for manual edits, but not part of AI workflow. |

This causes:

- Duplicate writing paths.
- Duplicate audit and repair paths.
- New workflow contract code only partially used.
- Old direct-write APIs leaving half-finished chapters.
- UI showing success when an SSE stream ended even if the workflow failed internally.
- State recording being called manually from several places.
- Chapter prose being saved before the full workflow has succeeded.

## Evidence From Current Code

Key files:

- `packages/server/src/ai/orchestrator/conversation-orchestrator.ts`
  - Imports and mixes `writeWithAudit`, `auditChapter`, `recordChapterState`, trigger tools, workflow contracts, delete flow, and active audit flow.
  - Natural language currently ends in `agenticChatWithTriggers`, while explicit commands still branch separately.

- `packages/server/src/http/routes/chapters.ts`
  - Defines `/write`, `/write-draft`, and `/finalize`.
  - `/write` does full write + state record.
  - `/write-draft` writes only prose.
  - `/finalize` performs audit/repair/state record on existing prose.

- `packages/server/src/ai/orchestrator/write-with-audit.ts`
  - Performs write, audit, optional repair, hard fact gate event.
  - Saves draft prose before later stages complete.

- `packages/server/src/ai/orchestrator/record-state.ts`
  - Performs durable memory extraction and state updates.
  - Tool failures can become warnings instead of blocking a chapter.

- `packages/client/src/components/editor/editor-pane.tsx`
  - Reads SSE streams manually and does not parse internal `error` or final workflow result.
  - Can show success after the stream ends even when server-side workflow did not finish correctly.

- `packages/client/src/components/conversation/conversation-pane.tsx`
  - UI still has old step labels: write, audit, hard fact gate, repair, record state.

- `packages/shared/src/types/agent-workflow.ts`
  - Contains useful execution mode, policy, trace, and acceptance concepts.
  - It should be reused or evolved, not abandoned, but it currently does not govern all AI entry points.

## Required Target Architecture

### Single AI Workflow Endpoint

Create one canonical endpoint:

```text
POST /api/books/:bookId/agent/run
```

Suggested request:

```ts
interface AgentRunRequest {
  message: string;
  source: "chat" | "editor" | "auto" | "onboard" | "revision" | "asset_audit";
  executionMode?: "trusted_auto" | "low_risk_auto" | "confirm_each";
  target?: {
    chapterNo?: number;
    chapterCount?: number;
    revisionRange?: { chapterNo: number; selectedText?: string };
    assetScope?: "all" | "characters" | "outline" | "worldbook" | "timeline" | "foreshadowing" | "records";
  };
}
```

Suggested SSE events:

```ts
agent_phase       // thinking | executing | validating | waiting_user | repairing | completed
main_output       // visible user reply, hidden draft refs, task contract
execution_plan    // planned tool/durable actions
execution_step    // one action status
validation_report // pass | repairable | needs_user | fail
repair_plan       // when repair starts
done
error
```

You may adapt existing shared workflow events, but the client-facing concept should be the four-phase pipeline.

### Backward Compatibility

Do not break the app in one giant cut. Use transitional wrappers:

- `/conversation` should call the new pipeline with `source: "chat"`.
- `/chapters/:no/write`, `/write-draft`, and `/finalize` should either be deprecated wrappers or removed from the UI after the new editor workflow lands.
- `/auto` should call the new pipeline with `source: "auto"` and `target.chapterCount`.
- `/onboard` should call the new pipeline with `source: "onboard"`.
- `/revise-segment` should call the new pipeline with `source: "revision"`.
- Active audit should call the new pipeline with `source: "asset_audit"`.

Manual CRUD endpoints can remain direct because the user is editing assets manually. AI-generated or AI-mediated changes should go through the pipeline.

## Critical Behavioral Rules

### No More Half Commits

AI workflow output must not become durable book state until validation passes.

Implement staging:

```text
Main Agent draft
-> Executor writes staged changes
-> Validator checks staged changes
-> commit staged changes if pass
-> otherwise keep staged task result for user decision or discard
```

Minimum viable staging can be in memory for a single SSE run, but robust staging should be persisted enough to survive a recoverable UI refresh if practical. Do not let partial chapter versions, summaries, audits, or timeline entries appear as if complete.

### No Success Without Terminal Validation

The frontend must not toast or display success just because an SSE stream ended.

Success requires:

- a `validation_report` with `verdict: "pass"` or a user-approved override, and
- a `done` event whose final result says committed/completed.

Any `error` event must stop success UI.

### Tool Calls Are Centralized

Only the Executor / Repair path should call mutation tools.

The Main Agent can suggest:

- create/update character
- create/update outline
- write chapter
- update timeline
- update record

But actual mutation belongs to Executor.

### Validation Is One Role

Do not keep three separate concepts in the user-facing workflow:

- audit
- hard fact gate
- acceptance report

They can exist internally as helper functions if needed, but the product-level role is Validator Agent. Its report should contain all issues in one place.

### Repair Is User-Controlled

If Validator returns `repairable`, the UI should show a decision dialog:

- Fix
- Regenerate
- Ignore and finish
- Cancel

`executionMode` may allow low-risk automatic repair, but destructive or large rewrites must ask.

## Concrete Implementation Plan

### Phase 1: Inventory And Freeze

Do this first.

- Add or update a route map test/document that lists AI endpoints and marks their status:
  - canonical
  - wrapper
  - deprecated
  - manual CRUD
- Do not add new AI-specific entry points after this.

Expected output:

- `POST /api/books/:bookId/agent/run` is canonical.
- Existing routes are either wrappers or manual CRUD.

### Phase 2: Shared Workflow Types

Refactor or extend:

- `packages/shared/src/types/agent-workflow.ts`
- `packages/shared/src/types/sse-events.ts`

Add/ensure:

```ts
type AgentPhase =
  | "thinking"
  | "executing"
  | "validating"
  | "waiting_user"
  | "repairing"
  | "completed";

type ValidationVerdict = "pass" | "repairable" | "needs_user" | "fail";

interface ValidationIssue {
  severity: "info" | "warning" | "critical";
  area: "user_request" | "chapter" | "character" | "outline" | "worldbook" | "timeline" | "foreshadowing" | "record" | "system";
  message: string;
  evidence?: string;
  suggestedAction?: "repair" | "reroll" | "ask_user" | "ignore" | "stop";
}
```

Keep existing policy helpers if useful, but make them serve the new pipeline.

### Phase 3: Implement Agent Runner Skeleton

Create something like:

- `packages/server/src/ai/orchestrator/agent-runner.ts`
- `packages/server/src/http/routes/agent.ts`

Skeleton flow:

```ts
export async function* runAgentWorkflow(deps, input) {
  yield phase("thinking");
  const main = await runMainAgent(...);

  yield phase("executing");
  const staged = await runExecutorAgent(...);

  yield phase("validating");
  const validation = await runValidatorAgent(...);
  yield validation_report(validation);

  if (validation.verdict === "pass") {
    commit(staged);
    yield phase("completed");
    yield done({ committed: true });
    return;
  }

  yield phase("waiting_user");
  yield done({ committed: false, needsUserDecision: true });
}
```

At first, `runMainAgent` may wrap existing `agenticChatWithTriggers` behavior, but it must not directly mutate state. If old code mutates, do not call it directly from Main Agent.

### Phase 4: Staging Layer

Create a staging abstraction before changing all flows.

Suggested interface:

```ts
interface StagedChange {
  id: string;
  type:
    | "chapter_version"
    | "chapter_summary"
    | "chapter_audit"
    | "character_upsert"
    | "outline_upsert"
    | "timeline_event"
    | "foreshadowing_upsert"
    | "worldbook_upsert"
    | "record_upsert";
  payload: unknown;
}

interface WorkflowStaging {
  add(change: StagedChange): void;
  list(): StagedChange[];
  commit(handle: BookHandle): CommitResult;
  discard(): void;
}
```

Minimum version:

- In-memory staging per request.
- Executor uses repo write functions only during `commit`.

Better version:

- A `workflow_runs` and `workflow_staged_changes` table.
- Allows UI refresh and user repair/ignore after validation.

Do not block the refactor on perfect persistence unless the current app requires refresh-safe repair immediately.

### Phase 5: Executor Agent

Executor should take a structured task, not free-form chat.

It should:

- Read existing state before creating assets.
- Avoid duplicate characters, duplicate outline nodes, duplicate record items.
- Produce an execution plan before mutation.
- Execute into staging.
- Read back staged results or repository results after commit.

Where to consolidate old code:

- Move durable state update logic from `record-state.ts` into Executor helpers or call it as an internal helper that produces staged changes.
- Move chapter save logic from `write-chapter.ts` into Executor staging.
- Keep manual repo CRUD endpoints unchanged.

### Phase 6: Validator Agent

Validator input:

- Original user message.
- Main Agent task contract.
- Execution plan.
- Staged changes.
- Read-back state.
- Existing book context.

Validator checks:

1. User request criteria.
2. Required artifact updates.
3. No accidental duplicate entities.
4. Chapter prose exists when writing was requested.
5. Chapter prose is not put into chat history as normal assistant text.
6. Chapter length profile is satisfied when writing is requested.
7. Context continuity requirements are satisfied.
8. No partial durable writes occurred before commit.

Validator output:

```ts
{
  verdict: "pass" | "repairable" | "needs_user" | "fail";
  issues: ValidationIssue[];
  commitAllowed: boolean;
}
```

Internally, you may reuse parts of:

- `audit-chapter.ts`
- `hard-fact-gate.ts`
- `workflow-contract.ts`

But the final report must be one unified `validation_report`.

### Phase 7: Repair Agent

Repair input:

- Validation report.
- Staged changes or committed state if the user chose repair after commit.
- User-approved repair action.

Repair must:

- Fix only reported issues unless the user asks for more.
- Stage changes.
- Re-run Validator.
- Report what changed.

No automatic loop forever. Limit repair attempts, for example:

- max 1 automatic repair
- max 2 user-triggered repairs per workflow run

### Phase 8: Route Migration

Migrate in this order:

1. `conversation`
2. editor write/rewrite
3. editor finalize
4. auto write
5. onboard
6. revise segment
7. worldbook chat / active audit

For each route:

- Either route through `/agent/run`, or
- directly call `runAgentWorkflow` with the appropriate `source`.

Do not leave old flows callable from UI after migration.

### Phase 9: Client UI

Update:

- `packages/client/src/components/conversation/conversation-pane.tsx`
- `packages/client/src/components/conversation/streaming-message.tsx`
- `packages/client/src/components/editor/editor-pane.tsx`
- `packages/client/src/pages/onboard.tsx`

Requirements:

- Parse SSE events consistently through the shared SSE parser.
- Do not manually read streams and ignore event payloads.
- Show four phases only.
- Show validation dialog when needed.
- Hide chapter prose from chat by default.
- Refresh chapter list only after committed `done`.
- Do not show success toast unless final result is committed.

## Tests Required

Do not skip tests. Codex will check.

### Shared Tests

Add or update:

```text
packages/shared/tests/agent-workflow.test.ts
```

Cover:

- new SSE event schemas
- validation verdict schema
- execution policy decision behavior
- repair decision schema

### Server Unit Tests

Add tests for:

```text
packages/server/tests/unit/ai/orchestrator/agent-runner.test.ts
packages/server/tests/unit/ai/orchestrator/workflow-staging.test.ts
packages/server/tests/unit/ai/orchestrator/validator-agent.test.ts
```

Must cover:

- pass validation commits staged changes
- validation fail does not commit
- repairable validation emits waiting-user state
- executor avoids duplicate character creation when an existing name matches
- write task does not persist chapter before validation pass
- error during executor does not commit partial changes
- error during validator does not commit partial changes

### Server Integration Tests

Add/update:

```text
packages/server/tests/integration/chat-streaming.test.ts
packages/server/tests/integration/books-routes.test.ts
packages/server/tests/integration/agent-runner-routes.test.ts
```

Must cover:

- `/conversation` wrapper emits new phases.
- natural language write request hides prose from chat and commits only after validation.
- `/write-draft` no longer leaves a durable unvalidated chapter, or is no longer used by UI.
- `/finalize` wrapper uses the same validation report format.
- `/auto` uses the same canonical workflow events.
- SSE `error` prevents `done.committed=true`.

### Client Tests

Add/update:

```text
packages/client/tests/components/conversation-writing-intent.test.tsx
packages/client/tests/components/editor-workflow.test.tsx
packages/client/tests/components/validation-dialog.test.tsx
```

Must cover:

- four-phase UI rendering.
- validation issues dialog appears.
- user clicking repair sends repair request.
- editor does not show success after an SSE error.
- editor refreshes chapter list only after committed success.
- generated chapter prose is not displayed as ordinary chat text.

### E2E / Practical Scenario

Create or update an e2e scenario:

1. Create a new book.
2. Add a main character and outline through chat.
3. Ask to write chapter 1.
4. Confirm:
   - chat shows progress, not full prose.
   - editor receives the chapter only after commit.
   - chapter summary/state/timeline are present after completion.
5. Force a validation issue with a fake/test hook.
6. Confirm:
   - validation dialog appears.
   - choosing cancel does not commit.
   - choosing repair triggers repair and revalidation.

## Verification Commands

Run these before claiming success:

```powershell
pnpm --filter @scribe/shared typecheck
pnpm --filter @scribe/server typecheck
pnpm --filter @scribe/client typecheck
pnpm --filter @scribe/shared exec vitest run
pnpm --filter @scribe/server exec vitest run
pnpm --filter @scribe/client exec vitest run
```

If there are e2e tests:

```powershell
pnpm exec playwright test
```

If Playwright is too broad or slow, run the targeted workflow e2e and state exactly which command was used.

## Manual Self-Check

After tests pass, manually inspect the following:

1. Search for old UI labels:

```powershell
rg -n "hard_fact_gate|硬事实|chapter_audit|审查章节质量|record_chapter_state|记录角色状态|write-draft|finalize" packages/client/src packages/server/src
```

Expected:

- Old internal names may remain in internal helper code/tests only.
- They should not be primary user-facing workflow labels.
- UI should use four phases.

2. Search for old AI entry points:

```powershell
rg -n "chapters/:no/write-draft|chapters/:no/finalize|worldbook/chat|revise-segment|runAutoMode|writeWithAudit\\(" packages/server/src packages/client/src
```

Expected:

- Remaining uses should be wrappers or internal helpers with comments explaining migration status.
- No UI button should call an old partial workflow directly.

3. Check no success-on-stream-end remains:

```powershell
rg -n "reader\\.read\\(|正文已生成|确认.*完成|setHasAudit\\(true\\)" packages/client/src
```

Expected:

- No component should read raw SSE and ignore events for AI workflows.
- Success messages should depend on final committed result.

4. Check staging rule:

```powershell
rg -n "saveVersion\\(|chapterFiles\\.save\\(|saveAudit\\(|saveSummary\\(" packages/server/src/ai packages/server/src/http/routes
```

Expected:

- AI workflow writes should go through staging or be clearly inside a commit step.
- Manual PUT chapter save can remain direct.

## Acceptance Criteria

The work is not complete unless all are true:

- One canonical AI workflow exists.
- Chat, editor write, auto write, onboard, revision, and active audit use it or are documented wrappers.
- Durable AI writes do not happen before validation pass or explicit user override.
- UI does not report success unless the workflow committed.
- Validator returns one unified report.
- Repair is triggered from Validator results, not hidden inside random write paths.
- Old audit / hard fact / record state concepts are not exposed as primary user-facing stages.
- Tests cover success, failure, repairable, and SSE error cases.
- Full typecheck and vitest suites pass.

## Important Warning For Claude

Be honest with the implementation.

Do not:

- Add another endpoint that bypasses the pipeline.
- Keep old routes secretly active from UI.
- Claim staging exists while still saving chapter versions before validation.
- Swallow SSE errors and show success.
- Create cosmetic tests that only check event names.
- Rename old audit to Validator without unifying the behavior.
- Leave `/write-draft` producing durable unvalidated chapters.

Codex will review the diff after you finish. It will specifically look for old flow leakage, half-commit behavior, UI false success, missing tests, and routes that still bypass the canonical pipeline.

