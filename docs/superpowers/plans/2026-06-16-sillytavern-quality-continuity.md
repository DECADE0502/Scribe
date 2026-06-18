# SillyTavern Quality Continuity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fully support SillyTavern preset/worldbook import, editing, runtime influence, and long-form continuity, with reader-visible writing quality proven by a clean 15 chapter live run.

**Architecture:** Keep SillyTavern compatibility as three separate layers: preserved import artifacts, editable normalized runtime models, and enforced writing-time context. Move quality enforcement ahead of UI polish: every chapter generation must inject preset/worldbook/reader memory, audit with the same context, repair critical failures, and stop if a reader-visible continuity/style break remains. Only after this loop is reliable should the remaining SillyTavern knobs be exposed through APIs and UI.

**Tech Stack:** TypeScript, Vitest, Hono, SQLite/better-sqlite3, Vercel AI SDK `CoreMessage`, React, Testing Library, existing Scribe book registry, prompt preset, worldbook, audit, repair, and monitor flows.

---

## Current Diagnosis

The latest live monitor proved import/runtime influence is partly working:

- preset injected in 15/15 chapters;
- prompt regex applied in 15/15 chapters;
- worldbook triggered in 15/15 chapters;
- reader issues injected after they were created.

The goal is still not met because the generated novel failed as prose:

- chapters 9, 11, 12, 13, 14, and 15 had critical audit verdicts;
- non-novel AI chat logs, event frames, and progress labels leaked into正文;
- preset-required status sections were omitted or drifted;
- countdown/deadline state contradicted earlier chapters;
- injected reader issues did not stop repeat violations.

Therefore the first implementation priority is not more import plumbing. It is a hard quality loop: detect, repair, re-audit, and stop before bad chapters become later continuity debt.

## File Structure

- Modify `packages/server/src/ai/monitor/sillytavern-longform-monitor.ts`: expand evidence types, verdict rules, and helper predicates for repair/quality gates.
- Modify `packages/server/tools/monitor-sillytavern-longform.ts`: enable critical repair, capture repair verdicts, stop on unresolved critical chapters, and report final saved text evidence.
- Modify `packages/server/src/ai/orchestrator/write-with-audit.ts`: make repair outcomes machine-readable and expose the final verdict to callers.
- Modify `packages/server/src/ai/prompts/write-chapter.ts`: add generic no-meta-output and required-format enforcement rules without sample-specific wording.
- Modify `packages/server/src/ai/prompts/repair-chapter.ts`: make repair remove meta-output, restore required sections, and preserve story continuity.
- Modify `packages/server/src/ai/context-builder/book-context.ts`: strengthen hard continuity constraints for status bars, timers, resources, contracts, and deadlines.
- Modify `packages/server/src/ai/worldbook/retrieval.ts`: finish SillyTavern retrieval semantics after the quality loop is stable.
- Modify `packages/shared/src/types/sillytavern-import.ts`: preserve and type runtime-affecting preset/worldbook fields.
- Modify `packages/shared/src/types/worldbook.ts`: expose editable SillyTavern controls.
- Modify `packages/server/src/http/routes/presets.ts`: add full preset edit APIs.
- Modify `packages/server/src/http/routes/worldbook.ts`: add full worldbook edit APIs and trigger preview.
- Modify `packages/client/src/api/client.ts`: add client methods for advanced preset/worldbook edit and diagnostics.
- Modify `packages/client/src/components/presets/preset-panel.tsx`: expose preset stack, regex, and generation setting controls.
- Modify `packages/client/src/components/worldbook/worldbook-panel.tsx`: expose SillyTavern matching, recursion, depth, probability, sticky/cooldown/delay controls.
- Test `packages/server/tests/unit/ai/monitor/sillytavern-longform-monitor.test.ts`.
- Test `packages/server/tests/unit/ai/orchestrator/write-with-audit.test.ts`.
- Test `packages/server/tests/unit/ai/prompts/write-chapter.test.ts`.
- Test `packages/server/tests/unit/ai/prompts/repair-chapter.test.ts`.
- Test `packages/server/tests/unit/ai/context-builder/book-context.test.ts`.
- Test `packages/server/tests/unit/ai/worldbook/sillytavern-retrieval.test.ts`.
- Test `packages/server/tests/integration/preset-routes.test.ts`.
- Test `packages/server/tests/integration/worldbook-routes.test.ts`.
- Test `packages/client/tests/components/preset-panel.test.tsx`.
- Test `packages/client/tests/components/worldbook-panel.test.tsx`.

