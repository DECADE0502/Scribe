import { describe, it, expect, vi } from "vitest";
import { createUsageTracker, withUsageRecording } from "../../../src/ai/usage-tracker.js";
import type { ModelInfo, SseEvent } from "@scribe/shared";

async function* gen(...evs: SseEvent[]): AsyncIterable<SseEvent> { for (const e of evs) yield e; }
async function drain(it: AsyncIterable<unknown>) { for await (const _ of it) { /* consume */ } }

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

describe("withUsageRecording(全量、按事件分类与定价)", () => {
  const write: ModelInfo = { id: "claude-write", pricing: { input: 3, output: 15 } };
  const audit: ModelInfo = { id: "claude-audit", pricing: { input: 1, output: 5 } };

  it("按 modelRole 选模型定价、按事件 taskType 分类、带上 chapterNo", async () => {
    const rec = vi.fn();
    const addCost = vi.fn();
    await drain(withUsageRecording(
      gen(
        { type: "usage", promptTokens: 1_000_000, completionTokens: 0, modelRole: "write", taskType: "write", chapterNo: 3 } as any,
        { type: "usage", promptTokens: 1_000_000, completionTokens: 0, modelRole: "audit", taskType: "audit", chapterNo: 3 } as any,
      ),
      { tokenUsageRepo: { record: rec } as any, booksRepo: { addCost } as any, bookId: "b1", modelInfo: write, auditModelInfo: audit, taskType: "chat" },
    ));
    expect(rec.mock.calls[0]![0]).toMatchObject({ taskType: "write", model: "claude-write", costUsd: 3, chapterNo: 3 });
    expect(rec.mock.calls[1]![0]).toMatchObject({ taskType: "audit", model: "claude-audit", costUsd: 1, chapterNo: 3 });
  });

  it("缺 modelInfo 仍记 token,model=unknown,费用 0(此前会漏记)", async () => {
    const rec = vi.fn();
    await drain(withUsageRecording(
      gen({ type: "usage", promptTokens: 500, completionTokens: 200 } as any),
      { tokenUsageRepo: { record: rec } as any, booksRepo: { addCost: vi.fn() } as any, bookId: "b1", modelInfo: undefined, taskType: "chat" },
    ));
    expect(rec.mock.calls[0]![0]).toMatchObject({ taskType: "chat", model: "unknown", promptTokens: 500, completionTokens: 200, costUsd: 0 });
  });
});
