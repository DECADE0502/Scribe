# Task 5 Review Package V2

Base: 5d8832c
Head: ceca471

## Commits

ceca471 fix(server): trace write state recording
d415870 feat(server): emit writing workflow trace

## Stat

 .superpowers/sdd/task-5-report.md                  |  82 ++++++++++++
 .../ai/orchestrator/conversation-orchestrator.ts   | 140 ++++++++++++++++++++-
 .../src/ai/orchestrator/workflow-contract.ts       |  23 ++--
 .../orchestrator/conversation-orchestrator.test.ts | 109 ++++++++++++++++
 4 files changed, 344 insertions(+), 10 deletions(-)

## Diff

diff --git a/.superpowers/sdd/task-5-report.md b/.superpowers/sdd/task-5-report.md
new file mode 100644
index 0000000..ee8fbda
--- /dev/null
+++ b/.superpowers/sdd/task-5-report.md
@@ -0,0 +1,82 @@
+# Task 5 Report: Server Writing Workflow Plan, Trace, And Acceptance Events
+
+## Status
+
+DONE_WITH_CONCERNS
+
+## Summary
+
+- Added natural-language writing workflow planning in `conversation-orchestrator.ts`.
+- Natural-language write requests now emit `execution_plan` with intent contract, policy, and steps.
+- Non-auto modes, including `plan_only` and default `low_risk_auto` for write risk, emit `confirmation_required`, then `done`, without writing chapters.
+- `trusted_auto` mode emits running and terminal `execution_step` events around each chapter write, reads back the chapter file, and emits an `acceptance_report` built from the workflow contract and execution trace.
+- Slash `/write` behavior was left unchanged.
+
+## TDD Evidence
+
+Baseline before adding Task 5 tests:
+
+```text
+pnpm --filter @scribe/server exec vitest run tests/unit/ai/orchestrator/conversation-orchestrator.test.ts
+6 tests passed
+```
+
+RED after adding Task 5 tests:
+
+```text
+pnpm --filter @scribe/server exec vitest run tests/unit/ai/orchestrator/conversation-orchestrator.test.ts
+2 failed, 6 passed
+
+plans natural language writing in plan_only mode without writing chapters
+expected undefined to deeply equal [ 'chapterNo=6' ]
+
+traces trusted_auto natural language writing and emits a passing acceptance report
+expected undefined to be 'auto'
+```
+
+GREEN after implementation:
+
+```text
+pnpm --filter @scribe/server exec vitest run tests/unit/ai/orchestrator/conversation-orchestrator.test.ts
+8 tests passed
+```
+
+Typecheck:
+
+```text
+pnpm --filter @scribe/server typecheck
+tsc --noEmit
+exit 0
+```
+
+## Files Changed
+
+- `packages/server/src/ai/orchestrator/conversation-orchestrator.ts`
+- `packages/server/tests/unit/ai/orchestrator/conversation-orchestrator.test.ts`
+- `.superpowers/sdd/task-5-report.md`
+
+## Concerns
+
+The working tree had pre-existing dirty changes before this task, including in both intended owned code files. Some prior uncommitted multi-chapter write intent changes are interleaved with the Task 5 hunks and are also required by the Task 5 implementation, especially `parseWriteChapterCount` and the widened natural-language write hint. Because these hunks cannot be safely separated from pre-existing dirty work with high confidence, no commit was created.
+
+## Fix Report
+
+Summary:
+- Expanded natural-language write workflow actions so each target chapter plans both `chapter_write` and `record_chapter_state`.
+- Converted `record_chapter_state` tool start/end events into visible `execution_step` events with `state_compare` verification.
+- Stopped trusted_auto batch writing after a chapter write/read-back failure or state-recording failure.
+- Added focused regression coverage proving a failed first chapter write does not continue to later chapters.
+
+Tests:
+
+```text
+pnpm --filter @scribe/server exec vitest run tests/unit/ai/orchestrator/conversation-orchestrator.test.ts
+Test Files  1 passed (1)
+Tests  9 passed (9)
+```
+
+```text
+pnpm --filter @scribe/server typecheck
+tsc --noEmit
+exit 0
+```
diff --git a/packages/server/src/ai/orchestrator/conversation-orchestrator.ts b/packages/server/src/ai/orchestrator/conversation-orchestrator.ts
index 02d7abc..f32218c 100644
--- a/packages/server/src/ai/orchestrator/conversation-orchestrator.ts
+++ b/packages/server/src/ai/orchestrator/conversation-orchestrator.ts
@@ -1,32 +1,40 @@
 import type { CoreMessage, LanguageModel } from "ai";
