# Codex Handoff: SillyTavern Import, Worldbook Runtime, and Long-Form Continuity

Last updated: 2026-06-16 19:46 Asia/Shanghai

## 0. Read This First

The active user goal is:

> 完全兼容 SillyTavern 世界书和预设，可自由调节、自由编辑，并且导入后要真正影响写作，保证长篇连续记忆、剧情连续。

Do not shrink this goal to "imports work" or "tests pass". The real acceptance bar is reader-visible long-form writing quality:

- SillyTavern preset files import completely.
- SillyTavern worldbook files import completely.
- Imported preset and worldbook fields remain editable.
- Runtime writing actually uses imported presets, regex scripts, worldbook retrieval, reader issues, and structured memory.
- Long-form writing keeps inventory, contracts, deadlines, status panels, relationships, and plot continuity across many chapters.
- A fresh live 15-chapter run must pass and be manually skimmed as a reader.

The latest 15-chapter run was interrupted by the user before completion, so the goal is not complete.

## 1. User Intent and Product Direction

The user is building a local Chinese long-form novel writing engine. They care much more about writing quality and continuity than ordinary code quality. They explicitly rejected sample-specific hardcoding. They want a generic, efficient architecture where AI decides what facts matter and records them through generic local APIs.

Important user requirements from this thread:

- "我要的是全部通用，AI 自动判断要记录什么，自己通过接口加字段，记录"
- "不要只看代码质量，你自己跑一下不同的几个小说，全流程监控一下"
- "我可以接受先半自动，但是质量得保证"
- "我说的不是代码质量，是写作质量和连续性"
- SillyTavern preset/worldbook import must not be cosmetic. Imported prompts and worldbook entries must actually affect generated prose.

The user also proposed a SillyTavern-like "worldbook / core setting interaction mode":

- Users can import SillyTavern worldbooks.
- Entries can be constant or trigger-based.
- Entries have trigger keys, depth, recursion, recursion limits, probability, cooldown, delay, grouping, etc.
- A separate mode should allow the user to chat with AI to refine settings/worldbook entries.
- During writing, the AI still records new facts automatically.
- Each AI call should retrieve relevant knowledge by keywords and support recursive retrieval.

## 2. Current Architecture Snapshot

Repo root:

```text
C:\Users\Administrator\Desktop\novel
```

Main packages:

- `packages/shared`: shared types.
- `packages/server`: Hono + SQLite + Vercel AI SDK backend.
- `packages/client`: React frontend.

Key writing pipeline:

```text
write chapter call
  -> writeWithAudit()
  -> writeChapterSimple()
  -> save chapter version and .md

audit call
  -> auditChapter()
  -> persistAuditResult()
  -> save chapter audit, chapter summary, and reader issues

record state call
  -> recordChapterState()
  -> AI uses generic tools
  -> characters, genre sections, foreshadowing, timeline, generic records are updated
```

This is intentionally three calls. The important point is that the third call must actually run after each final chapter text is chosen. If it does not run, new items/rules/deadlines/contracts in prose do not enter structured memory, and later chapters drift.

## 3. User's Question: "记录新增物品和信息的是写正文那次调用还是分了两次调用?"

Answer:

It is separate, and that separation is correct.

1. The writing call generates prose.
2. The audit call judges quality/continuity and creates summaries/reader issues.
3. The state-recording call reads the final chapter and uses tools to record durable facts.

The bug found in this handoff period was not that calls were separate. The bug was that the SillyTavern long-form monitor path used `writeWithAudit()` but did not run `recordChapterState()`. That meant the monitor could not prove long-term memory was really being updated.

This has now been partially fixed for the monitor path.

## 4. Important Local SillyTavern Sample Files

The user provided two real SillyTavern exports:

```text
C:\Users\Administrator\Desktop\novel\Izumi 0503.json
C:\Users\Administrator\Desktop\novel\宠物捕捉系统-世界书.json
```

Do not assume these should be committed to GitHub. They may contain private prompts/settings. Use them locally for verification.

Observed import expectations from the sample files:

- Preset import:
  - `promptPresets`: 1
  - `promptBlocks`: 203
  - enabled runtime prompt blocks: 52 in earlier verification
  - regex scripts: 26 in earlier verification
