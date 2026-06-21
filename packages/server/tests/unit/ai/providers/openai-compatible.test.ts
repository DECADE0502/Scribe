import { describe, it, expect, vi } from "vitest";
import { OpenAICompatibleProvider } from "../../../../src/ai/providers/openai-compatible.js";

describe("OpenAICompatibleProvider", () => {
  it("listModels 命中 /v1/models", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "deepseek-v4-pro", owned_by: "deepseek" }] }),
    });
    const p = new OpenAICompatibleProvider({
      id: "deepseek",
      baseUrl: "https://api.deepseek.com",
      apiKey: "sk-x",
      fetchImpl: fetchMock as any,
    });
    const models = await p.listModels();
    expect(models[0]?.id).toBe("deepseek-v4-pro");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.deepseek.com/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer sk-x" }),
      }),
    );
  });
  it("无 apiKey 抛错", () => {
    expect(() => new OpenAICompatibleProvider({ id: "x", baseUrl: "u", apiKey: "" })).toThrow();
  });
  it("listModels fetch errors include the requested URL and cause", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed", {
      cause: new Error("connect ETIMEDOUT"),
    }));
    const p = new OpenAICompatibleProvider({
      id: "x",
      baseUrl: "https://proxy.example.com",
      apiKey: "sk-x",
      fetchImpl: fetchMock as any,
    });

    await expect(p.listModels()).rejects.toThrow(/https:\/\/proxy\.example\.com\/v1\/models/);
    await expect(p.listModels()).rejects.toThrow(/connect ETIMEDOUT/);
  });
  it("classifyError 默认 unknown", () => {
    const p = new OpenAICompatibleProvider({ id: "x", baseUrl: "u", apiKey: "k" });
    expect(p.classifyError(new Error("?"))).toBe("unknown");
  });

  it("enrichModel 三档兜底:provider → OpenRouter → 本地表(前档优先)", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("api.deepseek.com")) {
        return {
          ok: true,
          json: async () => ({ data: [{ id: "deepseek-v4-pro", owned_by: "deepseek" }] }),
        };
      }
      if (url.includes("openrouter.ai")) {
        return {
          ok: true,
          json: async () => ({
            data: [
              {
                id: "deepseek/deepseek-v4-pro",
                context_length: 999_999,
                supported_parameters: [],
                pricing: { prompt: "0.000001", completion: "0.000005" },
              },
            ],
          }),
        };
      }
      return { ok: false, json: async () => ({}) };
    });
    const { _resetEnrichCache } = await import(
      "../../../../src/ai/providers/enrich-from-openrouter.js"
    );
    _resetEnrichCache();
    const p = new OpenAICompatibleProvider({
      id: "deepseek",
      baseUrl: "https://api.deepseek.com",
      apiKey: "sk-x",
      fetchImpl: fetchMock as any,
    });
    const info = await p.enrichModel("deepseek-v4-pro");
    expect(info.id).toBe("deepseek-v4-pro");
    // ownedBy 来自 provider(第一档独有)
    expect(info.ownedBy).toBe("deepseek");
    // contextWindow:provider 没返,OpenRouter 填 999999(覆盖本地表 128000)
    expect(info.contextWindow).toBe(999_999);
    // pricing:OpenRouter 填(优先于本地表)
    expect(info.pricing?.input).toBeCloseTo(1.0, 1);
    expect(info.pricing?.output).toBeCloseTo(5.0, 1);
    // supportsTools:OpenRouter 填 false(数组不含 tools),优先于本地表 true
    expect(info.supportsTools).toBe(false);
    // supportsReasoning:provider/OpenRouter 都没,本地表填 true
    expect(info.supportsReasoning).toBe(true);
  });
});
