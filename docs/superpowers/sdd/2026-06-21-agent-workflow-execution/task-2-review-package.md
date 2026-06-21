BASE: 2469b8f
HEAD: 2ca7bfd

## Commits
2ca7bfd feat(shared): add workflow sse events

## Stat
 packages/shared/src/types/sse-events.ts      | 27 ++++++++++++++++
 packages/shared/tests/agent-workflow.test.ts | 47 ++++++++++++++++++++++++++++
 2 files changed, 74 insertions(+)

## Diff
diff --git a/packages/shared/src/types/sse-events.ts b/packages/shared/src/types/sse-events.ts
index 1b17be6..8ddfd76 100644
--- a/packages/shared/src/types/sse-events.ts
+++ b/packages/shared/src/types/sse-events.ts
@@ -1,11 +1,18 @@
 import { z } from "zod";
+import {
+  AcceptanceReportSchema,
+  ExecutionModeSchema,
+  ExecutionPolicySchema,
+  ExecutionStepSchema,
+  IntentContractSchema,
+} from "./agent-workflow.js";

 export const AutoStateSchema = z.enum([
   "idle", "planning", "writing", "auditing",
   "paused_by_critical", "paused_by_user", "done", "error",
 ]);
 export type AutoState = z.infer<typeof AutoStateSchema>;

 export const SseEventSchema = z.discriminatedUnion("type", [
   z.object({ type: z.literal("text_delta"), delta: z.string() }),
   z.object({ type: z.literal("reasoning_delta"), delta: z.string() }),
@@ -27,14 +34,34 @@ export const SseEventSchema = z.discriminatedUnion("type", [
   }),
   // 意图识别结果(spec §7.3),前端可展示"识别到的意图"
   z.object({
     type: z.literal("intent"),
     category: z.enum([
       "chitchat", "writing_intent", "revise_intent",
       "query", "genre_section_op", "command_explicit", "delete_intent", "agentic", "other",
     ]),
     command: z.string().optional(),
   }),
+  z.object({ type: z.literal("workflow_mode"), mode: ExecutionModeSchema }),
+  z.object({
+    type: z.literal("execution_plan"),
+    taskId: z.string(),
+    policy: ExecutionPolicySchema,
+    steps: z.array(ExecutionStepSchema),
+    intentContract: IntentContractSchema.optional(),
+  }),
+  z.object({
+    type: z.literal("execution_step"),
+    taskId: z.string(),
+    step: ExecutionStepSchema,
+  }),
+  z.object({
+    type: z.literal("confirmation_required"),
+    taskId: z.string(),
+    policy: ExecutionPolicySchema,
+    message: z.string(),
+  }),
+  z.object({ type: z.literal("acceptance_report"), report: AcceptanceReportSchema }),
   z.object({ type: z.literal("done") }),
   z.object({ type: z.literal("error"), errorClass: z.string(), message: z.string() }),
 ]);
 export type SseEvent = z.infer<typeof SseEventSchema>;
diff --git a/packages/shared/tests/agent-workflow.test.ts b/packages/shared/tests/agent-workflow.test.ts
index 6545c5a..fe23b3c 100644
--- a/packages/shared/tests/agent-workflow.test.ts
+++ b/packages/shared/tests/agent-workflow.test.ts
@@ -1,17 +1,18 @@
 import { describe, expect, it } from "vitest";
 import {
   ExecutionPolicySchema,
   ExecutionModeWithDefaultSchema,
   buildExecutionPolicy,
   classifyActionRisk,
 } from "../src/types/agent-workflow.js";
+import { SseEventSchema } from "../src/types/sse-events.js";

 describe("agent workflow execution policy", () => {
   it("defaults missing execution mode to low risk auto", () => {
     expect(ExecutionModeWithDefaultSchema.parse(undefined)).toBe("low_risk_auto");
   });

   it("uses low risk auto policy when configured mode is omitted", () => {
     const policy = buildExecutionPolicy({
       taskId: "task-default",
       actions: [{ type: "chapter_write" }],
@@ -85,10 +86,56 @@ describe("classifyActionRisk", () => {
     ["write_three_chapters", "bulk_write"],
     ["delete_outline_node", "destructive"],
   ] as const)("classifies %s as %s", (actionType, risk) => {
     expect(classifyActionRisk(actionType)).toBe(risk);
   });

   it("uses risk hints when provided", () => {
     expect(classifyActionRisk("list_outline", "destructive")).toBe("destructive");
   });
 });
+
+describe("workflow SSE events", () => {
+  it("parses execution plans with pending workflow steps", () => {
+    const policy = buildExecutionPolicy({
+      taskId: "task-sse-plan",
+      actions: [{ type: "chapter_write" }],
+    });
+    const event = {
+      type: "execution_plan",
+      taskId: "task-sse-plan",
+      policy,
+      steps: [
+        {
+          id: "step-1",
+          actionType: "chapter_write",
+          riskLevel: "write",
+          status: "pending",
+        },
+      ],
+    };
+
+    expect(SseEventSchema.parse(event)).toEqual(event);
+  });
+
+  it("parses acceptance reports", () => {
+    const event = {
+      type: "acceptance_report",
+      report: {
+        taskId: "task-sse-report",
+        verdict: "pass",
+        userCriteria: [
+          {
+            criterion: "Draft matches requested chapter beat",
+            status: "pass",
+            evidence: "Chapter beat was verified in the draft.",
+          },
+        ],
+        processCriteria: [],
+        domainCriteria: [],
+        recommendedActions: [],
+      },
+    };
+
+    expect(SseEventSchema.parse(event)).toEqual(event);
+  });
+});