## Task 1: Make Critical Failures Non-Continuable

**Files:**
- Modify: `packages/server/src/ai/monitor/sillytavern-longform-monitor.ts`
- Modify: `packages/server/tools/monitor-sillytavern-longform.ts`
- Test: `packages/server/tests/unit/ai/monitor/sillytavern-longform-monitor.test.ts`

- [ ] **Step 1: Write failing verdict tests for unresolved critical chapters**

Add tests:

```ts
test("fails immediately when a critical chapter remains unrepaired", () => {
  const verdict = buildSillyTavernLongformVerdict({
    expectedChapterCount: 15,
    live: true,
    readerIssueCreated: false,
    reports: [{
      chapterNo: 9,
      wordCount: 1800,
      presetBlockCount: 52,
      regexScriptsApplied: ["cleanup"],
      worldbookEntryCount: 8,
      readerIssueIds: [],
      containsWorldbook: true,
      continuityNotes: [],
      styleNotes: [],
      auditVerdict: "critical",
      repairAttempted: true,
      repairVerdict: "critical",
    }],
  });

  expect(verdict.passed).toBe(false);
  expect(verdict.failureReasons).toContain("chapter 9: unresolved critical after repair");
});

test("does not fail a repaired critical chapter when re-audit is ok", () => {
  const reports = Array.from({ length: 15 }, (_, index) => ({
    chapterNo: index + 1,
    wordCount: 1800,
    presetBlockCount: 52,
    regexScriptsApplied: ["cleanup"],
    worldbookEntryCount: 8,
    readerIssueIds: index > 4 ? ["issue-1"] : [],
    containsWorldbook: true,
    continuityNotes: [],
    styleNotes: [],
    auditVerdict: index === 8 ? "critical" : "ok",
    repairAttempted: index === 8,
    repairVerdict: index === 8 ? "ok" : undefined,
  }));

  const verdict = buildSillyTavernLongformVerdict({
    expectedChapterCount: 15,
    live: true,
    readerIssueCreated: true,
    reports,
  });

  expect(verdict.failureReasons).not.toContain("chapter 9: audit verdict critical");
  expect(verdict.failureReasons).not.toContain("chapter 9: unresolved critical after repair");
});
```

- [ ] **Step 2: Extend monitor evidence types**

Add fields:

```ts
export interface SillyTavernMonitorChapterEvidence {
  chapterNo: number;
  wordCount: number;
  presetBlockCount: number;
  regexScriptsApplied: string[];
  worldbookEntryCount: number;
  readerIssueIds: string[];
  hardContinuityPresent?: boolean;
  hardContinuitySnippets?: string[];
  readerIssueSnippets?: string[];
  containsWorldbook: boolean;
  continuityNotes: string[];
  styleNotes: string[];
  auditVerdict?: string;
  repairAttempted?: boolean;
  repairVerdict?: string;
  repairStillCritical?: boolean;
  stoppedAfterChapter?: boolean;
}
```

- [ ] **Step 3: Implement verdict semantics**

Update `buildSillyTavernLongformVerdict()` so:

```ts
for (const report of input.reports) {
  if (report.auditVerdict === "critical" && !report.repairAttempted) {
    failureReasons.push(`chapter ${report.chapterNo}: critical without repair attempt`);
  }
  if (report.repairAttempted && report.repairVerdict === "critical") {
    failureReasons.push(`chapter ${report.chapterNo}: unresolved critical after repair`);
  }
}
```

Keep existing failures for missing imports, missing worldbook, missing reader issue injection, style notes, and continuity notes.

- [ ] **Step 4: Enable repair in the live monitor**

In `runLiveChapter()` change:

```ts
enableRepair: false,
```

to:

```ts
enableRepair: true,
```

Capture events:

```ts
let repairAttempted = false;
let repairVerdict: string | undefined;
let repairStillCritical: boolean | undefined;

if (ev.type === "tool_call_start" && ev.toolName === "chapter_repair") {
  repairAttempted = true;
}
if (ev.type === "tool_call_end" && ev.toolName === "chapter_repair_audit") {
  const result = ev.result as { verdict?: unknown; stillCritical?: unknown };
  repairVerdict = String(result.verdict ?? "");
  repairStillCritical = Boolean(result.stillCritical);
}
```

Put these fields into `ChapterMonitorReport`.

- [ ] **Step 5: Stop monitor after unresolved critical**

In `runLiveMonitor()` after pushing a report:

```ts
if (
  report.auditVerdict === "critical" &&
  (!report.repairAttempted || report.repairVerdict === "critical" || report.repairStillCritical)
) {
  report.stoppedAfterChapter = true;
  input.onProgress?.(reports);
  break;
}
```

This prevents chapters 10-15 from compounding a broken chapter 9.

- [ ] **Step 6: Run focused tests**

Run:

```bash
pnpm --filter @scribe/server test -- sillytavern-longform-monitor.test.ts
pnpm --filter @scribe/server typecheck
```

Expected: tests pass, and live monitor reports repair fields.

## Task 2: Add Generic Prose-Quality Gates For Meta-Output Leakage

**Files:**
- Modify: `packages/server/src/ai/monitor/sillytavern-longform-monitor.ts`
- Modify: `packages/server/src/ai/prompts/write-chapter.ts`
- Modify: `packages/server/src/ai/prompts/repair-chapter.ts`
- Test: `packages/server/tests/unit/ai/monitor/sillytavern-longform-monitor.test.ts`
- Test: `packages/server/tests/unit/ai/prompts/write-chapter.test.ts`
- Test: `packages/server/tests/unit/ai/prompts/repair-chapter.test.ts`

- [ ] **Step 1: Write detector tests**

Add:

```ts
test("detects non-novel meta output labels", () => {
  expect(detectMetaOutputLeakage("【进度】任务完成\n正文继续")).toContain("progress label");
  expect(detectMetaOutputLeakage("AI：我会继续写这一章")).toContain("ai chat log");
  expect(detectMetaOutputLeakage("事件：捕捉成功")).toContain("event frame");
  expect(detectMetaOutputLeakage("他看见系统提示：捕捉成功。")).toEqual([]);
});
```

- [ ] **Step 2: Implement generic detector**

Export from `sillytavern-longform-monitor.ts`:

```ts
export function detectMetaOutputLeakage(text: string): string[] {
  const issues: string[] = [];
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.some((line) => /^【?(进度|任务|完成|事件|日志|指令|输出|章节目标)】?[:：]/.test(line))) {
    issues.push("progress label");
  }
  if (lines.some((line) => /^(AI|Assistant|User|System|模型|作者|旁白)[:：]/i.test(line))) {
    issues.push("ai chat log");
  }
  if (lines.some((line) => /^(事件|判定|检定|回合|阶段|状态更新)[:：]/.test(line))) {
    issues.push("event frame");
  }
  return [...new Set(issues)];
}
```

Do not ban diegetic in-story system messages such as `他看见系统提示：...`.

- [ ] **Step 3: Feed detector into monitor style notes**

After final chapter text is available:

```ts
for (const issue of detectMetaOutputLeakage(finalText)) {
  report.styleNotes.push(`meta output leakage: ${issue}`);
}
```

- [ ] **Step 4: Strengthen write prompt**

In the chapter writing prompt, add a generic hard rule:

```ts
const NO_META_OUTPUT_RULE = `
正文只能是小说正文。不要输出聊天记录、执行日志、进度标签、任务总结、事件卡片、调试说明、写作计划或对用户的解释。
如果世界观中存在系统面板、状态栏或提示音，它们必须作为角色在故事里看见/听见的内容出现，不能作为作者或模型的场外标签出现。
`;
```

Insert it near the final task instruction so imported presets cannot accidentally override it.

- [ ] **Step 5: Strengthen repair prompt**

In `repair-chapter.ts`, add:

```ts
修复时必须删除所有非小说正文的元文本，包括聊天记录、进度标签、事件卡片、任务总结、模型说明和调试说明。保留角色在剧情中看到的系统面板或状态栏，但要把它写成故事内的呈现。
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
pnpm --filter @scribe/server test -- sillytavern-longform-monitor.test.ts write-chapter.test.ts repair-chapter.test.ts
pnpm --filter @scribe/server typecheck
```