- Worldbook import:
  - `worldbookEntries`: 38
  - constant entries: 7 in earlier verification

## 5. Written Plans and Specs

Primary current execution plan:

```text
docs/superpowers/plans/2026-06-16-sillytavern-quality-continuity.md
```

Older but still useful context:

```text
docs/superpowers/plans/2026-06-16-sillytavern-full-compatibility.md
docs/superpowers/plans/2026-06-16-sillytavern-import.md
docs/superpowers/specs/2026-06-16-sillytavern-import-design.md
docs/superpowers/plans/2026-06-15-generic-record-architecture.md
docs/superpowers/plans/2026-06-15-generic-record-e2e-monitoring.md
docs/superpowers/plans/2026-06-15-worldbook-driven-writing.md
```

Use Superpowers workflow if available. The user explicitly requested it.

## 6. Recent Implementation Progress

### 6.1 SillyTavern long-form monitor now treats state recording as required evidence

Touched files:

```text
packages/server/src/ai/monitor/sillytavern-longform-monitor.ts
packages/server/tools/monitor-sillytavern-longform.ts
packages/server/tests/unit/ai/monitor/sillytavern-longform-monitor.test.ts
```

Added monitor evidence fields:

- `recordStateAttempted`
- `recordStateSucceeded`
- `recordStateToolCallCount`
- `recordStateUpsertCount`

`buildSillyTavernLongformVerdict()` now fails live reports when a chapter has not recorded state:

```text
chapter N: chapter state was not recorded
```

The live monitor now runs `recordChapterState()` after final chapter text is selected and sanitized.

### 6.2 Output sanitization now applies to write, repair, audit, and monitor evidence

Touched files:

```text
packages/server/src/ai/orchestrator/output-sanitize.ts
packages/server/src/ai/orchestrator/write-chapter.ts
packages/server/src/ai/orchestrator/write-with-audit.ts
packages/server/src/ai/orchestrator/repair-chapter.ts
packages/server/tests/unit/ai/orchestrator/output-sanitize.test.ts
packages/server/tests/unit/ai/orchestrator/repair-chapter.test.ts
packages/server/tests/integration/write-then-audit.test.ts
```

The sanitizer removes non-novel SillyTavern-style meta blocks such as:

- `<progress>...</progress>`
- `<current_event>...</current_event>`
- `<konatan_chat>...</konatan_chat>`
- `<analysis>...</analysis>`
- `<thinking>...</thinking>`
- `<instructions>...</instructions>`

It intentionally preserves diegetic in-story system/status panel text, such as a character seeing a status bar.

Important behavior:

- `writeChapterSimple()` saves sanitized content.
- `writeWithAudit()` audits sanitized draft text.
- `repairChapter()` saves sanitized repair text.
- `writeWithAudit()` re-audits sanitized repair text.
- `monitor-sillytavern-longform.ts` checks sanitized final text.

### 6.3 Repair and critical handling

The monitor now enables repair, captures repair evidence, and stops on unresolved critical chapters.

Fields:

- `repairAttempted`
- `repairVerdict`
- `repairStillCritical`
- `stoppedAfterChapter`

Verdict semantics:

- Critical with no repair attempt fails.
- Critical repaired to `ok` or `warning` is treated as resolved.
- Critical repaired to `critical`, or `repairStillCritical=true`, fails.

### 6.4 Prompt and continuity improvements already in the tree

Earlier work in this branch added:

- No-meta-output rules in write and repair prompts.
- Required output section extraction from imported preset blocks.
- Missing required status term detection.
- Hard continuity extraction for timers/resources/contracts/inventory/cooldowns.
- Writer and auditor both receive hard continuity context.

Relevant files:

```text
packages/server/src/ai/prompts/write-chapter.ts
packages/server/src/ai/prompts/repair-chapter.ts
packages/server/src/ai/context-builder/book-context.ts
packages/server/tests/unit/ai/context-builder/book-context.test.ts
packages/server/tests/unit/ai/context-builder/audit-worldbook-context.test.ts
```

## 7. Verification Evidence So Far

These passed after the latest state-recording/sanitization changes:

```powershell
pnpm --filter @scribe/server test -- write-then-audit.test.ts repair-chapter.test.ts sillytavern-longform-monitor.test.ts output-sanitize.test.ts
pnpm --filter @scribe/server test -- output-sanitize.test.ts write-chapter.test.ts repair-chapter.test.ts sillytavern-longform-monitor.test.ts book-context.test.ts audit-worldbook-context.test.ts
pnpm --filter @scribe/server typecheck
```

Results:

- First focused run: 4 files, 30 tests passed.
- Second focused run: 7 files, 31 tests passed.
- Server typecheck passed.

Live smoke tests:

1. One-chapter live monitor:

```text
Book: c599485c-781d-4a27-b364-76729d4b8cb2
Report: packages/server/tmp/sillytavern-longform-live-2026-06-16T10-35-59-174Z.json
Verdict: passed=true
```

Evidence from report:

```json
{
  "wordCount": 1760,
  "auditVerdict": "ok",
  "recordStateAttempted": true,
  "recordStateSucceeded": true,
  "recordStateToolCallCount": 27,
  "recordStateUpsertCount": 9,
  "styleNotes": [],
  "continuityNotes": []
}
```

2. Three-chapter live monitor:

```text
Book: bb9a71ec-2b8c-4d52-bb6d-90ce7a877408
Report: packages/server/tmp/sillytavern-longform-live-2026-06-16T10-38-53-535Z.json
Verdict: passed=true
```

Evidence:

```json
[
  {
    "chapterNo": 1,
    "wordCount": 1550,
    "auditVerdict": "ok",
    "recordStateAttempted": true,
    "recordStateSucceeded": true,
    "recordStateToolCallCount": 16,
    "recordStateUpsertCount": 4,
    "worldbookEntryCount": 13,
    "styleNotes": [],
    "continuityNotes": []
  },
  {
    "chapterNo": 2,
    "wordCount": 1436,
    "auditVerdict": "ok",
    "recordStateAttempted": true,
    "recordStateSucceeded": true,
    "recordStateToolCallCount": 15,
    "recordStateUpsertCount": 4,
    "worldbookEntryCount": 13,
    "styleNotes": [],
    "continuityNotes": []
  },
  {
    "chapterNo": 3,
    "wordCount": 1241,
    "auditVerdict": "ok",
    "recordStateAttempted": true,
    "recordStateSucceeded": true,
    "recordStateToolCallCount": 13,
    "recordStateUpsertCount": 3,
    "worldbookEntryCount": 14,
    "styleNotes": [],
    "continuityNotes": []
  }
]
```

A 5-chapter live monitor was run after the state-recording integration:

```text
Book: 22128208-3e29-41ce-8138-3aa83c786db5
Report: packages/server/tmp/sillytavern-longform-live-2026-06-16T11-35-31-586Z.json
Verdict: passed=false
Failure: chapter 5: status bar missing required terms: contract
```

This run is important because it proves the write/audit/record loop is executing for multiple chapters, while exposing the next quality gap: required-section failures detected by the monitor are not yet fed back into the repair loop. Evidence summary:

```json
[
  { "chapterNo": 1, "auditVerdict": "ok", "recordStateSucceeded": true, "recordStateToolCallCount": 14, "recordStateUpsertCount": 2, "worldbookEntryCount": 13 },
  { "chapterNo": 2, "auditVerdict": "ok", "recordStateSucceeded": true, "recordStateToolCallCount": 9, "recordStateUpsertCount": 1, "worldbookEntryCount": 13 },
  { "chapterNo": 3, "auditVerdict": "warning", "recordStateSucceeded": true, "recordStateToolCallCount": 9, "recordStateUpsertCount": 1, "worldbookEntryCount": 14 },
  { "chapterNo": 4, "auditVerdict": "ok", "recordStateSucceeded": true, "recordStateToolCallCount": 8, "recordStateUpsertCount": 1, "worldbookEntryCount": 13, "readerIssueIds": 1 },
  { "chapterNo": 5, "auditVerdict": "ok", "recordStateSucceeded": true, "recordStateToolCallCount": 23, "recordStateUpsertCount": 2, "worldbookEntryCount": 13, "readerIssueIds": 2, "styleNotes": ["status bar missing required terms: contract"] }
]
```

