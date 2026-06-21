BASE: 2ca7bfd
HEAD: 4219680

## Commits
4219680 fix(server): verify workflow target chapters
a1f84ea fix(server): enforce write acceptance counts
0bfd5cf feat(server): add workflow contract helpers

## Stat
 .../src/ai/orchestrator/workflow-contract.ts       | 264 +++++++++++++++++++
 .../unit/ai/orchestrator/workflow-contract.test.ts | 292 +++++++++++++++++++++
 2 files changed, 556 insertions(+)

## Diff
diff --git a/packages/server/src/ai/orchestrator/workflow-contract.ts b/packages/server/src/ai/orchestrator/workflow-contract.ts
new file mode 100644
index 0000000..e4cfdf2
--- /dev/null
+++ b/packages/server/src/ai/orchestrator/workflow-contract.ts
@@ -0,0 +1,264 @@
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
+      `Target chapters: ${input.chapterNos.join(", ")}`,
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
+    argsSummary: makeArgsSummary(action),
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
+  const expectedWriteTargets =
+    getExpectedWriteTargets(input.contract) ?? getExpectedWriteTargetsFromSteps(writeSteps);
+  const userCriteria = input.contract.acceptanceCriteria.map(criterion =>
+    evaluateUserCriterion(criterion, input.trace, expectedWriteCount, expectedWriteTargets),
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
+  expectedWriteTargets?: number[],
+): CheckResult {
+  if (criterion.includes("successful chapter write steps")) {
+    const verifiedWriteCount = getVerifiedWriteSteps(trace).length;
+    const countMatch = verifiedWriteCount === expectedWriteCount;
+    const verifiedTargets = getVerifiedWriteTargets(trace, expectedWriteTargets);
+    const targetMatch = expectedWriteTargets
+      ? sameNumberSet(verifiedTargets, expectedWriteTargets)
+      : true;
+    const passed = countMatch && targetMatch;
+    return {
+      criterion,
+      status: passed ? "pass" : "fail",
+      evidence:
+        countMatch && expectedWriteTargets && !targetMatch
+          ? `Expected verified chapter write targets ${formatTargets(expectedWriteTargets)}, found ${formatTargets(verifiedTargets)}.`
+          : `Expected ${expectedWriteCount} verified chapter write steps, found ${verifiedWriteCount}.`,
+    };
+  }
+
+  if (criterion.includes("Read-back")) {
+    const verifiedWriteCount = getVerifiedWriteSteps(trace).length;
+    const countMatch = expectedWriteCount > 0 && verifiedWriteCount === expectedWriteCount;
+    const verifiedTargets = getVerifiedWriteTargets(trace, expectedWriteTargets);
+    const targetMatch = expectedWriteTargets
+      ? sameNumberSet(verifiedTargets, expectedWriteTargets)
+      : true;
+    const passed = countMatch && targetMatch;
+    return {
+      criterion,
+      status: passed ? "pass" : "fail",
+      evidence:
+        countMatch && expectedWriteTargets && !targetMatch
+          ? `Expected read-back verification for chapter targets ${formatTargets(expectedWriteTargets)}, found ${formatTargets(verifiedTargets)}.`
+          : `Expected read-back verification for ${expectedWriteCount} chapter write step${expectedWriteCount === 1 ? "" : "s"}, found ${verifiedWriteCount}.`,
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
+function makeArgsSummary(action: IntendedAction): string | undefined {
+  const chapterNo = getActionChapterNo(action);
+  return chapterNo === undefined ? undefined : `chapterNo=${chapterNo}`;
+}
+
+function getActionChapterNo(action: IntendedAction): number | undefined {
+  const chapterNo = action.target?.chapterNo;
+  return typeof chapterNo === "number" ? chapterNo : undefined;
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
+function getExpectedWriteTargets(contract: IntentContract): number[] | undefined {
+  const parseableItems = [...contract.mustDo, ...contract.acceptanceCriteria];
+
+  for (const item of parseableItems) {
+    const match = item.match(/Target chapters:\s*([\d,\s]+)/);
+    if (match?.[1]) {
+      return uniqueSortedNumbers(match[1].match(/\d+/g)?.map(Number) ?? []);
+    }
+  }
+
+  return undefined;
+}
+
+function getExpectedWriteTargetsFromSteps(steps: ExecutionStep[]): number[] | undefined {
+  const targets = steps
+    .map(step => getStepChapterNo(step))
+    .filter((chapterNo): chapterNo is number => chapterNo !== undefined);
+
+  return targets.length > 0 ? uniqueSortedNumbers(targets) : undefined;
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
+
+function getVerifiedWriteTargets(
+  trace: ExecutionTrace,
+  expectedTargets?: number[],
+): number[] {
+  const targets = getVerifiedWriteSteps(trace)
+    .filter(step =>
+      expectedTargets ? expectedTargets.includes(getStepChapterNo(step) ?? Number.NaN) : true,
+    )
+    .map(step => getStepChapterNo(step))
+    .filter((chapterNo): chapterNo is number => chapterNo !== undefined);
+
+  return uniqueSortedNumbers(targets);
+}
+
+function getStepChapterNo(step: ExecutionStep): number | undefined {
+  return [
+    step.argsSummary,
+    step.resultSummary,
+    step.verification?.detail,
+  ]
+    .map(summary => summary?.match(/chapterNo=(\d+)|Chapter\s+(\d+)/i))
+    .map(match => (match ? Number(match[1] ?? match[2]) : undefined))
+    .find((chapterNo): chapterNo is number => chapterNo !== undefined);
+}
+
+function sameNumberSet(left: number[], right: number[]): boolean {
+  if (left.length !== right.length) {
+    return false;
+  }
+
+  return left.every((value, index) => value === right[index]);
+}
+
+function uniqueSortedNumbers(values: number[]): number[] {
+  return [...new Set(values)].sort((left, right) => left - right);
+}
+
+function formatTargets(targets: number[]): string {
+  return `[${targets.join(", ")}]`;
+}
diff --git a/packages/server/tests/unit/ai/orchestrator/workflow-contract.test.ts b/packages/server/tests/unit/ai/orchestrator/workflow-contract.test.ts
new file mode 100644
index 0000000..f0b2081
--- /dev/null
+++ b/packages/server/tests/unit/ai/orchestrator/workflow-contract.test.ts
@@ -0,0 +1,292 @@
+import { describe, expect, it } from "vitest";
+import type { ExecutionTrace } from "@scribe/shared";
+import {
+  buildWriteIntentContract,
+  makeAcceptanceReport,
+  makeExecutionSteps,
+  makeWriteActions,
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
+  it("includes target chapter numbers in execution step argument summaries", () => {
+    const steps = makeExecutionSteps(makeWriteActions([1, 2, 3]));
+
+    expect(steps.map(step => step.argsSummary)).toEqual([
+      "chapterNo=1",
+      "chapterNo=2",
+      "chapterNo=3",
+    ]);
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
+  it("fails acceptance when verified write targets do not match requested chapters", () => {
+    const contract = buildWriteIntentContract({
+      taskId: "task-write-target-mismatch",
+      userRequest: "直接写前三章",
+      chapterNos: [1, 2, 3],
+    });
+    const trace: ExecutionTrace = {
+      taskId: "task-write-target-mismatch",
+      mode: "low_risk_auto",
+      policy: makeWritePolicy({
+        taskId: "task-write-target-mismatch",
+        chapterNos: [1, 2, 3],
+      }),
+      steps: [1, 1, 1].map((chapterNo, index) => ({
+        id: `step-${index + 1}`,
+        actionType: "multi_chapter_write",
+        riskLevel: "bulk_write",
+        status: "succeeded",
+        argsSummary: `chapterNo=${chapterNo}`,
+        verification: {
+          method: "read_back",
+          passed: true,
+          detail: `Chapter ${chapterNo} was read back after persistence.`,
+        },
+      })),
+      finalStatus: "succeeded",
+    };
+
+    const report = makeAcceptanceReport({ contract, trace });
+
+    expect(report.verdict).toBe("fail");
+    expect(report.userCriteria).toContainEqual({
+      criterion: "There are 3 successful chapter write steps",
+      status: "fail",
+      evidence: "Expected verified chapter write targets [1, 2, 3], found [1].",
+    });
+    expect(report.userCriteria).toContainEqual({
+      criterion: "Read-back verifies every target chapter",
+      status: "fail",
+      evidence: "Expected read-back verification for chapter targets [1, 2, 3], found [1].",
+    });
+  });
+
+  it("passes acceptance when verified write targets match requested chapters", () => {
+    const contract = buildWriteIntentContract({
+      taskId: "task-write-target-match",
+      userRequest: "直接写前三章",
+      chapterNos: [1, 2, 3],
+    });
+    const trace: ExecutionTrace = {
+      taskId: "task-write-target-match",
+      mode: "low_risk_auto",
+      policy: makeWritePolicy({
+        taskId: "task-write-target-match",
+        chapterNos: [1, 2, 3],
+      }),
+      steps: [1, 2, 3].map(chapterNo => ({
+        id: `step-${chapterNo}`,
+        actionType: "multi_chapter_write",
+        riskLevel: "bulk_write",
+        status: "succeeded",
+        argsSummary: `chapterNo=${chapterNo}`,
+        verification: {
+          method: "read_back",
+          passed: true,
+          detail: `Chapter ${chapterNo} was read back after persistence.`,
+        },
+      })),
+      finalStatus: "succeeded",
+    };
+
+    const report = makeAcceptanceReport({ contract, trace });
+
+    expect(report.verdict).toBe("pass");
+    expect(report.userCriteria.every(criterion => criterion.status === "pass")).toBe(true);
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