Expected: detector only flags non-diegetic meta labels, and prompts contain the new hard rules.

## Task 3: Enforce Required Runtime Sections From Imported Presets

**Files:**
- Modify: `packages/server/src/ai/context-builder/book-context.ts`
- Modify: `packages/server/src/ai/prompts/write-chapter.ts`
- Modify: `packages/server/src/ai/prompts/repair-chapter.ts`
- Test: `packages/server/tests/unit/ai/context-builder/book-context.test.ts`
- Test: `packages/server/tests/unit/ai/monitor/sillytavern-longform-monitor.test.ts`

- [ ] **Step 1: Write tests for required status-section extraction**

Add:

```ts
test("extracts status bar requirements from imported preset blocks", () => {
  const constraints = extractRequiredOutputSections([
    { content: "每章结尾必须输出状态栏，包含HP、SP、契约、捕捉球数量。" },
    { content: "普通叙事要求。" },
  ]);

  expect(constraints).toContainEqual(expect.objectContaining({
    kind: "status_section",
    requiredTerms: expect.arrayContaining(["HP", "SP", "契约", "捕捉球"]),
  }));
});
```

- [ ] **Step 2: Implement preset-derived required section helper**

In `book-context.ts`:

```ts
export interface RequiredOutputSection {
  kind: "status_section";
  label: string;
  requiredTerms: string[];
  source: "preset" | "worldbook" | "scribe";
}

export function extractRequiredOutputSections(
  blocks: Array<{ content: string }>,
): RequiredOutputSection[] {
  const joined = blocks.map((block) => block.content).join("\n");
  if (!/(状态栏|狀態欄|status\s*bar|面板)/i.test(joined)) return [];
  const terms = ["HP", "SP", "MP", "契约", "捕捉球", "等级", "时间", "倒计时"]
    .filter((term) => joined.includes(term) || new RegExp(term, "i").test(joined));
  return [{
    kind: "status_section",
    label: "状态栏",
    requiredTerms: terms.length ? terms : ["状态栏"],
    source: "preset",
  }];
}
```

- [ ] **Step 3: Inject required sections into writing context**

Render a block:

```md
## Required Output Sections
- 状态栏 is required by imported preset. It must appear in the chapter as diegetic novel text and include: HP, SP, 契约, 捕捉球.
```

Place it after preset/worldbook context and before the chapter task.

- [ ] **Step 4: Check generated chapters for missing sections**

Add helper:

```ts
export function detectMissingRequiredSections(
  text: string,
  sections: RequiredOutputSection[],
): string[] {
  return sections
    .filter((section) => section.kind === "status_section")
    .filter((section) => !section.requiredTerms.every((term) => text.includes(term)))
    .map((section) => `${section.label} missing required terms: ${section.requiredTerms.join(", ")}`);
}
```

The monitor adds each missing section to `styleNotes`.

- [ ] **Step 5: Run focused tests**

Run:

```bash
pnpm --filter @scribe/server test -- book-context.test.ts sillytavern-longform-monitor.test.ts
pnpm --filter @scribe/server typecheck
```

Expected: status-section requirements are derived generically from imported prompts, injected before writing, and checked after writing.

## Task 4: Strengthen Hard Continuity For Timers, Resources, And Contracts

**Files:**
- Modify: `packages/server/src/ai/context-builder/book-context.ts`
- Test: `packages/server/tests/unit/ai/context-builder/book-context.test.ts`
- Test: `packages/server/tests/unit/ai/context-builder/audit-worldbook-context.test.ts`

- [ ] **Step 1: Write timer/resource continuity tests**

Add:

```ts
test("renders deadlines and resource counts as hard continuity constraints", () => {
  const text = renderHardContinuityConstraints([
    { chapterNo: 8, summary: "阵营选择将在48小时后强制触发，普通捕捉球已经用尽。" },
    { chapterNo: 9, summary: "距离阵营选择还剩约36小时，获得1枚高级捕捉球。" },
  ]);

  expect(text).toContain("48小时");
  expect(text).toContain("36小时");
  expect(text).toContain("普通捕捉球已经用尽");
  expect(text).toContain("高级捕捉球");
});
```

