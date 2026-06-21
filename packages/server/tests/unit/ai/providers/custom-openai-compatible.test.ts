import { describe, expect, it, vi } from "vitest";
import { CustomOpenAICompatibleProvider } from "../../../../src/ai/providers/custom-openai-compatible.js";

describe("CustomOpenAICompatibleProvider", () => {
  it("uses Bearer auth and does not duplicate /v1 when listing models", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "gemini-2.5-pro", owned_by: "proxy" }] }),
    });
    const provider = new CustomOpenAICompatibleProvider({
      id: "xiongmao",
      baseUrl: "https://api520.pro/v1",
      apiKey: "sk-test",
      auth: "bearer",
      fetchImpl: fetchMock as any,
    });

    const models = await provider.listModels();

    expect(models).toEqual([{ id: "gemini-2.5-pro", ownedBy: "proxy" }]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api520.pro/v1/models",
      expect.objectContaining({
        headers: { Authorization: "Bearer sk-test" },
      }),
    );
  });

  it("uses api-key auth only when explicitly selected", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    });
    const provider = new CustomOpenAICompatibleProvider({
      id: "legacy",
      baseUrl: "https://legacy.example.com",
      apiKey: "sk-test",
      auth: "api-key",
      fetchImpl: fetchMock as any,
    });

    await provider.listModels();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://legacy.example.com/v1/models",
      expect.objectContaining({
        headers: { "api-key": "sk-test" },
      }),
    );
  });
});
