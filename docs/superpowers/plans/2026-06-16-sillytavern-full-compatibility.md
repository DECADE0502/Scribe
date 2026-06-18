# SillyTavern Full Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make SillyTavern presets and worldbooks fully importable, editable, tunable, and active in long-form writing so they improve style control, world-state recall, and chapter-to-chapter continuity.

**Architecture:** Treat imported SillyTavern JSON as preserved source artifacts plus normalized runtime objects. Prompt presets compile into ordered prompt messages with macro and regex behavior. Worldbook entries compile into a deterministic retrieval plan with SillyTavern matching controls, recursion, probability, grouping, and explainable diagnostics. A long-form monitor proves the imported material affects at least 15 generated chapters and catches continuity failures from a reader perspective.

**Tech Stack:** TypeScript, Zod, Hono, SQLite/better-sqlite3 workspace migrations, Vercel AI SDK `CoreMessage`, React, Vitest, Testing Library, existing Scribe repositories and orchestrator flow.

---

## Current Baseline

- Preset/worldbook import already exists for the provided files.
- Imported preset blocks already enter writing context.
- Prompt regex scripts now apply to rendered preset prompt blocks.
- Reader audit issues can be persisted and injected into later writing context.
- The remaining work is not raw import plumbing. The remaining work is semantic compatibility, complete editability, and real long-form quality verification.

## File Structure

- Modify `packages/shared/src/types/sillytavern-import.ts`: expand SillyTavern metadata schemas for preset prompts, regex scripts, worldbook fields, and retrieval diagnostics.
- Modify `packages/shared/src/types/worldbook.ts`: expose editable matching controls through native worldbook patch/create schemas.
- Modify `packages/server/src/ai/import/sillytavern-preset.ts`: preserve and normalize prompt order, prompt roles, injection controls, generation settings, and regex scripts.
- Modify `packages/server/src/ai/import/sillytavern-worldbook.ts`: preserve and normalize all relevant SillyTavern entry fields into metadata plus native searchable fields.
- Modify `packages/server/src/ai/presets/render.ts`: keep block-level diagnostics and stable prompt ordering.
- Modify `packages/server/src/ai/presets/regex-scripts.ts`: support prompt/output placement, trim strings, invalid regex safety, and execution diagnostics.
- Modify `packages/server/src/ai/worldbook/retrieval.ts`: implement SillyTavern-style matching semantics, recursion controls, probability, group scoring, scan depth, sticky/cooldown/delay state, and diagnostics.
- Modify `packages/server/src/ai/context-builder/builder.ts`: expose context diagnostics showing which presets/worldbook/reader issues affected the write.
- Modify `packages/server/src/ai/context-builder/snapshot.ts`: load full preset metadata and any worldbook runtime state needed by retrieval.
- Modify `packages/server/src/http/routes/imports.ts`: return richer preview/import reports.
- Modify `packages/server/src/http/routes/presets.ts`: allow preset enablement, block edit/reorder, regex enablement, regex edit/toggle, and generation settings edit.
- Modify `packages/server/src/http/routes/worldbook.ts`: allow editing imported SillyTavern metadata controls and previewing exact trigger explanations.
- Modify `packages/client/src/api/client.ts`: add typed APIs for preset/worldbook advanced edit and preview diagnostics.
- Modify `packages/client/src/components/import/import-dialog.tsx`: show import warnings, counts, and preserved source type details.
- Modify `packages/client/src/components/presets/preset-panel.tsx`: add full preset/block/regex controls.
- Modify `packages/client/src/components/worldbook/worldbook-panel.tsx`: add full worldbook metadata controls and preview diagnostics.
- Create `packages/server/tools/monitor-sillytavern-longform.ts`: real 15 chapter monitor with quality and continuity report.
- Modify `packages/server/tools/verify-sillytavern-import.ts`: include prompt regex, worldbook trigger, and context diagnostic checks.
- Tests:
  - `packages/server/tests/unit/ai/import/sillytavern-preset.test.ts`
  - `packages/server/tests/unit/ai/import/sillytavern-worldbook.test.ts`
  - `packages/server/tests/unit/ai/presets/regex-scripts.test.ts`
  - `packages/server/tests/unit/ai/worldbook/sillytavern-retrieval.test.ts`
  - `packages/server/tests/unit/ai/context-builder/preset-context.test.ts`
  - `packages/server/tests/unit/ai/context-builder/worldbook-context.test.ts`
  - `packages/server/tests/integration/import-routes.test.ts`
  - `packages/server/tests/integration/preset-routes.test.ts`
  - `packages/server/tests/integration/worldbook-routes.test.ts`
  - `packages/client/tests/components/import-dialog.test.tsx`
  - `packages/client/tests/components/preset-panel.test.tsx`
  - `packages/client/tests/components/worldbook-panel.test.tsx`

