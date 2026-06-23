import { describe, expect, it } from "vitest";
import { pickWriteBudget } from "../../../../src/ai/context-builder/budget-profile.js";

describe("pickWriteBudget", () => {
  it.each([
    [1_000_000, 400_000],
    [500_000, 400_000],
    [200_000, 80_000],
    [100_000, 32_000],
    [64_000, 32_000],
    [32_000, 16_000],
    [undefined, 32_000],
  ])("contextWindow=%s → %s", (ctx, expected) => {
    expect(pickWriteBudget(ctx)).toBe(expected);
  });
});
