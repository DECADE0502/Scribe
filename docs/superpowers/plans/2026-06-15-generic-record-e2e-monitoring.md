# Generic Record E2E Monitoring Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run multiple different novels through the real local Scribe flow and collect evidence that generic record collections, fields, items, and relations are decided by AI and persisted through generic tools.

**Architecture:** Add a narrow monitoring script under `packages/server/tools` that uses the real book registry, model manager, onboarding orchestrator, auto mode, audit, and record-state orchestrator. It creates fresh books with distinct premises, streams tool events, inspects the resulting SQLite-backed repositories, and writes a JSON report for manual and automated inspection.

**Tech Stack:** TypeScript, tsx, existing server orchestrators, SQLite repositories, configured DeepSeek/MiMo provider.

---

### Task 1: Build A Real-Flow Monitor

**Files:**
- Create: `packages/server/tools/monitor-generic-record-flow.ts`

- [ ] **Step 1: Create the monitor script**

The script must:
- Load existing app paths, config, and secrets.
- Fail clearly if no model/API key is configured.
- Create three fresh books with different premises: science-fiction investigation, workplace/legal realism, and mythic/fantasy adventure.
- Run `runNewBookConversation` for onboarding with the real tool registry.
- Run `runAutoMode` for at least one chapter per book, with `recordChapterState` enabled.
- Capture tool-call names, old generic-section tool names, errors, chapters written, audit verdicts, collections, schema declarations, item counts, identity/display/search fields, and relation fields.
- Write a JSON report under `tmp/`.

- [ ] **Step 2: Compile-check the script**

Run:

```powershell
pnpm --filter @scribe/server typecheck
```

Expected: exit code 0.

### Task 2: Execute Multi-Novel Monitoring

- [ ] **Step 1: Run the monitor**

Run:

```powershell
pnpm --filter @scribe/server exec tsx tools/monitor-generic-record-flow.ts --chapters 1
```

Expected: the script creates three books, completes onboarding, writes at least one chapter per book, records chapter state, and writes a report path.

- [ ] **Step 2: Inspect results**

For each book, verify:
- At least one generic record collection exists, unless onboarding/record-state explicitly produced no record-worthy domain objects.
- Collections declare `identityFields` and `displayFields`.
- Items are persisted through `upsert_record_item`.
- `create_record_collection`, `update_record_collection_schema`, `upsert_record_item`, or `link_record_items` appear where appropriate.
- Legacy tool names such as `create_genre_section` and `upsert_genre_section_item` do not appear in new AI-facing calls.
- Collection names and fields are appropriate to each book’s premise, not copied from a single topic.

### Task 3: Fix Any Discovered Defect

- [ ] **Step 1: If the run fails, capture exact error output**

Use the failure output and report data as root-cause evidence.

- [ ] **Step 2: Add a focused regression test before changing production code**

Only if production code needs a fix, add the smallest failing test that reproduces the defect.

- [ ] **Step 3: Implement the minimal fix and rerun**

Rerun the focused test, package typecheck, and the monitor command.

### Task 4: Final Verification

- [ ] **Step 1: Run focused package checks**

Run:

```powershell
pnpm --filter @scribe/server typecheck
pnpm --filter @scribe/server test -- ai/tools/genre-section-tools.test.ts genre-section-validator.test.ts
```

Expected: exit code 0 for both commands.

- [ ] **Step 2: Report evidence**

Final response must include:
- Report path.
- Book IDs and titles.
- Chapters written per book.
- Generic tool calls observed.
- Collection summaries and whether legacy tool calls appeared.
- Any failures or residual risks.
