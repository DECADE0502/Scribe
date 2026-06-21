BASE: 2ca7bfd
HEAD: a1f84ea

## Commits
a1f84ea fix(server): enforce write acceptance counts
0bfd5cf feat(server): add workflow contract helpers

## Stat
 .../src/ai/orchestrator/workflow-contract.ts       | 175 ++++++++++++++++++
 .../unit/ai/orchestrator/workflow-contract.test.ts | 204 +++++++++++++++++++++
 2 files changed, 379 insertions(+)

## Diff
diff --git a/packages/server/src/ai/orchestrator/workflow-contract.ts b/packages/server/src/ai/orchestrator/workflow-contract.ts
new file mode 100644
index 0000000..3948d3a
--- /dev/null
+++ b/packages/server/src/ai/orchestrator/workflow-contract.ts
@@ -0,0 +1,175 @@
+import {
+  buildExecutionPolicy,
+  classifyActionRisk,
+  type AcceptanceReport,
+  type CheckResult,
+  type ExecutionMode,
+  type ExecutionPolicy,
+  type ExecutionStep,
+  type ExecutionTrace,
+  type IntendedAction,
+  type IntentContract,
+} from "@scribe/shared";
+
+let taskIdSequence = 0;
+
+export function createTaskId(prefix = "task"): string {
+  taskIdSequence += 1;
+  return `${prefix}-${Date.now()}-${taskIdSequence}`;
+}
+
+export function buildWriteIntentContract(input: {
+  taskId: string;
+  userRequest: string;
+  chapterNos: number[];
+}): IntentContract {
+  const count = input.chapterNos.length;
+
+  return {
+    taskId: input.taskId,
+    userRequest: input.userRequest,
+    taskType: "write",
+    mustDo: [
+      `Generate ${count} chapter bodies`,
+      "Keep draft prose hidden from ordinary chat until persistence finishes",
+      "Write via chapter operations",
+      "Show visible workflow status",
+    ],
+    mustNotDo: [
+      "Do not stream generated prose as ordinary chat",
+      "Do not claim completion before read-back verification",
+    ],
+    acceptanceCriteria: [
+      `There are ${count} successful chapter write steps`,
+      "Read-back verifies every target chapter",
+      "Workflow status remains visible",
+      "No hidden draft prose is emitted as ordinary chat",
+    ],
+    ambiguity: [],
+  };
+}
+
+export function makeExecutionSteps(actions: IntendedAction[]): ExecutionStep[] {
+  return actions.map((action, index) => ({
+    id: `step-${index + 1}`,
+    actionType: action.type,
+    riskLevel: classifyActionRisk(action.type, action.riskHint),
+    status: "pending",
+  }));
+}
+
+export function makeWriteActions(chapterNos: number[]): IntendedAction[] {
+  const isBulkWrite = chapterNos.length > 1;
+  const type = isBulkWrite ? "multi_chapter_write" : "chapter_write";
+  const riskHint = isBulkWrite ? "bulk_write" : "write";
+
+  return chapterNos.map(chapterNo => ({
+    id: `write-chapter-${chapterNo}`,
+    type,
+    target: { chapterNo },
+    riskHint,
+    reason: `Persist chapter ${chapterNo}`,
+  }));
+}
+
+export function makeWritePolicy(input: {
+  taskId: string;
+  mode?: ExecutionMode;
+  chapterNos: number[];
+}): ExecutionPolicy {
+  return buildExecutionPolicy({
+    taskId: input.taskId,
+    configuredMode: input.mode,
+    actions: makeWriteActions(input.chapterNos),
+  });
+}
+
+export function makeAcceptanceReport(input: {
+  contract: IntentContract;
+  trace: ExecutionTrace;
+}): AcceptanceReport {
+  const writeSteps = getWriteSteps(input.trace);
+  const expectedWriteCount =
+    getExpectedWriteCount(input.contract.acceptanceCriteria) ?? writeSteps.length;
+  const userCriteria = input.contract.acceptanceCriteria.map(criterion =>
+    evaluateUserCriterion(criterion, input.trace, expectedWriteCount),
+  );
+  const processCriteria: CheckResult[] = [
+    {
+      criterion: "Workflow final status is succeeded",
+      status: input.trace.finalStatus === "succeeded" ? "pass" : "fail",
+      evidence: `Trace final status is ${input.trace.finalStatus}.`,
+    },
+  ];
+  const hasFailure = [...userCriteria, ...processCriteria].some(
+    criterion => criterion.status !== "pass",
+  );
+
+  return {
+    taskId: input.contract.taskId,
+    verdict: hasFailure ? "fail" : "pass",
+    userCriteria,
+    processCriteria,
+    domainCriteria: [],
+    recommendedActions: hasFailure
+      ? [{ type: "stop", reason: "workflow criteria failed" }]
+      : [],
+  };
+}
+
+function evaluateUserCriterion(
+  criterion: string,
+  trace: ExecutionTrace,
+  expectedWriteCount: number,
+): CheckResult {
+  if (criterion.includes("successful chapter write steps")) {
+    const verifiedWriteCount = getVerifiedWriteSteps(trace).length;
+    const passed = verifiedWriteCount === expectedWriteCount;
+    return {
+      criterion,
+      status: passed ? "pass" : "fail",
+      evidence: passed
+        ? `Expected ${expectedWriteCount} verified chapter write steps, found ${verifiedWriteCount}.`
+        : `Expected ${expectedWriteCount} verified chapter write steps, found ${verifiedWriteCount}.`,
+    };
+  }
+
+  if (criterion.includes("Read-back")) {
+    const verifiedWriteCount = getVerifiedWriteSteps(trace).length;
+    const passed = expectedWriteCount > 0 && verifiedWriteCount === expectedWriteCount;
+    return {
+      criterion,
+      status: passed ? "pass" : "fail",
+      evidence: passed
+        ? `Expected read-back verification for ${expectedWriteCount} chapter write step${expectedWriteCount === 1 ? "" : "s"}, found ${verifiedWriteCount}.`
+        : `Expected read-back verification for ${expectedWriteCount} chapter write step${expectedWriteCount === 1 ? "" : "s"}, found ${verifiedWriteCount}.`,
+    };
+  }
+
+  return {
+    criterion,
+    status: trace.finalStatus === "succeeded" ? "pass" : "fail",
+    evidence: `Trace final status is ${trace.finalStatus}.`,
+  };
+}
+
+function getExpectedWriteCount(criteria: string[]): number | undefined {
+  for (const criterion of criteria) {
+    const match = criterion.match(/There are (\d+) successful chapter write steps/);
+    if (match) {
+      return Number(match[1]);
+    }
+  }
+
+  return undefined;
+}
+
+function getWriteSteps(trace: ExecutionTrace): ExecutionStep[] {
+  return trace.steps.filter(step => step.actionType.includes("write"));
+}
+
+function getVerifiedWriteSteps(trace: ExecutionTrace): ExecutionStep[] {
+  return getWriteSteps(trace).filter(
+    step => step.status === "succeeded" && step.verification?.passed === true,
+  );
+}
diff --git a/packages/server/tests/unit/ai/orchestrator/workflow-contract.test.ts b/packages/server/tests/unit/ai/orchestrator/workflow-contract.test.ts
new file mode 100644
index 0000000..04f3687
--- /dev/null
+++ b/packages/server/tests/unit/ai/orchestrator/workflow-contract.test.ts
@@ -0,0 +1,204 @@
+import { describe, expect, it } from "vitest";
+import type { ExecutionTrace } from "@scribe/shared";
+import {
+  buildWriteIntentContract,
+  makeAcceptanceReport,
+  makeExecutionSteps,
+  makeWritePolicy,
+} from "../../../../src/ai/orchestrator/workflow-contract.js";
+
+describe("workflow contract helpers", () => {
+  it("builds write intent contracts for requested chapters", () => {
+    const contract = buildWriteIntentContract({
+      taskId: "task-write-1",
+      userRequest: "直接写前三章",
+      chapterNos: [1, 2, 3],
+    });
+
+    expect(contract.taskType).toBe("write");
+    expect(contract.mustDo).toContain("Generate 3 chapter bodies");
+    expect(contract.mustNotDo.some(item => item.includes("ordinary chat"))).toBe(true);
+    expect(contract.acceptanceCriteria).toContain("There are 3 successful chapter write steps");
+  });
+
+  it("creates pending execution steps with classified risks", () => {
+    const steps = makeExecutionSteps([
+      { id: "action-1", type: "list_characters", reason: "Read cast" },
+      { id: "action-2", type: "chapter_write", reason: "Persist chapter 1" },
+    ]);
+
+    expect(steps.map(step => step.status)).toEqual(["pending", "pending"]);
+    expect(steps.map(step => step.riskLevel)).toEqual(["read", "write"]);
+  });
+
+  it("passes acceptance when write trace succeeds with read-back verification", () => {
+    const contract = buildWriteIntentContract({
+      taskId: "task-write-1",
+      userRequest: "直接写前三章",
+      chapterNos: [1],
+    });
+    const trace: ExecutionTrace = {
+      taskId: "task-write-1",
+      mode: "low_risk_auto",
+      policy: {
+        taskId: "task-write-1",
+        configuredMode: "low_risk_auto",
+        effectiveMode: "confirm",
+        highestRisk: "write",
+        requiresConfirmation: true,
+        reason: "low_risk_auto requires confirmation for write actions",
+        userChoices: ["approve", "edit_plan", "reroll", "cancel"],
+      },
+      steps: [
+        {
+          id: "step-1",
+          actionType: "chapter_write",
+          riskLevel: "write",
+          status: "succeeded",
+          verification: {
+            method: "read_back",
+            passed: true,
+            detail: "Chapter 1 was read back after persistence.",
+          },
+        },
+      ],
+      finalStatus: "succeeded",
+    };
+
+    const report = makeAcceptanceReport({ contract, trace });
+
+    expect(report.verdict).toBe("pass");
+    expect(report.userCriteria.every(criterion => criterion.status === "pass")).toBe(true);
+    expect(report.processCriteria).toContainEqual({
+      criterion: "Workflow final status is succeeded",
+      status: "pass",
+      evidence: "Trace final status is succeeded.",
+    });
+    expect(report.recommendedActions).toEqual([]);
+  });
+
+  it("fails acceptance when requested chapter writes are partial", () => {
+    const contract = buildWriteIntentContract({
+      taskId: "task-write-3",
+      userRequest: "鐩存帴鍐欏墠涓夌珷",
+      chapterNos: [1, 2, 3],
+    });
+    const trace: ExecutionTrace = {
+      taskId: "task-write-3",
+      mode: "low_risk_auto",
+      policy: makeWritePolicy({ taskId: "task-write-3", chapterNos: [1, 2, 3] }),
+      steps: [
+        {
+          id: "step-1",
+          actionType: "multi_chapter_write",
+          riskLevel: "bulk_write",
+          status: "succeeded",
+          verification: {
+            method: "read_back",
+            passed: true,
+            detail: "Chapter 1 was read back after persistence.",
+          },
+        },
+      ],
+      finalStatus: "succeeded",
+    };
+
+    const report = makeAcceptanceReport({ contract, trace });
+
+    expect(report.verdict).toBe("fail");
+    expect(report.userCriteria).toContainEqual({
+      criterion: "There are 3 successful chapter write steps",
+      status: "fail",
+      evidence: "Expected 3 verified chapter write steps, found 1.",
+    });
+    expect(report.recommendedActions).toEqual([
+      { type: "stop", reason: "workflow criteria failed" },
+    ]);
+  });
+
+  it("fails acceptance and recommends stop when read-back verification fails", () => {
+    const contract = buildWriteIntentContract({
+      taskId: "task-write-verify",
+      userRequest: "鐩存帴鍐欑涓�绔",
+      chapterNos: [1],
+    });
+    const trace: ExecutionTrace = {
+      taskId: "task-write-verify",
+      mode: "low_risk_auto",
+      policy: makeWritePolicy({ taskId: "task-write-verify", chapterNos: [1] }),
+      steps: [
+        {
+          id: "step-1",
+          actionType: "chapter_write",
+          riskLevel: "write",
+          status: "succeeded",
+          verification: {
+            method: "read_back",
+            passed: false,
+            detail: "Chapter 1 read-back did not match persisted output.",
+          },
+        },
+      ],
+      finalStatus: "succeeded",
+    };
+
+    const report = makeAcceptanceReport({ contract, trace });
+
+    expect(report.verdict).toBe("fail");
+    expect(report.userCriteria).toContainEqual({
+      criterion: "Read-back verifies every target chapter",
+      status: "fail",
+      evidence: "Expected read-back verification for 1 chapter write step, found 0.",
+    });
+    expect(report.recommendedActions).toEqual([
+      { type: "stop", reason: "workflow criteria failed" },
+    ]);
+  });
+
+  it("marks failed final status as a failed process criterion", () => {
+    const contract = buildWriteIntentContract({
+      taskId: "task-write-failed",
+      userRequest: "鐩存帴鍐欑涓�绔",
+      chapterNos: [1],
+    });
+    const trace: ExecutionTrace = {
+      taskId: "task-write-failed",
+      mode: "low_risk_auto",
+      policy: makeWritePolicy({ taskId: "task-write-failed", chapterNos: [1] }),
+      steps: [
+        {
+          id: "step-1",
+          actionType: "chapter_write",
+          riskLevel: "write",
+          status: "succeeded",
+          verification: {
+            method: "read_back",
+            passed: true,
+            detail: "Chapter 1 was read back after persistence.",
+          },
+        },
+      ],
+      finalStatus: "failed",
+    };
+
+    const report = makeAcceptanceReport({ contract, trace });
+
+    expect(report.verdict).toBe("fail");
+    expect(report.processCriteria).toContainEqual({
+      criterion: "Workflow final status is succeeded",
+      status: "fail",
+      evidence: "Trace final status is failed.",
+    });
+  });
+
+  it("preserves the shared low_risk_auto default when write policy mode is omitted", () => {
+    const policy = makeWritePolicy({
+      taskId: "task-write-default-mode",
+      chapterNos: [1],
+    });
+
+    expect(policy.configuredMode).toBe("low_risk_auto");
+    expect(policy.effectiveMode).toBe("confirm");
+    expect(policy.requiresConfirmation).toBe(true);
+  });
+});
