import { describe, expect, it } from "vitest";
import { SseEventSchema } from "../src/types/sse-events.js";

describe("SseEventSchema", () => {
  it("接受 4 种新事件 + usage", () => {
    for (const ev of [
      { type: "usage", promptTokens: 1, completionTokens: 2 },
      { type: "text_delta", delta: "你好" },
      { type: "done", committed: true },
      { type: "error", errorClass: "stream_failed", message: "boom" },
    ]) expect(SseEventSchema.safeParse(ev).success).toBe(true);
  });

  it("拒绝旧 agent 事件(证明已删除)", () => {
    for (const ev of [
      { type: "main_output", reply: "x" },
      { type: "validation_report", verdict: "pass", issues: [], commitAllowed: true },
      { type: "repair_plan", steps: [], summary: "" },
      { type: "agent_phase", phase: "thinking" },
      { type: "agent_progress", phase: "thinking", label: "x", status: "pending" },
    ]) expect(SseEventSchema.safeParse(ev).success).toBe(false);
  });
});