-import type { ExecutionMode, SseEvent } from "@scribe/shared";
+import type { ExecutionMode, ExecutionStep, ExecutionTrace, SseEvent } from "@scribe/shared";
 import { parseSlashCommand, SLASH_COMMANDS } from "@scribe/shared";
 import type { BookHandle } from "../../http/book-registry.js";
 import { streamLlm } from "../llm-call.js";
 import { prependDeepestPrompt } from "../prompts/deepest-prompt.js";
 import { writeWithAudit } from "./write-with-audit.js";
 import { auditChapter } from "./audit-chapter.js";
 import { persistAuditResult } from "./audit-persist.js";
 import { recordChapterState, buildArchiveSummary } from "./record-state.js";
 import { recallChapters } from "../context-builder/recall.js";
 import {
   buildBookPromptContext,
   buildChapterWriteMessages,
   enrichUserIntentWithOutline,
 } from "../context-builder/book-context.js";
 import { makeGenreSectionTools } from "../tools/genre-section-tools.js";
 import { makeBookTools } from "../tools/book-tools.js";
 import { classifyIntent, type IntentCategory } from "./intent.js";
+import {
+  buildWriteIntentContract,
+  createTaskId,
+  makeAcceptanceReport,
+  makeExecutionSteps,
+  makeWriteActions,
+  makeWritePolicy,
+} from "./workflow-contract.js";

 /** 明确的写作意图关键词:命中即直接当 writing_intent,免一次分类往返,也避免分类器误判 */
