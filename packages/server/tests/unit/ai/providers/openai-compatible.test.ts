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
  it("classifyError 默认 unknown", () => {
    const p = new OpenAICompatibleProvider({ id: "x", baseUrl: "u", apiKey: "k" });
    expect(p.classifyError(new Error("?"))).toBe("unknown");
  });
});
