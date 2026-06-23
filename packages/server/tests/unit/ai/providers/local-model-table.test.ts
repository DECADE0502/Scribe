import { describe, expect, it } from "vitest";
import { lookupLocal } from "../../../../src/ai/providers/local-model-table.js";

describe("lookupLocal [1m] 后缀", () => {
  it("普通 id 返回基础条目", () => {
    expect(lookupLocal("claude-opus-4-7")?.contextWindow).toBe(200_000);
  });
  it("[1m] 后缀强制 contextWindow=1_000_000", () => {
    const info = lookupLocal("claude-opus-4-7[1m]");
    expect(info?.contextWindow).toBe(1_000_000);
    expect(info?.supportsTools).toBe(true); // 继承基础条目
  });
  it("基础条目不存在的 [1m] id 也返回 contextWindow=1_000_000", () => {
    const info = lookupLocal("unknown-model[1m]");
    expect(info?.contextWindow).toBe(1_000_000);
  });
  it("未知 id 返回 undefined", () => {
    expect(lookupLocal("totally-unknown")).toBeUndefined();
  });
});
