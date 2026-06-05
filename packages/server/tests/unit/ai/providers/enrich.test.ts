import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  enrichFromOpenRouter,
  _resetEnrichCache,
} from "../../../../src/ai/providers/enrich-from-openrouter.js";
import { lookupLocal } from "../../../../src/ai/providers/local-model-table.js";

beforeEach(() => _resetEnrichCache());

describe("enrichFromOpenRouter", () => {
  it("命中后填充 contextWindow / pricing / supportsTools", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            id: "deepseek/deepseek-v4-pro",
            context_length: 128000,
            supported_parameters: ["tools", "temperature"],
            pricing: { prompt: "0.00000027", completion: "0.0000011" },
          },
        ],
      }),
    });
    const r = await enrichFromOpenRouter("deepseek-v4-pro", fetchMock as any);
    expect(r.contextWindow).toBe(128000);
    expect(r.supportsTools).toBe(true);
    expect(r.pricing?.input).toBeCloseTo(0.27, 1);
    expect(r.pricing?.output).toBeCloseTo(1.1, 1);
  });
  it("fetch 失败时返回空对象不抛", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("net"));
    const r = await enrichFromOpenRouter("deepseek-v4-pro", fetchMock as any);
    expect(r).toEqual({});
  });
  it("fetch 返回 503 时不毒化 cache,下次重试", async () => {
    let n = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      n++;
      if (n === 1)
        return { ok: false, status: 503, json: async () => ({ error: "rate limit" }) };
      return {
        ok: true,
        json: async () => ({
          data: [
            {
              id: "ds/deepseek-v4-pro",
              context_length: 128000,
              supported_parameters: ["tools"],
              pricing: { prompt: "0.00000027", completion: "0.0000011" },
            },
          ],
        }),
      };
    });
    const r1 = await enrichFromOpenRouter("deepseek-v4-pro", fetchMock as any);
    expect(r1).toEqual({});
    const r2 = await enrichFromOpenRouter("deepseek-v4-pro", fetchMock as any);
    expect(r2.contextWindow).toBe(128000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("fetch 返回 ok 但 data 字段缺失,缓存空 Map 不重试", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    const r1 = await enrichFromOpenRouter("deepseek-v4-pro", fetchMock as any);
    expect(r1).toEqual({});
    const r2 = await enrichFromOpenRouter("deepseek-v4-pro", fetchMock as any);
    expect(r2).toEqual({});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("lookupLocal", () => {
  it("DS v4 pro 在表里", () => {
    expect(lookupLocal("deepseek-v4-pro")?.contextWindow).toBe(128000);
  });
  it("未知 model 返回 undefined", () => {
    expect(lookupLocal("unknown-model")).toBeUndefined();
  });
});