- [ ] **Step 2: Replace the unused broken regex block**

Remove the legacy mojibake `HARD_CONTINUITY_PATTERNS` if it is no longer used. Keep a simple term-based extractor:

```ts
const HARD_STATE_TERMS = [
  "HP", "SP", "MP", "状态栏", "面板", "倒计时", "小时", "天后",
  "捕捉球", "高级球", "普通球", "契约", "服从度", "好感度",
  "冷却", "库存", "数量", "剩余", "用尽", "获得",
];
```

- [ ] **Step 3: Add contradiction-sensitive language to the block**

Render:

```md
## Hard Continuity Constraints
These are not optional flavor. Do not change quantities, timers, contracts, inventory, cooldowns, HP/SP/MP, obedience, or remaining deadlines unless the chapter explicitly shows the cause.
```

- [ ] **Step 4: Ensure audit sees the same hard constraints**

`buildChapterAuditContext()` must include the same hard continuity block as writing. Tests should assert:

```ts
expect(result.auditCtx.hardContinuityContext).toContain("Hard Continuity Constraints");
expect(result.auditCtx.hardContinuityContext).toContain("捕捉球");
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
pnpm --filter @scribe/server test -- book-context.test.ts audit-worldbook-context.test.ts
pnpm --filter @scribe/server typecheck
```

Expected: hard state is visible to both writer and auditor.

## Task 5: Finish SillyTavern Worldbook Runtime Semantics

**Files:**
- Modify: `packages/shared/src/types/sillytavern-import.ts`
- Modify: `packages/shared/src/types/worldbook.ts`
- Modify: `packages/server/src/ai/import/sillytavern-worldbook.ts`
- Modify: `packages/server/src/ai/worldbook/retrieval.ts`
- Test: `packages/server/tests/unit/ai/worldbook/sillytavern-retrieval.test.ts`
- Test: `packages/server/tests/unit/ai/context-builder/worldbook-context.test.ts`

- [ ] **Step 1: Write matching tests**

Add cases:

```ts
expect(matchWorldbookKey("Pet", "pet", { caseSensitive: true })).toBe(false);
expect(matchWorldbookKey("Pet", "pet", { caseSensitive: false })).toBe(true);
expect(matchWorldbookKey("pet", "carpet", { matchWholeWords: true })).toBe(false);
expect(matchWorldbookKey("捕捉", "开始捕捉宠物", { matchWholeWords: true })).toBe(true);
```

- [ ] **Step 2: Write selective key tests**

```ts
expect(selectedIds("捕捉")).not.toContain("selective-entry");
expect(selectedIds("捕捉 状态栏")).toContain("selective-entry");
```

- [ ] **Step 3: Write recursion tests**

```ts
expect(result.selected.map((item) => item.reason)).toContain("recursive");
expect(result.selected.find((item) => item.entry.id === "child")?.recursionDepth).toBe(1);
expect(result.selected.map((item) => item.entry.id)).not.toContain("prevent-recursion");
```

- [ ] **Step 4: Write probability/group/scan-depth tests**

```ts
const probabilityResult = retrieveWorldbookEntries({
  entries,
  query,
  random: () => 0.9,
});
expect(probabilityResult.dropped.some((item) => item.reason === "probability")).toBe(true);

const groupResult = retrieveWorldbookEntries({ entries: groupedEntries, query, random: () => 0.1 });
expect(groupResult.selected.map((item) => item.entry.id)).toEqual(["highest-weight"]);
```

- [ ] **Step 5: Implement diagnostics**

Return every selected/dropped decision:

```ts
{
  selected,
  dropped,
  diagnostics: [{
    entryId,
    title,
    matchedKeys,
    decision: "selected" | "dropped",
    reason,
    recursionDepth,
    notes,
  }],
}
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
pnpm --filter @scribe/server test -- sillytavern-retrieval.test.ts worldbook-context.test.ts
pnpm --filter @scribe/server typecheck
```

Expected: retrieval follows SillyTavern semantics and explains every decision.

## Task 6: Complete Preset Runtime Semantics

