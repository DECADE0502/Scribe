# Task 3 Report: Server Workflow Contract Helpers

## Summary

Implemented server-side workflow contract helper functions for write workflows:

- `createTaskId`
- `buildWriteIntentContract`
- `makeExecutionSteps`
- `makeWriteActions`
- `makeWritePolicy`
- `makeAcceptanceReport`

Added focused unit coverage for the required workflow contract, execution step, and acceptance report behavior.

## Files Changed

- `packages/server/src/ai/orchestrator/workflow-contract.ts`
- `packages/server/tests/unit/ai/orchestrator/workflow-contract.test.ts`

## TDD Evidence

### RED

Command:

```bash
pnpm --filter @scribe/server exec vitest run tests/unit/ai/orchestrator/workflow-contract.test.ts
```

Result: failed as expected before implementation.

Failure:

```text
Error: Failed to load url ../../../../src/ai/orchestrator/workflow-contract.js ... Does the file exist?
```

### GREEN

Command:

```bash
pnpm --filter @scribe/server exec vitest run tests/unit/ai/orchestrator/workflow-contract.test.ts
```

Result:

```text
Test Files  1 passed (1)
Tests  3 passed (3)
```

## Verification

Command:

```bash
pnpm --filter @scribe/server typecheck
```

Result:

```text
tsc --noEmit
```

Exit code: 0.

## Notes

- Existing unrelated dirty changes were present before this task and were not touched.
- The report file is intentionally not committed.

## Task 3 Review Fix - 2026-06-21

Commit: a1f84ea fix(server): enforce write acceptance counts

Changes:
- Added count-aware acceptance for chapter write criteria by parsing `There are N successful chapter write steps` from the contract.
- Treats a verified write step as a succeeded action whose action type includes `write` and whose verification passed.
- Requires read-back criteria to match the expected write count and fail when no target write is expected.
- Preserves the stop recommendation for failed workflow criteria.
- Added failing-path coverage for partial writes, failed read-back verification, failed final status, and omitted write policy mode default.

Verification:
- RED observed: `pnpm --filter @scribe/server exec vitest run tests/unit/ai/orchestrator/workflow-contract.test.ts` failed before implementation with partial write incorrectly passing and read-back evidence using old logic.
- GREEN: `pnpm --filter @scribe/server exec vitest run tests/unit/ai/orchestrator/workflow-contract.test.ts` passed, 7 tests.
- Typecheck: `pnpm --filter @scribe/server typecheck` passed.

## Task 3 Re-review Fix - 2026-06-21

Commit: pending

Changes:
- Preserved target chapter numbers in execution step `argsSummary` as `chapterNo=N` for intended write actions.
- Encoded write contract targets in `mustDo` with parseable `Target chapters: ...` while preserving existing required acceptance strings.
- Updated acceptance reporting to compare verified write/read-back chapter target sets against expected targets when known.
- Verified write targets now require an action type containing `write`, succeeded status, passed verification, and matching chapter evidence from `argsSummary`, `resultSummary`, or verification detail.
- Added regression coverage for duplicate wrong targets failing, distinct targets passing, and execution steps exposing target chapter summaries.

Verification:
- RED observed: `pnpm --filter @scribe/server exec vitest run tests/unit/ai/orchestrator/workflow-contract.test.ts` failed before implementation with missing `argsSummary` and duplicate chapter 1 writes incorrectly passing.
- GREEN: `pnpm --filter @scribe/server exec vitest run tests/unit/ai/orchestrator/workflow-contract.test.ts` passed, 10 tests.
- Typecheck: `pnpm --filter @scribe/server typecheck` passed.

Notes:
- Existing unrelated dirty changes were present before this task and were not touched.
- The report file is intentionally not committed.
