import { describe, expect, it } from "vitest";
import {
  AgentRunRequestSchema,
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
      actions: [{ type: "chapter_version" }],
    });

    expect(policy.configuredMode).toBe("low_risk_auto");
    expect(policy.effectiveMode).toBe("confirm");
  });

  it("requires confirmation for chapter writes in low risk auto mode", () => {
    const policy = buildExecutionPolicy({
      taskId: "task-1",
      configuredMode: "low_risk_auto",
      actions: [{ type: "chapter_version" }],
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
  it.each([
    { type: "text_delta", delta: "legacy prose" },
    { type: "tool_call_start", toolName: "chapter_version" },
    { type: "tool_call_end", toolName: "record_chapter_state", result: {} },
    { type: "auto_status", state: "writing", remaining: 1, doneChapters: [] },
    { type: "workflow_mode", mode: "low_risk_auto" },
    { type: "execution_step", stepId: "s1", status: "running" },
    { type: "acceptance_report", report: {} },
  ])("rejects legacy SSE event $type from the canonical agent protocol", (event) => {
    expect(() => SseEventSchema.parse(event)).toThrow();
  });

  it("parses canonical agent progress events", () => {
    const event = {
      type: "agent_progress",
      runId: "run-1",
      phase: "executing",
      label: "执行变更",
      status: "running",
    };

    expect(SseEventSchema.parse(event)).toEqual(event);
  });
});
describe("AgentRunRequestSchema", () => {
  it("accepts structured editor mode instead of relying on command text", () => {
    const parsed = AgentRunRequestSchema.parse({
      message: "鎸夋湰绔犲ぇ绾插啓锛屼繚鎸佺涓€浜虹О",
      source: "editor",
      target: { chapterNo: 2, mode: "write" },
    });

    expect(parsed.target?.mode).toBe("write");
  });

  it("rejects finalize as a user-facing editor mode", () => {
    expect(() => AgentRunRequestSchema.parse({
      message: "确认本章",
      source: "editor",
      target: { chapterNo: 2, mode: "finalize" },
    })).toThrow();
  });
  it("accepts structured full asset audit scope", () => {
    const parsed = AgentRunRequestSchema.parse({
      message: "触发主动审查",
      source: "asset_audit",
      target: {
        auditScope: {
          assets: ["characters", "outline", "worldbook", "timeline", "foreshadowing"],
          mode: "report_and_fix",
        },
      },
    });

    expect(parsed.target?.auditScope?.assets).toContain("characters");
  });

  it("accepts default chapter length for auto writing", () => {
    const parsed = AgentRunRequestSchema.parse({
      message: "写五章",
      source: "auto",
      target: {
        chapterCount: 5,
        defaultChapterLength: "medium",
      },
    });

    expect(parsed.target?.defaultChapterLength).toBe("medium");
  });
});

