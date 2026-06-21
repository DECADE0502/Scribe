# Task 5 Review Package

Base: 5d8832c
Head: d415870

## Commits

d415870 feat(server): emit writing workflow trace

## Stat

 .../ai/orchestrator/conversation-orchestrator.ts   | 98 +++++++++++++++++++++-
 .../orchestrator/conversation-orchestrator.test.ts | 66 +++++++++++++++
 2 files changed, 161 insertions(+), 3 deletions(-)

## Diff

diff --git a/packages/server/src/ai/orchestrator/conversation-orchestrator.ts b/packages/server/src/ai/orchestrator/conversation-orchestrator.ts
index 02d7abc..60bc41e 100644
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
@@ -458,21 +476,95 @@ export async function* runConversation(
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
+    for (const [index, chapterNo] of chapterNos.entries()) {
+      const pendingStep = steps[index]!;
+      const runningStep: ExecutionStep = {
+        ...pendingStep,
+        status: "running",
+        toolName: "chapter_write",
+      };
+      yield { type: "execution_step", taskId, step: runningStep };
+
+      let failed: string | undefined;
+      for await (const ev of writeChapterFlow(deps, chapterNo, input.message)) {
+        if (ev.type === "error") {
+          failed = ev.message;
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
diff --git a/packages/server/tests/unit/ai/orchestrator/conversation-orchestrator.test.ts b/packages/server/tests/unit/ai/orchestrator/conversation-orchestrator.test.ts
index e16f733..c84274f 100644
--- a/packages/server/tests/unit/ai/orchestrator/conversation-orchestrator.test.ts
+++ b/packages/server/tests/unit/ai/orchestrator/conversation-orchestrator.test.ts
@@ -189,11 +189,77 @@ describe("runConversation 斜杠命令路由(§7.4)", () => {

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
+    expect(plan?.steps.map((step: any) => step.argsSummary)).toEqual([`chapterNo=${beforeMax + 1}`]);
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
+    const report = evs.find(e => e.type === "acceptance_report")?.report;
+    expect(report?.verdict).toBe("pass");
+    expect(handle.chaptersRepo.listVersions(6)[0].contentMd).toBe("trusted auto chapter body");
+    expect(evs.at(-1).type).toBe("done");
+  });
 });
