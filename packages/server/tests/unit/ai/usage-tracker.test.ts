import { describe, it, expect, vi } from "vitest";
import { createUsageTracker } from "../../../src/ai/usage-tracker.js";
import type { ModelInfo } from "@scribe/shared";

describe("createUsageTracker", () => {
  const dsPro: ModelInfo = {
    id: "deepseek-v4-pro",
    pricing: { input: 0.27, output: 1.1, cachedInput: 0.07 },
  };
  it("record 写 token_usage 并按价格折 USD,加到 books.total_cost_usd", async () => {
    const tokenUsageRepo = { record: vi.fn() };
    const booksRepo = { addCost: vi.fn() };
    const t = createUsageTracker({
      tokenUsageRepo: tokenUsageRepo as any,
      booksRepo: booksRepo as any,
    });

    await t.record({
      bookId: "b1",
      taskType: "write",
      model: dsPro,
      promptTokens: 1_000_000,
      completionTokens: 0,
      cachedTokens: 0,
      reasoningTokens: 0,
    });

    expect(tokenUsageRepo.record).toHaveBeenCalledWith(
      expect.objectContaining({
        taskType: "write",
        model: "deepseek-v4-pro",
        promptTokens: 1_000_000,
        costUsd: expect.any(Number),
      }),
    );
    const recorded = tokenUsageRepo.record.mock.calls[0]![0];
    expect(recorded.costUsd).toBeCloseTo(0.27, 5);
    expect(booksRepo.addCost).toHaveBeenCalledWith("b1", expect.any(Number));
    expect(booksRepo.addCost.mock.calls[0]![1]).toBeCloseTo(0.27, 5);
  });

  it("有 cachedTokens 时按 cachedInput 价位计算,不重复算到 prompt", async () => {
    const tokenUsageRepo = { record: vi.fn() };
    const booksRepo = { addCost: vi.fn() };
    const t = createUsageTracker({
      tokenUsageRepo: tokenUsageRepo as any,
      booksRepo: booksRepo as any,
    });
    await t.record({
      bookId: "b1",
      taskType: "audit",
      model: dsPro,
      promptTokens: 1_000_000,
      completionTokens: 0,
      cachedTokens: 500_000,
      reasoningTokens: 0,
    });
    // (1M - 500k) * 0.27 + 500k * 0.07 = 0.135 + 0.035 = 0.17
    expect(tokenUsageRepo.record.mock.calls[0]![0].costUsd).toBeCloseTo(0.17, 5);
  });

  it("model 没 pricing 时 cost = 0", async () => {
    const tokenUsageRepo = { record: vi.fn() };
    const booksRepo = { addCost: vi.fn() };
    const t = createUsageTracker({
      tokenUsageRepo: tokenUsageRepo as any,
      booksRepo: booksRepo as any,
    });
    await t.record({
      bookId: "b1",
      taskType: "write",
      model: { id: "unknown" } as ModelInfo,
      promptTokens: 1000,
      completionTokens: 1000,
      cachedTokens: 0,
      reasoningTokens: 0,
    });
    expect(tokenUsageRepo.record.mock.calls[0]![0].costUsd).toBe(0);
    expect(booksRepo.addCost.mock.calls[0]![1]).toBe(0);
  });
});