**Files:**
- Modify: `packages/shared/src/types/sillytavern-import.ts`
- Modify: `packages/server/src/ai/import/sillytavern-preset.ts`
- Modify: `packages/server/src/ai/presets/render.ts`
- Modify: `packages/server/src/ai/presets/regex-scripts.ts`
- Modify: `packages/server/src/ai/context-builder/builder.ts`
- Test: `packages/server/tests/unit/ai/import/sillytavern-preset.test.ts`
- Test: `packages/server/tests/unit/ai/presets/regex-scripts.test.ts`
- Test: `packages/server/tests/unit/ai/context-builder/preset-context.test.ts`

- [ ] **Step 1: Assert prompt order is authoritative**

```ts
expect(enabledBlock.sourcePromptEnabled).toBe(false);
expect(enabledBlock.sourceOrderEnabled).toBe(true);
expect(enabledBlock.enabled).toBe(true);
```

- [ ] **Step 2: Assert regex placement and invalid regex safety**

```ts
expect(applySillyTavernRegexScripts("bad", [promptScript], { target: "prompt", depth: 0 }).text).toBe("good");
expect(applySillyTavernRegexScripts("bad", [outputOnlyScript], { target: "prompt", depth: 0 }).text).toBe("bad");
expect(applySillyTavernRegexScripts("bad", [invalidRegexScript], { target: "prompt", depth: 0 }).skipped).toHaveLength(1);
```

- [ ] **Step 3: Preserve generation settings**

The importer must preserve:

```ts
[
  "temperature",
  "top_p",
  "top_k",
  "top_a",
  "min_p",
  "repetition_penalty",
  "openai_max_context",
  "openai_max_tokens",
  "reasoning_effort",
  "verbosity",
]
```

Unsupported settings stay in raw extension metadata.

- [ ] **Step 4: Emit prompt diagnostics**

`buildWriteContext()` diagnostics must include:

```ts
{
  promptPresetBlockIds: string[];
  promptRegexScriptsApplied: string[];
  worldbookEntryIds: string[];
  readerIssueIds: string[];
}
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
pnpm --filter @scribe/server test -- sillytavern-preset.test.ts regex-scripts.test.ts preset-context.test.ts
pnpm --filter @scribe/server typecheck
```

Expected: prompt stack order, regex behavior, generation settings, and diagnostics are stable.

## Task 7: Complete Editing APIs

**Files:**
- Modify: `packages/shared/src/types/worldbook.ts`
- Modify: `packages/server/src/http/routes/presets.ts`
- Modify: `packages/server/src/http/routes/worldbook.ts`
- Test: `packages/server/tests/integration/preset-routes.test.ts`
- Test: `packages/server/tests/integration/worldbook-routes.test.ts`

- [ ] **Step 1: Add preset route tests**

```ts
await putPreset({ enabled: false });
await putBlock({ content: "new style", enabled: true, stackIndex: 2 });
await putRegexScript({ scriptName: "replace", disabled: true, promptOnly: true });
await putGenerationSettings({ temperature: 0.9, top_p: 0.95 });
```

Assert every edited value survives a reload.

- [ ] **Step 2: Add worldbook route tests**

```ts
await putWorldbookEntry({
  keys: ["捕捉"],
  secondaryKeys: ["状态栏"],
  constant: false,
  recursive: true,
  recursionLimit: 2,
  priority: 100,
  insertionDepth: 4,
  metadata: {
    sillytavern: {
      selective: true,
      caseSensitive: false,
      matchWholeWords: true,
      probability: 80,
      useProbability: true,
      scanDepth: 4,
      group: "rules",
      groupWeight: 10,
      sticky: 2,
      cooldown: 1,
      delay: 0,
    },
  },
});
```

- [ ] **Step 3: Implement strict editable schemas**

Accept known runtime-affecting fields. Preserve unknown imported fields under:

```ts
metadata.sillytavern.rawEntry
```

- [ ] **Step 4: Add trigger preview route**

`POST /api/books/:bookId/worldbook/preview` should accept:

```ts
{ query: string; chapterNo?: number }
```

and return retrieval diagnostics.

- [ ] **Step 5: Run focused tests**

Run:

```bash
pnpm --filter @scribe/server test -- preset-routes.test.ts worldbook-routes.test.ts
pnpm --filter @scribe/server typecheck
```

Expected: users can freely tune imported preset/worldbook runtime behavior through APIs.

## Task 8: Complete Editing UI