The next implementation should make monitor-detected style/required-section failures actionable, not merely report them. Best path: after final text is selected, if `detectMissingRequiredSections()` or `detectMetaOutputLeakage()` returns issues, invoke the same repair + re-audit path with those issues, then re-run the required-section/meta checks on repaired text before saving the chapter as accepted. Do not rely solely on the audit model, because chapter 5 had `auditVerdict=ok` while still missing a required preset term.

A 15-chapter live monitor was started earlier but the user intentionally interrupted it and asked to stop. Do not treat the 15-chapter acceptance gate as complete.

## 8. Known Remaining Problems

### 8.1 Full goal is not complete

The current tree is closer, but the final objective is still unproven:

- No fresh 15-chapter live run has passed after the latest changes.
- Advanced SillyTavern runtime semantics are still incomplete.
- Editing APIs/UI exist in progress but are not fully verified.
- Reader-quality manual skim of chapters 1, 5, 10, 15 has not happened after latest changes.

### 8.2 Worldbook runtime semantics still need work

Need to finish and verify:

- case sensitivity
- whole-word matching
- selective secondary keys
- scan depth
- recursion depth and recursion limit
- constant entries
- probability
- grouping and group weights
- sticky
- cooldown
- delay
- insertion depth
- diagnostics for selected/dropped entries

Relevant files:

```text
packages/server/src/ai/worldbook/retrieval.ts
packages/server/tests/unit/ai/worldbook/sillytavern-retrieval.test.ts
packages/server/tests/unit/ai/context-builder/worldbook-context.test.ts
packages/shared/src/types/worldbook.ts
packages/shared/src/types/sillytavern-import.ts
```

### 8.3 Preset runtime semantics still need work

Need to finish and verify:

- prompt order / prompt stack
- enabled/disabled prompt block behavior
- regex script placement and safety
- generation settings preservation and editability
- diagnostics proving prompt blocks and regex scripts affected writing context

Relevant files:

```text
packages/server/src/ai/import/sillytavern-preset.ts
packages/server/src/ai/presets/render.ts
packages/server/src/ai/presets/regex-scripts.ts
packages/server/tests/unit/ai/import/sillytavern-preset.test.ts
packages/server/tests/unit/ai/presets/regex-scripts.test.ts
packages/server/tests/unit/ai/context-builder/preset-context.test.ts
```

### 8.4 Editing APIs/UI must be verified end to end

Need to verify users can freely edit imported fields and that edits affect writing.

Relevant files:

```text
packages/server/src/http/routes/presets.ts
packages/server/src/http/routes/worldbook.ts
packages/client/src/api/client.ts
packages/client/src/components/presets/preset-panel.tsx
packages/client/src/components/worldbook/worldbook-panel.tsx
packages/client/tests/components/preset-panel.test.tsx
packages/client/tests/components/worldbook-panel.test.tsx
```

### 8.5 Generated report/temp files should not be committed

Local runtime artifacts live under:

```text
packages/server/tmp/
tmp/
```

These are useful evidence locally, but should not be pushed unless the user explicitly asks for artifacts.

The two SillyTavern JSON samples are also local inputs and may be private. Do not commit them by default.

## 9. Next Best Steps

### Step 1: Re-run focused tests

```powershell
pnpm --filter @scribe/server test -- output-sanitize.test.ts write-chapter.test.ts repair-chapter.test.ts sillytavern-longform-monitor.test.ts book-context.test.ts audit-worldbook-context.test.ts
pnpm --filter @scribe/server typecheck
```

### Step 2: Run a 5-chapter live monitor before the full 15

This gives a faster signal after latest state-recording changes:

```powershell
pnpm --filter @scribe/server exec tsx tools/monitor-sillytavern-longform.ts --live --chapters 5 --chapter-timeout-ms 420000 "C:/Users/Administrator/Desktop/novel/Izumi 0503.json" "C:/Users/Administrator/Desktop/novel/宠物捕捉系统-世界书.json"
```

Check:

- every chapter has `recordStateAttempted=true`
- every chapter has `recordStateSucceeded=true`
- `recordStateUpsertCount` is usually nonzero when new durable facts appear
- no meta-output leakage
- no missing required status section
- worldbook entries trigger
- reader issue appears from chapter 5 onward when monitor creates it

