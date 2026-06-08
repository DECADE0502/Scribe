import { describe, it, expect } from "vitest";
import {
  estimateTokens,
  fitWithinBudget,
  defaultTruncate,
} from "../../../../src/ai/context-builder/budget.js";

describe("estimateTokens", () => {
  it("纯中文 100 字 ≈ 150 tokens", () => {
    const t = estimateTokens("中".repeat(100));
    expect(t).toBeGreaterThan(140);
    expect(t).toBeLessThan(160);
  });

  it("中英混合非负", () => {
    expect(estimateTokens("你好world hello")).toBeGreaterThan(0);
  });

  it("空字符串返回 0", () => {
    expect(estimateTokens("")).toBe(0);
  });
});

describe("fitWithinBudget", () => {
  it("按优先级保留", () => {
    const sections = [
      { id: "rules", priority: 100, text: "规".repeat(100) }, // ~150 tk
      { id: "characters", priority: 90, text: "人".repeat(200) }, // ~300 tk
      { id: "recall", priority: 50, text: "回".repeat(400) }, // ~600 tk
    ];
    const r = fitWithinBudget(sections, { budgetTokens: 600 });
    expect(r.kept.find((s) => s.id === "rules")).toBeTruthy();
    expect(r.dropped.length).toBeGreaterThanOrEqual(1);
  });

  it("无 truncate 时, 超预算的整段被丢弃", () => {
    const r = fitWithinBudget(
      [{ id: "a", priority: 100, text: "中".repeat(1000) }],
      { budgetTokens: 100 }
    );
    expect(r.kept).toHaveLength(0);
    expect(r.dropped).toHaveLength(1);
  });

  it("有 truncate 且剩余预算 > 200 时, 裁剪保留", () => {
    const r = fitWithinBudget(
      [{ id: "a", priority: 100, text: "中".repeat(2000) }],
      { budgetTokens: 1000, truncate: defaultTruncate }
    );
    expect(r.kept).toHaveLength(1);
    expect(r.kept[0]!.text.length).toBeLessThan(2000 + 30);
    expect(r.usedTokens).toBeLessThanOrEqual(1000);
  });

  it("保持优先级顺序 (高 priority 优先放入)", () => {
    const r = fitWithinBudget(
      [
        { id: "low", priority: 50, text: "低" },
        { id: "high", priority: 99, text: "高" },
        { id: "mid", priority: 70, text: "中" },
      ],
      { budgetTokens: 1000 }
    );
    // sorted 内部 high → mid → low
    expect(r.kept.map((s) => s.id)).toEqual(["high", "mid", "low"]);
  });
});

describe("defaultTruncate", () => {
  it("追加省略提示", () => {
    const s = { id: "x", priority: 100, text: "正".repeat(1000) };
    const r = defaultTruncate(s, 100);
    expect(r.text).toContain("…(因预算截断)");
    expect(r.text.length).toBeLessThan(s.text.length);
  });

  it("text 已在预算内时原样返回", () => {
    const s = { id: "x", priority: 100, text: "短" };
    const r = defaultTruncate(s, 1000);
    expect(r.text).toBe("短");
  });
});
