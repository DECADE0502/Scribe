import { describe, expect, it } from "vitest";
import {
  ExecutionPolicySchema,
  ExecutionModeWithDefaultSchema,
  buildExecutionPolicy,
  classifyActionRisk,
} from "../src/types/agent-workflow.js";
import { SseEventSchema } from "../src/types/sse-events.js";

describe("agent workflow execution policy", () => {
  it("defaults missing execution mode to low risk auto", () => {
    expect(ExecutionModeWithDefaultSchema.parse(undefined)).toBe("low_risk_auto");
  });

  it("uses low risk auto policy when configured mode is omitted", () => {
    const policy = buildExecutionPolicy({
      taskId: "task-default",
      actions: [{ type: "chapter_write" }],
    });

    expect(policy.configuredMode).toBe("low_risk_auto");
    expect(policy.effectiveMode).toBe("confirm");
  });

  it("requires confirmation for chapter writes in low risk auto mode", () => {
    const policy = buildExecutionPolicy({
      taskId: "task-1",
      configuredMode: "low_risk_auto",
      actions: [{ type: "chapter_write" }],
    });

    expect(policy).toEqual({
      taskId: "task-1",
      configuredMode: "low_risk_auto",
      effectiveMode: "confirm",
      highestRisk: "write",
      requiresConfirmation: true,
      reason: "low_risk_auto requires confirmation for write actions",
      userChoices: ["approve", "edit_plan", "reroll", "cancel"],
    });
    expect(ExecutionPolicySchema.parse(policy)).toEqual(policy);
  });

  it("auto-runs read and hidden draft work in low risk auto mode", () => {
    const policy = buildExecutionPolicy({
      taskId: "task-2",
      configuredMode: "low_risk_auto",
      actions: [{ type: "list_characters" }, { type: "hidden_draft" }],
    });

    expect(policy.effectiveMode).toBe("auto");
    expect(policy.requiresConfirmation).toBe(false);
    expect(policy.highestRisk).toBe("draft");
  });

  it("blocks workspace mutations in plan only mode", () => {
    const policy = buildExecutionPolicy({
      taskId: "task-3",
      configuredMode: "plan_only",
      actions: [{ type: "update_character" }],
    });

    expect(policy.effectiveMode).toBe("blocked");
    expect(policy.requiresConfirmation).toBe(false);
    expect(policy.reason).toContain("plan_only");
  });

  it("requires confirmation for destructive work in trusted auto mode", () => {
    const policy = buildExecutionPolicy({
      taskId: "task-4",
      configuredMode: "trusted_auto",
      actions: [{ type: "delete_character" }],
    });

    expect(policy.highestRisk).toBe("destructive");
    expect(policy.effectiveMode).toBe("confirm");
    expect(policy.requiresConfirmation).toBe(true);
  });
});

describe("classifyActionRisk", () => {
  it.each([
    ["list_outline", "read"],
    ["hidden_draft", "draft"],
    ["update_character", "write"],
    ["write_three_chapters", "bulk_write"],
    ["delete_outline_node", "destructive"],
  ] as const)("classifies %s as %s", (actionType, risk) => {
    expect(classifyActionRisk(actionType)).toBe(risk);
  });

  it("uses risk hints when provided", () => {
    expect(classifyActionRisk("list_outline", "destructive")).toBe("destructive");
  });
});

describe("workflow SSE events", () => {
  it("parses execution plans with pending workflow steps", () => {
    const policy = buildExecutionPolicy({
      taskId: "task-sse-plan",
      actions: [{ type: "chapter_write" }],
    });
    const event = {
      type: "execution_plan",
      taskId: "task-sse-plan",
      policy,
      steps: [
        {
          id: "step-1",
          actionType: "chapter_write",
          riskLevel: "write",
          status: "pending",
        },
      ],
    };

    expect(SseEventSchema.parse(event)).toEqual(event);
  });

  it("parses acceptance reports", () => {
    const event = {
      type: "acceptance_report",
      report: {
        taskId: "task-sse-report",
        verdict: "pass",
        userCriteria: [
          {
            criterion: "Draft matches requested chapter beat",
            status: "pass",
            evidence: "Chapter beat was verified in the draft.",
          },
        ],
        processCriteria: [],
        domainCriteria: [],
        recommendedActions: [],
      },
    };

    expect(SseEventSchema.parse(event)).toEqual(event);
  });
});
