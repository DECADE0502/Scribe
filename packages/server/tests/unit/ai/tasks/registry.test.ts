import { describe, expect, it } from "vitest";
import { resolveTask } from "../../../../src/ai/tasks/registry.js";

describe("resolveTask", () => {
  it.each([
    ["editor", "write-chapter"],
    ["revision", "revise"],
    ["onboard", "onboard"],
    ["asset_audit", "audit"],
    ["chat", "chat"],
    ["auto", "chat"],
  ])("source %s → %s", (source, expected) => {
    const t = resolveTask({ message: "x", source: source as any });
    expect(t.name).toBe(expected);
  });

  it("asset_audit 每次解析返回全新实例(隔离 audit state)", () => {
    const a = resolveTask({ message: "x", source: "asset_audit" as any });
    const b = resolveTask({ message: "x", source: "asset_audit" as any });
    expect(a).not.toBe(b);           // 不同实例
    expect(a.name).toBe("audit");
    expect(b.name).toBe("audit");
  });

  it("chat 等无状态任务返回单例(不必新建)", () => {
    const a = resolveTask({ message: "x", source: "chat" as any });
    const b = resolveTask({ message: "x", source: "chat" as any });
    expect(a).toBe(b);
  });
});
