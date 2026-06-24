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
    expect(contract.acceptanceCriteria).toContain("There are 3 successful chapter version steps");
  });

  it("creates staged chapter version actions without legacy state-recording actions", () => {
    const steps = makeExecutionSteps(makeWriteActions([1, 2, 3]));

    expect(steps.map(step => step.actionType)).toEqual([
      "chapter_version",
      "chapter_version",
      "chapter_version",
    ]);
    expect(steps.map(step => step.argsSummary)).toEqual([
      "chapterNo=1",
      "chapterNo=2",
      "chapterNo=3",
    ]);
    expect(steps.map(step => step.riskLevel)).toEqual(["write", "write", "write"]);
  });

  it("passes acceptance when every requested chapter version is verified", () => {
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
        actionType: "chapter_version",
        riskLevel: "write",
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

  it("fails acceptance when verified chapter targets do not match the request", () => {
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
        actionType: "chapter_version",
        riskLevel: "write",
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
      criterion: "There are 3 successful chapter version steps",
      status: "fail",
      evidence: "Expected verified chapter targets [1, 2, 3], found [1].",
    });
  });

  it("marks successful requested versions with failed follow-up work as repairable", () => {
    const contract = buildWriteIntentContract({
      taskId: "task-write-repairable",
      userRequest: "write next chapter",
      chapterNos: [1],
    });
    const trace: ExecutionTrace = {
      taskId: "task-write-repairable",
      mode: "trusted_auto",
      policy: makeWritePolicy({ taskId: "task-write-repairable", mode: "trusted_auto", chapterNos: [1] }),
      steps: [
        {
          id: "step-1",
          actionType: "chapter_version",
          riskLevel: "write",
          status: "succeeded",
          argsSummary: "chapterNo=1",
          verification: {
            method: "read_back",
            passed: true,
            detail: "Chapter 1 read back after write.",
          },
        },
        {
          id: "step-2",
          actionType: "chapter_summary",
          riskLevel: "write",
          status: "failed",
          argsSummary: "chapterNo=1",
          verification: {
            method: "state_compare",
            passed: false,
            detail: "Chapter 1 summary did not complete.",
          },
        },
      ],
      finalStatus: "failed",
    };

    const report = makeAcceptanceReport({ contract, trace });

    expect(report.verdict).toBe("repairable");
    expect(report.userCriteria.every(criterion => criterion.status === "pass")).toBe(true);
    expect(report.recommendedActions).toEqual([
      { type: "auto_repair", reason: "requested chapter versions passed; follow-up workflow work failed" },
    ]);
  });
});
