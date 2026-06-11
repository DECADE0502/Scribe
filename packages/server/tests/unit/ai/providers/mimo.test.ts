import { describe, it, expect } from "vitest";
import { MiMoProvider } from "../../../../src/ai/providers/mimo.js";
import { deepseekMetadataExtractor, readDeepSeekUsage } from "../../../../src/ai/providers/deepseek-metadata.js";

describe("MiMoProvider", () => {
  it("用 api-key 头鉴权(非 Bearer),baseUrl 默认 cn 集群", async () => {
    let captured: { url: string; headers: any } | undefined;
    const fakeFetch = (async (url: any, init: any) => {
      captured = { url: String(url), headers: init?.headers ?? {} };
      return { ok: true, json: async () => ({ data: [{ id: "mimo-v2.5-pro", owned_by: "xiaomi" }] }) } as any;
    }) as unknown as typeof fetch;

    const p = new MiMoProvider({ apiKey: "tp-abc123", fetchImpl: fakeFetch });
    const models = await p.listModels();
    expect(models.map((m) => m.id)).toContain("mimo-v2.5-pro");
    expect(captured!.url).toBe("https://token-plan-cn.xiaomimimo.com/v1/models");
    expect(captured!.headers["api-key"]).toBe("tp-abc123");
    expect(captured!.headers["Authorization"]).toBeUndefined();
  });

  it("集群可切换", () => {
    const sgp = new MiMoProvider({ apiKey: "tp-x", cluster: "sgp" });
    expect((sgp as any).baseUrl).toBe("https://token-plan-sgp.xiaomimimo.com");
  });

  it("401/invalid key → auth 错误", () => {
    const p = new MiMoProvider({ apiKey: "tp-x" });
    expect(p.classifyError({ message: "Invalid API Key", status: 401 })).toBe("auth");
    expect(p.classifyError({ message: "terminated" })).toBe("stream_idle");
  });
});

describe("用量抽取兼容 MiMo 标准字段", () => {
  it("读取 prompt_tokens_details.cached_tokens 与 reasoning_tokens", () => {
    const md = deepseekMetadataExtractor.extractMetadata({
      parsedBody: {
        usage: {
          prompt_tokens: 258,
          prompt_tokens_details: { cached_tokens: 192 },
          completion_tokens: 120,
          completion_tokens_details: { reasoning_tokens: 93 },
        },
      },
    });
    expect(readDeepSeekUsage(md)).toEqual({ cachedPromptTokens: 192, reasoningTokens: 93 });
  });
});