## Task 1: Lock Down Real Sample Compatibility

**Files:**
- Modify: `packages/server/tests/unit/ai/import/sillytavern-preset.test.ts`
- Modify: `packages/server/tests/unit/ai/import/sillytavern-worldbook.test.ts`
- Modify: `packages/server/tools/verify-sillytavern-import.ts`

- [ ] **Step 1: Add real-file assertions for the provided preset**

Add a test that loads `samples/sillytavern/Izumi 0503.json` and asserts:

```ts
expect(result.preset.name).toContain("Izumi");
expect(result.blocks).toHaveLength(203);
expect(result.blocks.filter((block) => block.enabled)).toHaveLength(52);
expect(result.preset.extensions.regex_scripts).toHaveLength(26);
expect(result.preset.regexScriptsEnabled).toBe(true);
expect(result.blocks.every((block) => typeof block.sourceIdentifier === "string")).toBe(true);
```

- [ ] **Step 2: Add real-file assertions for the provided worldbook**

Add a test that loads `samples/sillytavern/宠物捕捉系统-世界书.json` and asserts:

```ts
expect(entries).toHaveLength(38);
expect(entries.filter((entry) => entry.constant)).toHaveLength(7);
expect(entries.flatMap((entry) => entry.keys)).toHaveLength(320);
expect(entries.every((entry) => entry.metadata.sillytavern)).toBe(true);
expect(entries.some((entry) => entry.metadata.sillytavern.rawEntry)).toBe(true);
```

- [ ] **Step 3: Run RED/GREEN**

Run:

```bash
pnpm --filter @scribe/server test -- sillytavern-preset.test.ts sillytavern-worldbook.test.ts
```

Expected after implementation: PASS and the sample counts match exactly.

## Task 2: Complete Preset Runtime Semantics

**Files:**
- Modify: `packages/shared/src/types/sillytavern-import.ts`
- Modify: `packages/server/src/ai/import/sillytavern-preset.ts`
- Modify: `packages/server/src/ai/presets/render.ts`
- Modify: `packages/server/src/ai/presets/regex-scripts.ts`
- Modify: `packages/server/src/ai/context-builder/builder.ts`
- Modify: `packages/server/tests/unit/ai/presets/regex-scripts.test.ts`
- Modify: `packages/server/tests/unit/ai/context-builder/preset-context.test.ts`

- [ ] **Step 1: Add tests for prompt order as the authority**

Assert that `prompt_order[].order[].enabled` controls runtime enabled blocks, even when `prompts[].enabled` disagrees:

```ts
expect(enabledBlock.sourcePromptEnabled).toBe(false);
expect(enabledBlock.sourceOrderEnabled).toBe(true);
expect(enabledBlock.enabled).toBe(true);
```

- [ ] **Step 2: Add tests for regex placement and safety**

Add cases:

```ts
expect(applySillyTavernRegexScripts("bad", [promptScript], { target: "prompt", depth: 0 }).text).toBe("good");
expect(applySillyTavernRegexScripts("bad", [outputOnlyScript], { target: "prompt", depth: 0 }).text).toBe("bad");
expect(applySillyTavernRegexScripts("bad", [invalidRegexScript], { target: "prompt", depth: 0 }).skipped).toHaveLength(1);
```

- [ ] **Step 3: Implement preset diagnostics**

Extend `buildWriteContext()` result with optional `diagnostics`:

```ts
interface BuildResult {
  messages: CoreMessage[];
  recalledChapterNos: number[];
  recentChapterNos: number[];
  droppedSectionIds: string[];
  usedTokens: number;
  diagnostics?: {
    promptPresetBlockIds: string[];
    promptRegexScriptsApplied: string[];
    worldbookEntryIds: string[];
    readerIssueIds: string[];
  };
}
```

- [ ] **Step 4: Run verification**

Run:

```bash
pnpm --filter @scribe/server test -- preset-context.test.ts regex-scripts.test.ts
pnpm --filter @scribe/server typecheck
```

