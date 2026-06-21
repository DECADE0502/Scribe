# Task 5 Report: Server Writing Workflow Plan, Trace, And Acceptance Events

## Status

DONE_WITH_CONCERNS

## Summary

- Added natural-language writing workflow planning in `conversation-orchestrator.ts`.
- Natural-language write requests now emit `execution_plan` with intent contract, policy, and steps.
- Non-auto modes, including `plan_only` and default `low_risk_auto` for write risk, emit `confirmation_required`, then `done`, without writing chapters.
- `trusted_auto` mode emits running and terminal `execution_step` events around each chapter write, reads back the chapter file, and emits an `acceptance_report` built from the workflow contract and execution trace.
- Slash `/write` behavior was left unchanged.

## TDD Evidence

Baseline before adding Task 5 tests:

```text
pnpm --filter @scribe/server exec vitest run tests/unit/ai/orchestrator/conversation-orchestrator.test.ts
6 tests passed
```

RED after adding Task 5 tests:

```text
pnpm --filter @scribe/server exec vitest run tests/unit/ai/orchestrator/conversation-orchestrator.test.ts
2 failed, 6 passed

plans natural language writing in plan_only mode without writing chapters
expected undefined to deeply equal [ 'chapterNo=6' ]

traces trusted_auto natural language writing and emits a passing acceptance report
expected undefined to be 'auto'
```

GREEN after implementation:

```text
pnpm --filter @scribe/server exec vitest run tests/unit/ai/orchestrator/conversation-orchestrator.test.ts
8 tests passed
```

Typecheck:

```text
pnpm --filter @scribe/server typecheck
tsc --noEmit
exit 0
```

## Fix Report 2

Summary:
- Updated `workflow-contract.test.ts` stale expectations for `makeWriteActions([1, 2, 3])`.
- The workflow contract test now expects each target chapter to create both `multi_chapter_write` and `record_chapter_state` execution steps.
- Added explicit coverage that `record_chapter_state` steps exist and keep parseable `chapterNo` values in `argsSummary`.

RED before fix:

```text
pnpm --filter @scribe/server exec vitest run tests/unit/ai/orchestrator/conversation-orchestrator.test.ts tests/unit/ai/orchestrator/workflow-contract.test.ts
Test Files  1 failed | 1 passed (2)
Tests  1 failed | 18 passed (19)
workflow contract helpers > includes target chapter numbers in execution step argument summaries
expected [ 'chapterNo=1', 'chapterNo=1', ...(4) ] to deeply equal [ 'chapterNo=1', 'chapterNo=2', ...(1) ]
```

Verification after fix:

```text
pnpm --filter @scribe/server exec vitest run tests/unit/ai/orchestrator/conversation-orchestrator.test.ts tests/unit/ai/orchestrator/workflow-contract.test.ts
Test Files  2 passed (2)
Tests  19 passed (19)
```

```text
pnpm --filter @scribe/server typecheck
tsc --noEmit
exit 0
```

## Files Changed

- `packages/server/src/ai/orchestrator/conversation-orchestrator.ts`
- `packages/server/tests/unit/ai/orchestrator/conversation-orchestrator.test.ts`
- `.superpowers/sdd/task-5-report.md`

## Concerns

The working tree had pre-existing dirty changes before this task, including in both intended owned code files. Some prior uncommitted multi-chapter write intent changes are interleaved with the Task 5 hunks and are also required by the Task 5 implementation, especially `parseWriteChapterCount` and the widened natural-language write hint. Because these hunks cannot be safely separated from pre-existing dirty work with high confidence, no commit was created.

## Fix Report

Summary:
- Expanded natural-language write workflow actions so each target chapter plans both `chapter_write` and `record_chapter_state`.
- Converted `record_chapter_state` tool start/end events into visible `execution_step` events with `state_compare` verification.
- Stopped trusted_auto batch writing after a chapter write/read-back failure or state-recording failure.
- Added focused regression coverage proving a failed first chapter write does not continue to later chapters.

Tests:

```text
pnpm --filter @scribe/server exec vitest run tests/unit/ai/orchestrator/conversation-orchestrator.test.ts
Test Files  1 passed (1)
Tests  9 passed (9)
```

```text
pnpm --filter @scribe/server typecheck
tsc --noEmit
exit 0
```
