import { describe, expect, it } from "vitest";
import type { ExecutionTrace } from "@scribe/shared";
import {
  buildWriteIntentContract,
  makeAcceptanceReport,
  makeExecutionSteps,
  makeWriteActions,
  makeWritePolicy,
} from "../../../../src/ai/orchestrator/workflow-contract.js";

describe("workflow contract helpers", () => {
  it("builds write intent contracts for requested chapters", () => {
    const contract = buildWriteIntentContract({
      taskId: "task-write-1",
      userRequest: "直接写前三章",
      chapterNos: [1, 2, 3],
    });

    expect(contract.taskType).toBe("write");
    expect(contract.mustDo).toContain("Generate 3 chapter bodies");
    expect(contract.mustNotDo.some(item => item.includes("ordinary chat"))).toBe(true);
    expect(contract.acceptanceCriteria).toContain("There are 3 successful chapter write steps");
  });

  it("creates pending execution steps with classified risks", () => {
    const steps = makeExecutionSteps([
      { id: "action-1", type: "list_characters", reason: "Read cast" },
      { id: "action-2", type: "chapter_write", reason: "Persist chapter 1" },
    ]);

    expect(steps.map(step => step.status)).toEqual(["pending", "pending"]);
    expect(steps.map(step => step.riskLevel)).toEqual(["read", "write"]);
  });

  it("includes write and state-recording steps with parseable chapter argument summaries", () => {
    const steps = makeExecutionSteps(makeWriteActions([1, 2, 3]));

    expect(steps.map(step => step.actionType)).toEqual([
      "multi_chapter_write",
      "record_chapter_state",
      "multi_chapter_write",
      "record_chapter_state",
      "multi_chapter_write",
      "record_chapter_state",
    ]);
    expect(steps.map(step => step.argsSummary)).toEqual([
      "chapterNo=1",
      "chapterNo=1",
      "chapterNo=2",
      "chapterNo=2",
      "chapterNo=3",
      "chapterNo=3",
    ]);
    expect(
      steps
        .filter(step => step.actionType === "record_chapter_state")
        .map(step => step.argsSummary?.match(/chapterNo=(\d+)/)?.[1]),
    ).toEqual(["1", "2", "3"]);
  });

  it("passes acceptance when write trace succeeds with read-back verification", () => {
    const contract = buildWriteIntentContract({
      taskId: "task-write-1",
      userRequest: "直接写前三章",
      chapterNos: [1],
    });
    const trace: ExecutionTrace = {
      taskId: "task-write-1",
      mode: "low_risk_auto",
      policy: {
        taskId: "task-write-1",
        configuredMode: "low_risk_auto",
        effectiveMode: "confirm",
        highestRisk: "write",
        requiresConfirmation: true,
        reason: "low_risk_auto requires confirmation for write actions",
        userChoices: ["approve", "edit_plan", "reroll", "cancel"],
      },
      steps: [
        {
          id: "step-1",
          actionType: "chapter_write",
          riskLevel: "write",
          status: "succeeded",
          verification: {
            method: "read_back",
            passed: true,
            detail: "Chapter 1 was read back after persistence.",
          },
        },
      ],
      finalStatus: "succeeded",
    };

    const report = makeAcceptanceReport({ contract, trace });

    expect(report.verdict).toBe("pass");
    expect(report.userCriteria.every(criterion => criterion.status === "pass")).toBe(true);
    expect(report.processCriteria).toContainEqual({
      criterion: "Workflow final status is succeeded",
      status: "pass",
      evidence: "Trace final status is succeeded.",
    });
    expect(report.recommendedActions).toEqual([]);
  });

  it("fails acceptance when verified write targets do not match requested chapters", () => {
    const contract = buildWriteIntentContract({
      taskId: "task-write-target-mismatch",
      userRequest: "直接写前三章",
      chapterNos: [1, 2, 3],
    });
    const trace: ExecutionTrace = {
      taskId: "task-write-target-mismatch",
      mode: "low_risk_auto",
      policy: makeWritePolicy({
        taskId: "task-write-target-mismatch",
        chapterNos: [1, 2, 3],
      }),
      steps: [1, 1, 1].map((chapterNo, index) => ({
        id: `step-${index + 1}`,
        actionType: "multi_chapter_write",
        riskLevel: "bulk_write",
        status: "succeeded",
        argsSummary: `chapterNo=${chapterNo}`,
        verification: {
          method: "read_back",
          passed: true,
          detail: `Chapter ${chapterNo} was read back after persistence.`,
        },
      })),
      finalStatus: "succeeded",
    };

    const report = makeAcceptanceReport({ contract, trace });

    expect(report.verdict).toBe("fail");
    expect(report.userCriteria).toContainEqual({
      criterion: "There are 3 successful chapter write steps",
      status: "fail",
      evidence: "Expected verified chapter write targets [1, 2, 3], found [1].",
    });
    expect(report.userCriteria).toContainEqual({
      criterion: "Read-back verifies every target chapter",
      status: "fail",
      evidence: "Expected read-back verification for chapter targets [1, 2, 3], found [1].",
    });
  });

  it("passes acceptance when verified write targets match requested chapters", () => {
    const contract = buildWriteIntentContract({
      taskId: "task-write-target-match",
      userRequest: "直接写前三章",
      chapterNos: [1, 2, 3],
    });
    const trace: ExecutionTrace = {
      taskId: "task-write-target-match",
      mode: "low_risk_auto",
      policy: makeWritePolicy({
        taskId: "task-write-target-match",
        chapterNos: [1, 2, 3],
      }),
      steps: [1, 2, 3].map(chapterNo => ({
        id: `step-${chapterNo}`,
        actionType: "multi_chapter_write",
        riskLevel: "bulk_write",
        status: "succeeded",
        argsSummary: `chapterNo=${chapterNo}`,
        verification: {
          method: "read_back",
          passed: true,
          detail: `Chapter ${chapterNo} was read back after persistence.`,
        },
      })),
      finalStatus: "succeeded",
    };

    const report = makeAcceptanceReport({ contract, trace });

    expect(report.verdict).toBe("pass");
    expect(report.userCriteria.every(criterion => criterion.status === "pass")).toBe(true);
  });

  it("fails acceptance when requested chapter writes are partial", () => {
    const contract = buildWriteIntentContract({
      taskId: "task-write-3",
      userRequest: "鐩存帴鍐欏墠涓夌珷",
      chapterNos: [1, 2, 3],
    });
    const trace: ExecutionTrace = {
      taskId: "task-write-3",
      mode: "low_risk_auto",
      policy: makeWritePolicy({ taskId: "task-write-3", chapterNos: [1, 2, 3] }),
      steps: [
        {
          id: "step-1",
          actionType: "multi_chapter_write",
          riskLevel: "bulk_write",
          status: "succeeded",
          verification: {
            method: "read_back",
            passed: true,
            detail: "Chapter 1 was read back after persistence.",
          },
        },
      ],
      finalStatus: "succeeded",
    };

    const report = makeAcceptanceReport({ contract, trace });

    expect(report.verdict).toBe("fail");
    expect(report.userCriteria).toContainEqual({
      criterion: "There are 3 successful chapter write steps",
      status: "fail",
      evidence: "Expected 3 verified chapter write steps, found 1.",
    });
    expect(report.recommendedActions).toEqual([
      { type: "stop", reason: "workflow criteria failed" },
    ]);
  });

  it("fails acceptance and recommends stop when read-back verification fails", () => {
    const contract = buildWriteIntentContract({
      taskId: "task-write-verify",
      userRequest: "鐩存帴鍐欑涓€绔",
      chapterNos: [1],
    });
    const trace: ExecutionTrace = {
      taskId: "task-write-verify",
      mode: "low_risk_auto",
      policy: makeWritePolicy({ taskId: "task-write-verify", chapterNos: [1] }),
      steps: [
        {
          id: "step-1",
          actionType: "chapter_write",
          riskLevel: "write",
          status: "succeeded",
          verification: {
            method: "read_back",
            passed: false,
            detail: "Chapter 1 read-back did not match persisted output.",
          },
        },
      ],
      finalStatus: "succeeded",
    };

    const report = makeAcceptanceReport({ contract, trace });

    expect(report.verdict).toBe("fail");
    expect(report.userCriteria).toContainEqual({
      criterion: "Read-back verifies every target chapter",
      status: "fail",
      evidence: "Expected read-back verification for 1 chapter write step, found 0.",
    });
    expect(report.recommendedActions).toEqual([
      { type: "stop", reason: "workflow criteria failed" },
    ]);
  });

  it("marks failed final status as a failed process criterion", () => {
    const contract = buildWriteIntentContract({
      taskId: "task-write-failed",
      userRequest: "鐩存帴鍐欑涓€绔",
      chapterNos: [1],
    });
    const trace: ExecutionTrace = {
      taskId: "task-write-failed",
      mode: "low_risk_auto",
      policy: makeWritePolicy({ taskId: "task-write-failed", chapterNos: [1] }),
      steps: [
        {
          id: "step-1",
          actionType: "chapter_write",
          riskLevel: "write",
          status: "succeeded",
          verification: {
            method: "read_back",
            passed: true,
            detail: "Chapter 1 was read back after persistence.",
          },
        },
      ],
      finalStatus: "failed",
    };

    const report = makeAcceptanceReport({ contract, trace });

    expect(report.verdict).toBe("fail");
    expect(report.processCriteria).toContainEqual({
      criterion: "Workflow final status is succeeded",
      status: "fail",
      evidence: "Trace final status is failed.",
    });
  });

  it("preserves the shared low_risk_auto default when write policy mode is omitted", () => {
    const policy = makeWritePolicy({
      taskId: "task-write-default-mode",
      chapterNos: [1],
    });

    expect(policy.configuredMode).toBe("low_risk_auto");
    expect(policy.effectiveMode).toBe("confirm");
    expect(policy.requiresConfirmation).toBe(true);
  });
});
