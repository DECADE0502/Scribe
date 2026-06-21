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
      `Target chapters: ${input.chapterNos.join(", ")}`,
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
    argsSummary: makeArgsSummary(action),
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
  const expectedWriteTargets =
    getExpectedWriteTargets(input.contract) ?? getExpectedWriteTargetsFromSteps(writeSteps);
  const userCriteria = input.contract.acceptanceCriteria.map(criterion =>
    evaluateUserCriterion(criterion, input.trace, expectedWriteCount, expectedWriteTargets),
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
  expectedWriteTargets?: number[],
): CheckResult {
  if (criterion.includes("successful chapter write steps")) {
    const verifiedWriteCount = getVerifiedWriteSteps(trace).length;
    const countMatch = verifiedWriteCount === expectedWriteCount;
    const verifiedTargets = getVerifiedWriteTargets(trace, expectedWriteTargets);
    const targetMatch = expectedWriteTargets
      ? sameNumberSet(verifiedTargets, expectedWriteTargets)
      : true;
    const passed = countMatch && targetMatch;
    return {
      criterion,
      status: passed ? "pass" : "fail",
      evidence:
        countMatch && expectedWriteTargets && !targetMatch
          ? `Expected verified chapter write targets ${formatTargets(expectedWriteTargets)}, found ${formatTargets(verifiedTargets)}.`
          : `Expected ${expectedWriteCount} verified chapter write steps, found ${verifiedWriteCount}.`,
    };
  }

  if (criterion.includes("Read-back")) {
    const verifiedWriteCount = getVerifiedWriteSteps(trace).length;
    const countMatch = expectedWriteCount > 0 && verifiedWriteCount === expectedWriteCount;
    const verifiedTargets = getVerifiedWriteTargets(trace, expectedWriteTargets);
    const targetMatch = expectedWriteTargets
      ? sameNumberSet(verifiedTargets, expectedWriteTargets)
      : true;
    const passed = countMatch && targetMatch;
    return {
      criterion,
      status: passed ? "pass" : "fail",
      evidence:
        countMatch && expectedWriteTargets && !targetMatch
          ? `Expected read-back verification for chapter targets ${formatTargets(expectedWriteTargets)}, found ${formatTargets(verifiedTargets)}.`
          : `Expected read-back verification for ${expectedWriteCount} chapter write step${expectedWriteCount === 1 ? "" : "s"}, found ${verifiedWriteCount}.`,
    };
  }

  return {
    criterion,
    status: trace.finalStatus === "succeeded" ? "pass" : "fail",
    evidence: `Trace final status is ${trace.finalStatus}.`,
  };
}

function makeArgsSummary(action: IntendedAction): string | undefined {
  const chapterNo = getActionChapterNo(action);
  return chapterNo === undefined ? undefined : `chapterNo=${chapterNo}`;
}

function getActionChapterNo(action: IntendedAction): number | undefined {
  const chapterNo = action.target?.chapterNo;
  return typeof chapterNo === "number" ? chapterNo : undefined;
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

function getExpectedWriteTargets(contract: IntentContract): number[] | undefined {
  const parseableItems = [...contract.mustDo, ...contract.acceptanceCriteria];

  for (const item of parseableItems) {
    const match = item.match(/Target chapters:\s*([\d,\s]+)/);
    if (match?.[1]) {
      return uniqueSortedNumbers(match[1].match(/\d+/g)?.map(Number) ?? []);
    }
  }

  return undefined;
}

function getExpectedWriteTargetsFromSteps(steps: ExecutionStep[]): number[] | undefined {
  const targets = steps
    .map(step => getStepChapterNo(step))
    .filter((chapterNo): chapterNo is number => chapterNo !== undefined);

  return targets.length > 0 ? uniqueSortedNumbers(targets) : undefined;
}

function getWriteSteps(trace: ExecutionTrace): ExecutionStep[] {
  return trace.steps.filter(step => step.actionType.includes("write"));
}

function getVerifiedWriteSteps(trace: ExecutionTrace): ExecutionStep[] {
  return getWriteSteps(trace).filter(
    step => step.status === "succeeded" && step.verification?.passed === true,
  );
}

function getVerifiedWriteTargets(
  trace: ExecutionTrace,
  expectedTargets?: number[],
): number[] {
  const targets = getVerifiedWriteSteps(trace)
    .filter(step =>
      expectedTargets ? expectedTargets.includes(getStepChapterNo(step) ?? Number.NaN) : true,
    )
    .map(step => getStepChapterNo(step))
    .filter((chapterNo): chapterNo is number => chapterNo !== undefined);

  return uniqueSortedNumbers(targets);
}

function getStepChapterNo(step: ExecutionStep): number | undefined {
  return [
    step.argsSummary,
    step.resultSummary,
    step.verification?.detail,
  ]
    .map(summary => summary?.match(/chapterNo=(\d+)|Chapter\s+(\d+)/i))
    .map(match => (match ? Number(match[1] ?? match[2]) : undefined))
    .find((chapterNo): chapterNo is number => chapterNo !== undefined);
}

function sameNumberSet(left: number[], right: number[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

function uniqueSortedNumbers(values: number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function formatTargets(targets: number[]): string {
  return `[${targets.join(", ")}]`;
}