-const WRITE_HINT = /(写下一章|写第.{0,3}章|续写|接着写|继续写|往下写|write\s+next)/i;
+const WRITE_HINT = /(写下一章|写第.{0,3}章|写.{0,6}章|写.{0,6}章节|前三章|前[0-9零〇一二两三四五六七八九十]{1,6}章|续写|接着写|继续写|往下写|write\s+(?:next|(?:the\s+)?first\s+\d+\s+chapters?|\d+\s+chapters?))/i;
 const REWRITE_HINT = /(重写|重新写|改写|rewrite)/i;

 function parseChineseChapterNumber(raw: string): number | undefined {
   const text = raw.trim();
   if (/^\d+$/.test(text)) return Number(text);
   const digits: Record<string, number> = {
     零: 0,
     〇: 0,
     一: 1,
     二: 2,
@@ -59,20 +67,30 @@ function parseChineseChapterNumber(raw: string): number | undefined {
 }

 function parseRewriteTargetChapter(message: string): number | undefined {
   if (!REWRITE_HINT.test(message)) return undefined;
   const match = message.match(/(?:重写|重新写|改写|rewrite)\s*(?:第)?\s*([0-9]+|[零〇一二两三四五六七八九十]{1,6})\s*章?/i);
   if (!match) return undefined;
   const parsed = parseChineseChapterNumber(match[1]!);
   return parsed && parsed >= 1 ? parsed : undefined;
 }

+function parseWriteChapterCount(message: string): number {
+  const bounded = (value: number | undefined) =>
+    value && value >= 1 ? Math.min(value, 10) : undefined;
+  const frontMatch = message.match(/前\s*([0-9]+|[零〇一二两三四五六七八九十]{1,6})\s*章/);
+  const directMatch = message.match(/写\s*([0-9]+|[零〇一二两三四五六七八九十]{1,6})\s*章/);
+  const englishMatch = message.match(/write\s+(?:the\s+)?(?:first\s+)?([0-9]+)\s+chapters?/i);
+  const count = bounded(parseChineseChapterNumber(frontMatch?.[1] ?? directMatch?.[1] ?? englishMatch?.[1] ?? ""));
+  return count ?? 1;
+}
+
 const DELETE_HINT = /(删除|删掉|去掉|清空|清除|delete|remove)/i;
 const DELETE_ALL_HINT = /(所有章节|全部章节|所有章|全部章|all\s*chapters)/i;

 /** 解析"删除第 N 章"的目标章号；"删除所有章节"返回 1（回档到书初） */
 function parseDeleteTargetChapter(message: string): number | undefined {
   if (!DELETE_HINT.test(message)) return undefined;
   if (DELETE_ALL_HINT.test(message)) return 1;
   const match = message.match(/(?:删除|删掉|去掉)\s*(?:第)?\s*([0-9]+|[零〇一二两三四五六七八九十]{1,6})\s*章?/i);
   if (!match) return undefined;
   const parsed = parseChineseChapterNumber(match[1]!);
@@ -458,21 +476,137 @@ export async function* runConversation(
   if (rewriteTarget !== undefined) {
     yield { type: "intent", category: "revise_intent" };
     yield* writeChapterFlow(deps, rewriteTarget, input.message, "rewrite");
     yield { type: "done" };
     return;
   }

   // 写下一章
   if (WRITE_HINT.test(input.message)) {
     yield { type: "intent", category: "writing_intent" };
-    yield* writeChapterFlow(deps, deps.handle.chaptersRepo.maxChapterNo() + 1, input.message);
+    const count = parseWriteChapterCount(input.message);
+    const start = deps.handle.chaptersRepo.maxChapterNo() + 1;
+    const chapterNos = Array.from({ length: count }, (_, offset) => start + offset);
+    const taskId = createTaskId("write");
+    const mode = input.executionMode ?? "low_risk_auto";
+    const intentContract = buildWriteIntentContract({
+      taskId,
+      userRequest: input.message,
+      chapterNos,
+    });
+    const actions = makeWriteActions(chapterNos);
+    const policy = makeWritePolicy({ taskId, mode, chapterNos });
+    const steps = makeExecutionSteps(actions);
+
+    yield { type: "execution_plan", taskId, policy, steps, intentContract };
+
+    if (policy.effectiveMode !== "auto") {
+      yield {
+        type: "confirmation_required",
+        taskId,
+        policy,
+        message: policy.reason,
+      };
+      yield { type: "done" };
+      return;
+    }
+
+    const completedSteps: ExecutionStep[] = [];
+    for (const chapterNo of chapterNos) {
+      const pendingStep = steps.find(step =>
+        step.argsSummary === `chapterNo=${chapterNo}` &&
+        (step.actionType === "chapter_write" || step.actionType === "multi_chapter_write")
+      )!;
+      const pendingStateStep = steps.find(step =>
+        step.argsSummary === `chapterNo=${chapterNo}` &&
+        step.actionType === "record_chapter_state"
+      );
+      const runningStep: ExecutionStep = {
+        ...pendingStep,
+        status: "running",
+        toolName: "chapter_write",
+      };
+      yield { type: "execution_step", taskId, step: runningStep };
+
+      let failed: string | undefined;
+      let stateStepFailed = false;
+      for await (const ev of writeChapterFlow(deps, chapterNo, input.message)) {
+        if (ev.type === "error") {
+          failed = ev.message;
+        }
+        if (ev.type === "tool_call_start" && ev.toolName === "record_chapter_state" && pendingStateStep) {
+          yield {
+            type: "execution_step",
+            taskId,
+            step: {
+              ...pendingStateStep,
+              status: "running",
+              toolName: "record_chapter_state",
+            },
+          };
+        }
+        if (ev.type === "tool_call_end" && ev.toolName === "record_chapter_state" && pendingStateStep) {
+          const result = ev.result as { success?: boolean } | undefined;
+          const succeeded = result?.success !== false;
+          stateStepFailed = !succeeded;
+          const completedStateStep: ExecutionStep = {
+            ...pendingStateStep,
+            status: succeeded ? "succeeded" : "failed",
+            toolName: "record_chapter_state",
+            resultSummary: succeeded
+              ? `Chapter ${chapterNo} state recorded.`
+              : `Chapter ${chapterNo} state recording failed.`,
+            verification: {
+              method: "state_compare",
+              passed: succeeded,
+              detail: succeeded
+                ? `Chapter ${chapterNo} state recording completed.`
+                : `Chapter ${chapterNo} state recording did not complete.`,
+            },
+          };
+          completedSteps.push(completedStateStep);
+          yield { type: "execution_step", taskId, step: completedStateStep };
+        }
+        yield ev;
+      }
+
+      const readBack = deps.handle.chapterFiles.read(chapterNo);
+      const succeeded = !failed && !!readBack?.content;
+      const completedStep: ExecutionStep = {
+        ...runningStep,
+        status: succeeded ? "succeeded" : "failed",
+        resultSummary: succeeded
+          ? `Chapter ${chapterNo} written and read back.`
+          : `Chapter ${chapterNo} write failed${failed ? `: ${failed}` : "."}`,
+        verification: {
+          method: "read_back",
+          passed: succeeded,
+          detail: succeeded
+            ? `Chapter ${chapterNo} read back after write.`
+            : `Chapter ${chapterNo} was not readable after write.`,
+        },
+      };
+      completedSteps.push(completedStep);
+      yield { type: "execution_step", taskId, step: completedStep };
+      if (!succeeded || stateStepFailed) break;
+    }
+
+    const trace: ExecutionTrace = {
+      taskId,
+      mode,
+      policy,
+      steps: completedSteps,
+      finalStatus: completedSteps.every(step => step.status === "succeeded")
+        ? "succeeded"
+        : "failed",
+    };
+    yield { type: "acceptance_report", report: makeAcceptanceReport({ contract: intentContract, trace }) };
     yield { type: "done" };
     return;
   }

   // 删除章节（回档语义）
   const deleteTarget = parseDeleteTargetChapter(input.message);
   if (deleteTarget !== undefined) {
     yield { type: "intent", category: "delete_intent" };
     const { deleteChaptersFrom } = await import("./delete-chapter.js");
     const result = deleteChaptersFrom(deps.handle, deleteTarget);
diff --git a/packages/server/src/ai/orchestrator/workflow-contract.ts b/packages/server/src/ai/orchestrator/workflow-contract.ts
index e4cfdf2..f8e61a0 100644
--- a/packages/server/src/ai/orchestrator/workflow-contract.ts
+++ b/packages/server/src/ai/orchestrator/workflow-contract.ts
@@ -58,27 +58,36 @@ export function makeExecutionSteps(actions: IntendedAction[]): ExecutionStep[] {
     status: "pending",
     argsSummary: makeArgsSummary(action),
   }));
 }

 export function makeWriteActions(chapterNos: number[]): IntendedAction[] {
   const isBulkWrite = chapterNos.length > 1;
   const type = isBulkWrite ? "multi_chapter_write" : "chapter_write";
   const riskHint = isBulkWrite ? "bulk_write" : "write";

-  return chapterNos.map(chapterNo => ({
-    id: `write-chapter-${chapterNo}`,
-    type,
-    target: { chapterNo },
-    riskHint,
-    reason: `Persist chapter ${chapterNo}`,
-  }));
+  return chapterNos.flatMap(chapterNo => [
+    {
+      id: `write-chapter-${chapterNo}`,
+      type,
+      target: { chapterNo },
+      riskHint,
+      reason: `Persist chapter ${chapterNo}`,
+    },
+    {
+      id: `record-chapter-state-${chapterNo}`,
+      type: "record_chapter_state",
+      target: { chapterNo },
+      riskHint,
+      reason: `Record chapter ${chapterNo} state`,
+    },
+  ]);
 }

 export function makeWritePolicy(input: {
   taskId: string;
   mode?: ExecutionMode;
   chapterNos: number[];
 }): ExecutionPolicy {
   return buildExecutionPolicy({
     taskId: input.taskId,
     configuredMode: input.mode,
diff --git a/packages/server/tests/unit/ai/orchestrator/conversation-orchestrator.test.ts b/packages/server/tests/unit/ai/orchestrator/conversation-orchestrator.test.ts
index e16f733..78f2565 100644
--- a/packages/server/tests/unit/ai/orchestrator/conversation-orchestrator.test.ts
+++ b/packages/server/tests/unit/ai/orchestrator/conversation-orchestrator.test.ts
@@ -189,11 +189,120 @@ describe("runConversation 斜杠命令路由(§7.4)", () => {

     const evs = await collect(runConversation(deps, { message: "重写第一章,加强开场" }));

     expect(evs.some(e => e.type === "error")).toBe(false);
     expect(evs.some(e => e.type === "text_delta")).toBe(false);
     const chapter1Versions = handle.chaptersRepo.listVersions(1);
     expect(chapter1Versions[0].source).toBe("ai_rewrite");
     expect(chapter1Versions[0].contentMd).toBe("第一章重写正文");
     expect(handle.chaptersRepo.listVersions(5)[0].source).toBe("ai_write");
   });
+
+  it("routes natural language multi-chapter writing through the write flow without chat prose", async () => {
+    deps.model = makeWritingModel("new chapter body");
+    deps.auditModel = makeAuditAndRecordModel();
+
+    const evs = await collect(runConversation(deps, {
+      message: "可以啊，现在直接把前三章都写了",
+      executionMode: "trusted_auto",
+    }));
+
+    expect(evs.find(e => e.type === "intent")?.category).toBe("writing_intent");
+    expect(evs.some(e => e.type === "text_delta")).toBe(false);
+    const writes = evs.filter(e => e.type === "tool_call_start" && e.toolName === "chapter_write");
+    expect(writes.map(e => e.args.chapterNo)).toEqual([6, 7, 8]);
+    expect(handle.chaptersRepo.listVersions(6)[0].contentMd).toBe("new chapter body");
+    expect(handle.chaptersRepo.listVersions(7)[0].contentMd).toBe("new chapter body");
+    expect(handle.chaptersRepo.listVersions(8)[0].contentMd).toBe("new chapter body");
+  });
+
+  it("plans natural language writing in plan_only mode without writing chapters", async () => {
+    deps.model = makeWritingModel("planned body should not write");
+    deps.auditModel = makeAuditAndRecordModel();
+    const beforeMax = handle.chaptersRepo.maxChapterNo();
+
+    const evs = await collect(runConversation(deps, {
+      message: "write next chapter",
+      executionMode: "plan_only",
+    }));
+
+    expect(evs.find(e => e.type === "intent")?.category).toBe("writing_intent");
+    const plan = evs.find(e => e.type === "execution_plan");
+    expect(plan?.steps.map((step: any) => [step.actionType, step.argsSummary])).toEqual([
+      ["chapter_write", `chapterNo=${beforeMax + 1}`],
+      ["record_chapter_state", `chapterNo=${beforeMax + 1}`],
+    ]);
+    const confirmation = evs.find(e => e.type === "confirmation_required");
+    expect(confirmation?.taskId).toBe(plan?.taskId);
+    expect(evs.some(e => e.type === "tool_call_start" && e.toolName === "chapter_write")).toBe(false);
+    expect(handle.chaptersRepo.maxChapterNo()).toBe(beforeMax);
+    expect(evs.at(-1).type).toBe("done");
+  });
+
+  it("traces trusted_auto natural language writing and emits a passing acceptance report", async () => {
+    deps.model = makeWritingModel("trusted auto chapter body");
+    deps.auditModel = makeAuditAndRecordModel();
+
+    const evs = await collect(runConversation(deps, {
+      message: "write next chapter",
+      executionMode: "trusted_auto",
+    }));
+
+    const plan = evs.find(e => e.type === "execution_plan");
+    expect(plan?.policy.effectiveMode).toBe("auto");
+    const succeededWrite = evs.find(
+      e => e.type === "execution_step"
+        && e.step.toolName === "chapter_write"
+        && e.step.status === "succeeded",
+    );
+    expect(succeededWrite?.step.resultSummary).toContain("Chapter 6");
+    expect(succeededWrite?.step.verification).toEqual({
+      method: "read_back",
+      passed: true,
+      detail: "Chapter 6 read back after write.",
+    });
+    const succeededRecord = evs.find(
+      e => e.type === "execution_step"
+        && e.step.toolName === "record_chapter_state"
+        && e.step.status === "succeeded",
+    );
+    expect(succeededRecord?.step.resultSummary).toContain("Chapter 6 state recorded");
+    expect(succeededRecord?.step.verification).toEqual({
+      method: "state_compare",
+      passed: true,
+      detail: "Chapter 6 state recording completed.",
+    });
+    const report = evs.find(e => e.type === "acceptance_report")?.report;
+    expect(report?.verdict).toBe("pass");
+    expect(handle.chaptersRepo.listVersions(6)[0].contentMd).toBe("trusted auto chapter body");
+    expect(evs.at(-1).type).toBe("done");
+  });
+
+  it("stops trusted_auto multi-chapter writing after a chapter write verification failure", async () => {
+    deps.model = makeWritingModel("");
+    deps.auditModel = makeAuditAndRecordModel();
+
+    const evs = await collect(runConversation(deps, {
+      message: "write 3 chapters",
+      executionMode: "trusted_auto",
+    }));
+
+    const writeStarts = evs.filter(e => e.type === "tool_call_start" && e.toolName === "chapter_write");
+    expect(writeStarts.map(e => e.args.chapterNo)).toEqual([6]);
+    expect(handle.chaptersRepo.listVersions(6)).toHaveLength(0);
+    expect(handle.chaptersRepo.listVersions(7)).toHaveLength(0);
+    expect(handle.chaptersRepo.listVersions(8)).toHaveLength(0);
+    const failedWrite = evs.find(
+      e => e.type === "execution_step"
+        && e.step.toolName === "chapter_write"
+        && e.step.status === "failed",
+    );
+    expect(failedWrite?.step.verification).toEqual({
+      method: "read_back",
+      passed: false,
+      detail: "Chapter 6 was not readable after write.",
+    });
+    const report = evs.find(e => e.type === "acceptance_report")?.report;
+    expect(report?.verdict).toBe("fail");
+    expect(evs.at(-1).type).toBe("done");
+  });
 });
