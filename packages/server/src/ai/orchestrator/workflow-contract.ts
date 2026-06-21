import {
  buildExecutionPolicy,
  classifyActionRisk,
  type AcceptanceReport,
  type CheckResult,
  type ExecutionMode,
  type ExecutionPolicy,
  type ExecutionStep,
  type ExecutionTrace,
  type IntendedAction,
  type IntentContract,
} from "@scribe/shared";

let taskIdSequence = 0;

export function createTaskId(prefix = "task"): string {
  taskIdSequence += 1;
  return `${prefix}-${Date.now()}-${taskIdSequence}`;
}

export function buildWriteIntentContract(input: {
  taskId: string;
  userRequest: string;
  chapterNos: number[];
}): IntentContract {
  const count = input.chapterNos.length;

  return {
    taskId: input.taskId,
    userRequest: input.userRequest,
    taskType: "write",
    mustDo: [
      `Generate ${count} chapter bodies`,
      "Keep draft prose hidden from ordinary chat until persistence finishes",
      "Write via chapter operations",
      "Show visible workflow status",
    ],
    mustNotDo: [
      "Do not stream generated prose as ordinary chat",
      "Do not claim completion before read-back verification",
    ],
    acceptanceCriteria: [
      `There are ${count} successful chapter write steps`,
      "Read-back verifies every target chapter",
      "Workflow status remains visible",
      "No hidden draft prose is emitted as ordinary chat",
    ],
    ambiguity: [],
  };
}

export function makeExecutionSteps(actions: IntendedAction[]): ExecutionStep[] {
  return actions.map((action, index) => ({
    id: `step-${index + 1}`,
    actionType: action.type,
    riskLevel: classifyActionRisk(action.type, action.riskHint),
    status: "pending",
  }));
}

export function makeWriteActions(chapterNos: number[]): IntendedAction[] {
  const isBulkWrite = chapterNos.length > 1;
  const type = isBulkWrite ? "multi_chapter_write" : "chapter_write";
  const riskHint = isBulkWrite ? "bulk_write" : "write";

  return chapterNos.map(chapterNo => ({
    id: `write-chapter-${chapterNo}`,
    type,
    target: { chapterNo },
    riskHint,
    reason: `Persist chapter ${chapterNo}`,
  }));
}

export function makeWritePolicy(input: {
  taskId: string;
  mode?: ExecutionMode;
  chapterNos: number[];
}): ExecutionPolicy {
  return buildExecutionPolicy({
    taskId: input.taskId,
    configuredMode: input.mode,
    actions: makeWriteActions(input.chapterNos),
  });
}

export function makeAcceptanceReport(input: {
  contract: IntentContract;
  trace: ExecutionTrace;
}): AcceptanceReport {
  const writeSteps = getWriteSteps(input.trace);
  const expectedWriteCount =
    getExpectedWriteCount(input.contract.acceptanceCriteria) ?? writeSteps.length;
  const userCriteria = input.contract.acceptanceCriteria.map(criterion =>
    evaluateUserCriterion(criterion, input.trace, expectedWriteCount),
  );
  const processCriteria: CheckResult[] = [
    {
      criterion: "Workflow final status is succeeded",
      status: input.trace.finalStatus === "succeeded" ? "pass" : "fail",
      evidence: `Trace final status is ${input.trace.finalStatus}.`,
    },
  ];
  const hasFailure = [...userCriteria, ...processCriteria].some(
    criterion => criterion.status !== "pass",
  );

  return {
    taskId: input.contract.taskId,
    verdict: hasFailure ? "fail" : "pass",
    userCriteria,
    processCriteria,
    domainCriteria: [],
    recommendedActions: hasFailure
      ? [{ type: "stop", reason: "workflow criteria failed" }]
      : [],
  };
}

function evaluateUserCriterion(
  criterion: string,
  trace: ExecutionTrace,
  expectedWriteCount: number,
): CheckResult {
  if (criterion.includes("successful chapter write steps")) {
    const verifiedWriteCount = getVerifiedWriteSteps(trace).length;
    const passed = verifiedWriteCount === expectedWriteCount;
    return {
      criterion,
      status: passed ? "pass" : "fail",
      evidence: passed
        ? `Expected ${expectedWriteCount} verified chapter write steps, found ${verifiedWriteCount}.`
        : `Expected ${expectedWriteCount} verified chapter write steps, found ${verifiedWriteCount}.`,
    };
  }

  if (criterion.includes("Read-back")) {
    const verifiedWriteCount = getVerifiedWriteSteps(trace).length;
    const passed = expectedWriteCount > 0 && verifiedWriteCount === expectedWriteCount;
    return {
      criterion,
      status: passed ? "pass" : "fail",
      evidence: passed
        ? `Expected read-back verification for ${expectedWriteCount} chapter write step${expectedWriteCount === 1 ? "" : "s"}, found ${verifiedWriteCount}.`
        : `Expected read-back verification for ${expectedWriteCount} chapter write step${expectedWriteCount === 1 ? "" : "s"}, found ${verifiedWriteCount}.`,
    };
  }

  return {
    criterion,
    status: trace.finalStatus === "succeeded" ? "pass" : "fail",
    evidence: `Trace final status is ${trace.finalStatus}.`,
  };
}

function getExpectedWriteCount(criteria: string[]): number | undefined {
  for (const criterion of criteria) {
    const match = criterion.match(/There are (\d+) successful chapter write steps/);
    if (match) {
      return Number(match[1]);
    }
  }

  return undefined;
}

function getWriteSteps(trace: ExecutionTrace): ExecutionStep[] {
  return trace.steps.filter(step => step.actionType.includes("write"));
}

function getVerifiedWriteSteps(trace: ExecutionTrace): ExecutionStep[] {
  return getWriteSteps(trace).filter(
    step => step.status === "succeeded" && step.verification?.passed === true,
  );
}