Expected: PASS, and diagnostics show preset blocks and regex scripts affected the prompt.

## Task 3: Complete Worldbook Retrieval Semantics

**Files:**
- Modify: `packages/shared/src/types/sillytavern-import.ts`
- Modify: `packages/shared/src/types/worldbook.ts`
- Modify: `packages/server/src/ai/import/sillytavern-worldbook.ts`
- Modify: `packages/server/src/ai/worldbook/retrieval.ts`
- Modify: `packages/server/tests/unit/ai/worldbook/sillytavern-retrieval.test.ts`
- Modify: `packages/server/tests/unit/ai/context-builder/worldbook-context.test.ts`

- [ ] **Step 1: Add matching tests**

Cover:

```ts
expect(match("Pet", "pet", { caseSensitive: true })).toBe(false);
expect(match("Pet", "pet", { caseSensitive: false })).toBe(true);
expect(match("pet", "carpet", { wholeWords: true })).toBe(false);
expect(match("pet", "pet捕捉", { wholeWords: true })).toBe(true);
```

- [ ] **Step 2: Add selective-key tests**

Assert that primary plus secondary keys are required when `selective: true` and secondary keys exist:

```ts
expect(selectedIds("捕捉")).not.toContain("selective-entry");
expect(selectedIds("捕捉 状态栏")).toContain("selective-entry");
```

- [ ] **Step 3: Add recursion tests**

Assert:

```ts
expect(result.selected.map((item) => item.reason)).toContain("recursive");
expect(result.selected.find((item) => item.entry.id === "child")?.recursionDepth).toBe(1);
expect(result.selected).not.toContainEqual(expect.objectContaining({ entry: expect.objectContaining({ id: "blocked-by-prevent-recursion" }) }));
```

- [ ] **Step 4: Add probability/group/scan-depth tests**

Use seeded deterministic probability in retrieval options:

```ts
const result = retrieveWorldbookEntries({ entries, query, random: () => 0.9 });
expect(result.dropped.some((item) => item.reason === "probability")).toBe(true);
```

Assert group scoring keeps the highest weighted entry when a group is exclusive.

- [ ] **Step 5: Implement retrieval diagnostics**

Return:

```ts
{
  selected,
  dropped,
  usedTokens,
  diagnostics: [
    { entryId, title, matchedKeys, reason, recursionDepth, decision, notes }
  ]
}
```

- [ ] **Step 6: Run verification**

Run:

```bash
pnpm --filter @scribe/server test -- sillytavern-retrieval.test.ts worldbook-context.test.ts
pnpm --filter @scribe/server typecheck
```

Expected: PASS and preview diagnostics explain every selected or dropped imported entry.

## Task 4: Full Editing APIs

**Files:**
- Modify: `packages/server/src/http/routes/presets.ts`
- Modify: `packages/server/src/http/routes/worldbook.ts`
- Modify: `packages/server/tests/integration/preset-routes.test.ts`
- Modify: `packages/server/tests/integration/worldbook-routes.test.ts`

- [ ] **Step 1: Add preset route tests**

Cover:

```ts
await putPreset({ enabled: false });
await putBlock({ content: "new style", enabled: true, stackIndex: 2 });
await putRegexScript({ scriptName: "replace", disabled: true });
await putGenerationSettings({ temperature: 0.9, top_p: 0.95 });
```

- [ ] **Step 2: Add worldbook route tests**

Cover:

```ts
await putWorldbookEntry({
  keys: ["捕捉"],
  secondaryKeys: ["状态栏"],
  metadata: { sillytavern: { selective: true, probability: 80, scanDepth: 4 } }
});
```

- [ ] **Step 3: Implement route validation**

Accept only known editable fields through shared schemas. Preserve unknown imported SillyTavern source fields under `metadata.sillytavern.rawEntry`.

- [ ] **Step 4: Run verification**

Run:

```bash
pnpm --filter @scribe/server test -- preset-routes.test.ts worldbook-routes.test.ts
pnpm --filter @scribe/server typecheck
```

Expected: PASS and every edited setting survives a reload.

## Task 5: Full Editing UI

**Files:**
- Modify: `packages/client/src/api/client.ts`
- Modify: `packages/client/src/components/import/import-dialog.tsx`
- Modify: `packages/client/src/components/presets/preset-panel.tsx`
- Modify: `packages/client/src/components/worldbook/worldbook-panel.tsx`
- Modify: `packages/client/tests/components/import-dialog.test.tsx`
- Modify: `packages/client/tests/components/preset-panel.test.tsx`
- Modify: `packages/client/tests/components/worldbook-panel.test.tsx`