**Files:**
- Modify: `packages/client/src/api/client.ts`
- Modify: `packages/client/src/components/presets/preset-panel.tsx`
- Modify: `packages/client/src/components/worldbook/worldbook-panel.tsx`
- Modify: `packages/client/tests/components/preset-panel.test.tsx`
- Modify: `packages/client/tests/components/worldbook-panel.test.tsx`

- [ ] **Step 1: Add preset editing UI tests**

```ts
fireEvent.click(screen.getByTestId("preset-enabled-toggle"));
fireEvent.change(screen.getByTestId("prompt-block-content-b1"), { target: { value: "new content" } });
fireEvent.change(screen.getByTestId("prompt-block-stack-b1"), { target: { value: "3" } });
fireEvent.click(screen.getByTestId("regex-script-toggle-r1"));
fireEvent.change(screen.getByTestId("generation-temperature"), { target: { value: "0.9" } });
```

- [ ] **Step 2: Add worldbook editing UI tests**

```ts
fireEvent.change(screen.getByTestId("worldbook-keys-e1"), { target: { value: "捕捉,状态栏" } });
fireEvent.click(screen.getByTestId("worldbook-selective-e1"));
fireEvent.click(screen.getByTestId("worldbook-case-sensitive-e1"));
fireEvent.click(screen.getByTestId("worldbook-whole-words-e1"));
fireEvent.change(screen.getByTestId("worldbook-probability-e1"), { target: { value: "80" } });
fireEvent.change(screen.getByTestId("worldbook-scan-depth-e1"), { target: { value: "4" } });
fireEvent.change(screen.getByTestId("worldbook-recursion-limit-e1"), { target: { value: "2" } });
fireEvent.change(screen.getByTestId("worldbook-cooldown-e1"), { target: { value: "1" } });
```

- [ ] **Step 3: Add preview diagnostics UI tests**

Assert the UI renders:

```ts
matchedKeys;
decision;
reason;
recursionDepth;
```

- [ ] **Step 4: Implement compact controls**

Use existing panel style:

- toggles for boolean fields;
- numeric inputs for priority, depth, probability, sticky, cooldown, delay;
- text areas for content;
- comma-separated inputs for keys and secondary keys;
- collapsible raw metadata/debug sections;
- preview button for retrieval diagnostics.

- [ ] **Step 5: Run focused tests**

Run:

```bash
pnpm --filter @scribe/client test -- preset-panel.test.tsx worldbook-panel.test.tsx
pnpm --filter @scribe/client typecheck
```

Expected: imported settings are freely editable in the app.

## Task 9: Clean 15 Chapter Live Acceptance Run

**Files:**
- Modify only files exposed by the run.

- [ ] **Step 1: Run import/context verification**

Run:

```bash
pnpm --filter @scribe/server exec tsx tools/verify-sillytavern-import.ts "samples/sillytavern/Izumi 0503.json" "samples/sillytavern/宠物捕捉系统-世界书.json"
```

Expected:

```json
{
  "promptBlockCount": 203,
  "enabledPromptBlockCount": 52,
  "regexScriptCount": 26,
  "worldbookEntryCount": 38,
  "constantWorldbookCount": 7,
  "worldbookTriggered": true,
  "contextContainsPreset": true,
  "contextContainsWorldbook": true
}
```

- [ ] **Step 2: Delete prior generated test novels only if the user asks again**

Do not remove user files by default. For fresh proof, the monitor should create a new book automatically.

- [ ] **Step 3: Run a fresh 15 chapter live monitor**

Run:

```bash
pnpm --filter @scribe/server exec tsx tools/monitor-sillytavern-longform.ts --live --chapters 15 --chapter-timeout-ms 420000 "samples/sillytavern/Izumi 0503.json" "samples/sillytavern/宠物捕捉系统-世界书.json"
```

Expected:

- 15 chapters generated;
- preset injected in every chapter;
- regex applied in at least one chapter and reported;
- worldbook triggered in every chapter or enough chapters to prove retrieval;
- reader issues injected after creation;
- no unresolved critical after repair;
- no meta-output leakage;
- required status section present when the preset requires it;
- timer/resource/contract changes have explicit causes.

- [ ] **Step 4: Inspect report as a reader**

Open the generated report and check:

