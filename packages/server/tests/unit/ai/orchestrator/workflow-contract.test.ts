import { describe, expect, it } from "vitest";
import type { ExecutionTrace } from "@scribe/shared";
import {
  buildWriteIntentContract,
  makeAcceptanceReport,
  makeExecutionSteps,
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
});