- [ ] **Step 1: Add UI tests for preset editing**

Assert users can:

```ts
fireEvent.click(screen.getByTestId("preset-enabled-toggle"));
fireEvent.change(screen.getByTestId("prompt-block-content-b1"), { target: { value: "new content" } });
fireEvent.change(screen.getByTestId("prompt-block-stack-b1"), { target: { value: "3" } });
fireEvent.click(screen.getByTestId("regex-script-toggle-r1"));
```

- [ ] **Step 2: Add UI tests for worldbook editing**

Assert users can edit:

```ts
keys;
secondaryKeys;
selective;
caseSensitive;
matchWholeWords;
probability;
scanDepth;
recursive;
recursionLimit;
sticky;
cooldown;
delay;
```

- [ ] **Step 3: Add preview diagnostics UI tests**

Assert preview displays:

```ts
matchedKeys;
reason;
recursionDepth;
decision;
```

- [ ] **Step 4: Implement dense editing UI**

Use existing sidebar style. Keep controls compact:

- toggles for booleans;
- numeric inputs for priority/depth/probability/cooldown;
- text areas for content;
- comma inputs for keys;
- collapsible metadata/debug panels for imported source details.

- [ ] **Step 5: Run verification**

Run:

```bash
pnpm --filter @scribe/client test -- import-dialog.test.tsx preset-panel.test.tsx worldbook-panel.test.tsx
pnpm --filter @scribe/client typecheck
```

Expected: PASS and the UI can edit all runtime-affecting imported fields.

## Task 6: Prove Imported Data Affects Writing

**Files:**
- Modify: `packages/server/src/ai/context-builder/builder.ts`
- Modify: `packages/server/tools/verify-sillytavern-import.ts`
- Modify: `packages/server/tests/unit/ai/context-builder/preset-context.test.ts`
- Modify: `packages/server/tests/unit/ai/context-builder/worldbook-context.test.ts`

- [ ] **Step 1: Add context evidence tests**

Assert:

```ts
expect(result.diagnostics?.promptPresetBlockIds.length).toBeGreaterThan(0);
expect(result.diagnostics?.worldbookEntryIds).toContain("triggered-entry");
expect(joinedPrompt).toContain("better phrase");
expect(joinedPrompt).toContain("Worldbook");
```

- [ ] **Step 2: Update verification tool output**

`verify-sillytavern-import.ts` must print:

```json
{
  "presetCount": 1,
  "promptBlockCount": 203,
  "enabledPromptBlockCount": 52,
  "regexScriptCount": 26,
  "regexScriptsApplied": true,
  "worldbookEntryCount": 38,
  "constantWorldbookCount": 7,
  "worldbookTriggered": true,
  "contextContainsPreset": true,
  "contextContainsWorldbook": true
}
```

- [ ] **Step 3: Run real sample verification**

Run:

```bash
pnpm --filter @scribe/server exec tsx tools/verify-sillytavern-import.ts "samples/sillytavern/Izumi 0503.json" "samples/sillytavern/宠物捕捉系统-世界书.json"
```

Expected: all booleans are `true` and counts match the source files.

## Task 7: 15 Chapter Reader-Quality Monitor

**Files:**
- Create: `packages/server/tools/monitor-sillytavern-longform.ts`
- Modify: `packages/server/src/ai/orchestrator/write-with-audit.ts`
- Modify: `packages/server/src/ai/orchestrator/audit-persist.ts`

- [ ] **Step 1: Create monitor acceptance contract**

The monitor creates a fresh book, imports both real files, generates 15 chapters through the real write flow, and writes:

```json
{
  "chapterCount": 15,
  "presetInjectedChapters": [1],
  "worldbookTriggeredChapters": [1],
  "readerIssueCount": 0,
  "readerIssueInjectionCount": 0,
  "continuityFailures": [],
  "styleDriftFailures": [],
  "reportPath": "reports/live-runs/sillytavern-longform-<timestamp>.json"
}
```

- [ ] **Step 2: Fail on quality and continuity breaks**

Exit non-zero when:

- fewer than 15 chapters are produced;
- any chapter lacks imported preset context;
- no worldbook entry triggers across the whole run;
- an unresolved reader issue is created but never injected into a later chapter context;
- a named character, location, ability, item, or core rule changes without an explicit explanation;
- the chapter summary contradicts the written chapter body.

