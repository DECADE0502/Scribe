import { describe, expect, it } from "vitest";
import {
  AgentRunRequestSchema,
  ExecutionModeWithDefaultSchema,
} from "../src/types/agent-workflow.js";

describe("agent workflow execution mode", () => {
  it("defaults missing execution mode to low risk auto", () => {
    expect(ExecutionModeWithDefaultSchema.parse(undefined)).toBe("low_risk_auto");
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