```ts
expect(report.verdict.passed).toBe(true);
expect(report.verdict.failureReasons).toEqual([]);
expect(report.reports.some((chapter) => chapter.repairAttempted)).toBe(true); // allowed but not required
expect(report.reports.every((chapter) => chapter.presetBlockCount > 0)).toBe(true);
expect(report.reports.every((chapter) => chapter.worldbookEntryCount > 0)).toBe(true);
```

Then manually skim chapters 1, 5, 10, and 15 for story continuity, not only JSON flags.

## Task 10: Final Regression And App Launch

**Files:**
- No new files unless tests expose focused defects.

- [ ] **Step 1: Run server focused tests**

Run:

```bash
pnpm --filter @scribe/server test -- audit-chapter.test.ts audit-worldbook-context.test.ts book-context.test.ts sillytavern-longform-monitor.test.ts sillytavern-retrieval.test.ts sillytavern-preset.test.ts sillytavern-worldbook.test.ts regex-scripts.test.ts preset-routes.test.ts worldbook-routes.test.ts write-then-audit.test.ts
pnpm --filter @scribe/server typecheck
```

Expected: all pass.

- [ ] **Step 2: Run client focused tests**

Run:

```bash
pnpm --filter @scribe/client test -- import-dialog.test.tsx preset-panel.test.tsx worldbook-panel.test.tsx
pnpm --filter @scribe/client typecheck
```

Expected: all pass.

- [ ] **Step 3: Run broad regression**

Run:

```bash
pnpm --filter @scribe/server test
pnpm --filter @scribe/client test
pnpm -r exec tsc --noEmit
```

Expected: all pass, or any unrelated pre-existing failures are documented with exact commands and failing tests.

- [ ] **Step 4: Start the app**

Run the repo dev command from `package.json`. Verify:

- backend health endpoint responds;
- frontend opens;
- user can import the two sample JSON files;
- user can edit preset and worldbook controls;
- trigger preview explains why entries match;
- a writing run shows preset/worldbook/reader-memory diagnostics.

## Done Criteria

- The sample preset imports as 203 prompt blocks, 52 enabled runtime blocks, and 26 regex scripts.
- The sample worldbook imports as 38 entries, 7 constant entries, and 320 primary trigger keys.
- Unknown SillyTavern fields are preserved instead of discarded.
- Prompt order, macros, regex scripts, generation settings, and block enablement are editable and affect writing context.
- Worldbook case sensitivity, whole-word matching, selective keys, probability, scan depth, grouping, recursion, sticky, cooldown, delay, priority, and insertion depth are editable and affect retrieval.
- Writing diagnostics prove preset blocks, regex scripts, worldbook entries, hard continuity, and reader issues entered the prompt.
- Audit diagnostics prove the auditor sees worldbook, reader issues, and hard continuity.
- Critical chapters trigger repair, re-audit, and stop the run if still critical.
- Meta-output leakage is detected and treated as a style failure.
- Preset-required status sections are injected, checked, and repaired if missing.
- Timer/resource/contract changes are constrained by prior chapter facts.
- A fresh 15 chapter live run passes with no unresolved critical continuity/style failures.
- The UI supports free editing of runtime-affecting preset/worldbook fields.
- No logic is hardcoded to the provided pet-capture novel.

## Self-Review

Spec coverage:

- Full SillyTavern preset compatibility is covered by Tasks 6, 7, and 8.
- Full SillyTavern worldbook compatibility is covered by Tasks 5, 7, and 8.
- Real writing influence is covered by Tasks 1, 2, 3, 4, and 9.
- Long-form continuity and reader-quality proof are covered by Tasks 1 through 4 and Task 9.
- User editability is covered by Tasks 7 and 8.

Placeholder scan:

- No task uses TBD, TODO, or deferred implementation language.
- Every task names files, test intent, implementation shape, commands, and expected results.

Type consistency:

- Monitor fields are consistently named `auditVerdict`, `repairAttempted`, `repairVerdict`, and `repairStillCritical`.
- Required sections use `RequiredOutputSection`.
- Retrieval diagnostics use `selected`, `dropped`, and `diagnostics`.

Execution note:

- This plan supersedes `docs/superpowers/plans/2026-06-16-sillytavern-full-compatibility.md` for current execution priority. Keep the older file as historical context.
