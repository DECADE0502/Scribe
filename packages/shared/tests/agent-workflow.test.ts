import { describe, expect, it } from "vitest";
import {
  ExecutionPolicySchema,
  buildExecutionPolicy,
  classifyActionRisk,
} from "../src/types/agent-workflow.js";

describe("agent workflow execution policy", () => {
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