- [ ] **Step 3: Simulate reader control**

Between chapters, the monitor should issue human-like instructions:

```ts
[
  "继续，但别急着解释系统全貌，先让主角在压力下做选择。",
  "上一章的状态栏和捕捉规则要延续，不要换设定。",
  "让一个世界书里的核心设定自然进入剧情，不要像百科。",
  "检查前文伏笔，推进一个但不要回收全部。"
]
```

- [ ] **Step 4: Produce report**

Report each chapter with:

```json
{
  "chapterNo": 1,
  "wordCount": 0,
  "presetBlockIds": [],
  "regexScriptsApplied": [],
  "worldbookEntries": [],
  "readerIssuesBefore": [],
  "readerIssuesAfter": [],
  "continuityNotes": [],
  "styleNotes": []
}
```

- [ ] **Step 5: Run monitor**

Run:

```bash
pnpm --filter @scribe/server exec tsx tools/monitor-sillytavern-longform.ts "samples/sillytavern/Izumi 0503.json" "samples/sillytavern/宠物捕捉系统-世界书.json"
```

Expected: PASS with a report path and no fatal continuity failures.

## Task 8: Final Regression And Launch

**Files:**
- No new files unless tests expose a focused fix.

- [ ] **Step 1: Run focused verification**

Run:

```bash
pnpm --filter @scribe/shared test -- sillytavern-import.test.ts
pnpm --filter @scribe/server test -- sillytavern-detect.test.ts sillytavern-preset.test.ts sillytavern-worldbook.test.ts import-routes.test.ts preset-routes.test.ts worldbook-routes.test.ts macros.test.ts regex-scripts.test.ts render.test.ts preset-context.test.ts worldbook-context.test.ts reader-issues-context.test.ts sillytavern-retrieval.test.ts audit-reader-issues.test.ts
pnpm --filter @scribe/client test -- import-dialog.test.tsx preset-panel.test.tsx worldbook-panel.test.tsx
pnpm --filter @scribe/server typecheck
pnpm --filter @scribe/client typecheck
```

Expected: all PASS.

- [ ] **Step 2: Run broad regression**

Run:

```bash
pnpm --filter @scribe/server test
pnpm --filter @scribe/client test
pnpm -r exec tsc --noEmit
```

Expected: all PASS.

- [ ] **Step 3: Start the app for manual review**

Run the existing dev command from `package.json`. If the default port is occupied, use the next open port.

Expected: user can import the two provided JSON files, edit preset/worldbook settings, preview worldbook triggers, and start a writing run where diagnostics show imported settings affected the prompt.

## Done Criteria

- The two provided files import with exact counts:
  - preset: 203 prompt blocks, 52 enabled runtime blocks, 26 regex scripts;
  - worldbook: 38 entries, 7 constant entries, 320 primary trigger keys.
- Preset prompt order, macro expansion, regex scripts, block editing, and generation settings are all represented and editable.
- Worldbook matching supports case sensitivity, whole-word matching, selective keys, probability, scan depth, recursion controls, grouping, sticky/cooldown/delay, and trigger diagnostics.
- Import preserves unknown fields under raw metadata instead of discarding them.
- Writing context diagnostics prove preset blocks, regex scripts, worldbook entries, and reader issues entered the chapter prompt.
- A 15 chapter monitor runs against a fresh book and fails on reader-visible continuity breaks.
- UI can freely edit all runtime-affecting imported preset/worldbook fields.
- Server/client focused tests, typechecks, real sample verification, and long-form monitor pass.

## Self-Review

Spec coverage:

- SillyTavern preset import, editability, regex behavior, and writing impact are covered by Tasks 1, 2, 4, 5, and 6.
- SillyTavern worldbook import, editability, trigger semantics, recursion, and diagnostics are covered by Tasks 1, 3, 4, 5, and 6.
- Long-form continuity and writing quality are covered by Task 7.
- Final user-visible launch verification is covered by Task 8.

Placeholder scan:

- The plan has no deferred requirements. Every major requirement has tests, implementation files, commands, and expected outcomes.

Type consistency:

- Runtime names remain consistent: `PromptPreset`, `PromptBlock`, `WorldbookEntry`, `SillyTavernRegexScript`, `BuildResult.diagnostics`, and retrieval `diagnostics`.