### Step 3: Run the full 15-chapter acceptance monitor

```powershell
pnpm --filter @scribe/server exec tsx tools/monitor-sillytavern-longform.ts --live --chapters 15 --chapter-timeout-ms 420000 "C:/Users/Administrator/Desktop/novel/Izumi 0503.json" "C:/Users/Administrator/Desktop/novel/宠物捕捉系统-世界书.json"
```

Acceptance is not just `verdict.passed=true`. Also manually skim chapters 1, 5, 10, and 15 as a reader:

- Does the story read like a novel rather than prompt output?
- Are status panels diegetic and consistent?
- Are inventory/resources/deadlines changed only with shown causes?
- Do contracts/relationships persist?
- Does the prose avoid repetitive explaining?
- Are imported preset style constraints visible in the writing?
- Are worldbook facts used naturally rather than dumped?

### Step 4: Finish compatibility/editability

Follow tasks 5-8 in:

```text
docs/superpowers/plans/2026-06-16-sillytavern-quality-continuity.md
```

Do not skip runtime semantics. UI editability is not enough unless edited settings affect retrieval/writing.

## 10. Important Commands

Verify import:

```powershell
pnpm --filter @scribe/server exec tsx tools/verify-sillytavern-import.ts "C:/Users/Administrator/Desktop/novel/Izumi 0503.json" "C:/Users/Administrator/Desktop/novel/宠物捕捉系统-世界书.json"
```

Run context-only monitor:

```powershell
pnpm --filter @scribe/server exec tsx tools/monitor-sillytavern-longform.ts --chapters 15 "C:/Users/Administrator/Desktop/novel/Izumi 0503.json" "C:/Users/Administrator/Desktop/novel/宠物捕捉系统-世界书.json"
```

Run live monitor:

```powershell
pnpm --filter @scribe/server exec tsx tools/monitor-sillytavern-longform.ts --live --chapters 15 --chapter-timeout-ms 420000 "C:/Users/Administrator/Desktop/novel/Izumi 0503.json" "C:/Users/Administrator/Desktop/novel/宠物捕捉系统-世界书.json"
```

Focused server tests:

```powershell
pnpm --filter @scribe/server test -- audit-chapter.test.ts audit-worldbook-context.test.ts book-context.test.ts sillytavern-longform-monitor.test.ts sillytavern-retrieval.test.ts sillytavern-preset.test.ts sillytavern-worldbook.test.ts regex-scripts.test.ts preset-routes.test.ts worldbook-routes.test.ts write-then-audit.test.ts
pnpm --filter @scribe/server typecheck
```

Client tests:

```powershell
pnpm --filter @scribe/client test -- import-dialog.test.tsx preset-panel.test.tsx worldbook-panel.test.tsx
pnpm --filter @scribe/client typecheck
```

Broad regression:

```powershell
pnpm --filter @scribe/server test
pnpm --filter @scribe/client test
pnpm -r exec tsc --noEmit
```

## 11. Git / GitHub State at Handoff Time

Current branch:

```text
codex/generic-record-architecture
```

At the moment this document was written, there was no configured git remote in the local repo. The user asked to send the pack to:

```text
https://github.com/DECADE0502/st_novel
```

Recommended push target:

```powershell
git remote add origin https://github.com/DECADE0502/st_novel.git
git push -u origin codex/generic-record-architecture
```

Before pushing, avoid committing:

- `Izumi 0503.json`
- `宠物捕捉系统-世界书.json`
- `packages/server/tmp/`
- `tmp/`
- secrets or local `.env` files

## 12. Mental Model for the Next AI

Do not think of this as a normal import feature. Think of it as a writing-quality control loop:

```text
SillyTavern import
  -> normalized editable runtime model
  -> prompt/worldbook retrieval enters every writing call
  -> prose is generated
  -> prose is sanitized
  -> audit sees the same final prose and the same hard continuity context
  -> critical failures are repaired and re-audited
  -> final prose is recorded into structured memory
  -> next chapter retrieves preset/worldbook/reader issues/structured memory
  -> live monitor proves the loop over many chapters
```

The whole point is preventing long-form drift while preserving user-editable SillyTavern behavior.

If you change anything, verify it as a reader, not only as a TypeScript project.
