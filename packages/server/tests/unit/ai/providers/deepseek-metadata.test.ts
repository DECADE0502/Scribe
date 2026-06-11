import { describe, it, expect } from "vitest";
import {
  deepseekMetadataExtractor,
  readDeepSeekUsage,
} from "../../../../src/ai/providers/deepseek-metadata.js";

describe("deepseekMetadataExtractor", () => {
  it("非流式:从 parsedBody 提取缓存命中与 reasoning token", () => {
    const md = deepseekMetadataExtractor.extractMetadata({
      parsedBody: {
        usage: {
          prompt_tokens: 1000,
          prompt_cache_hit_tokens: 768,
          completion_tokens: 500,
          completion_tokens_details: { reasoning_tokens: 320 },
        },
      },
    });
    expect(readDeepSeekUsage(md)).toEqual({ cachedPromptTokens: 768, reasoningTokens: 320 });
  });

  it("无缓存/无 reasoning 时返回 undefined(不污染 providerMetadata)", () => {
    const md = deepseekMetadataExtractor.extractMetadata({
      parsedBody: { usage: { prompt_tokens: 10, completion_tokens: 5 } },
    });
    expect(md).toBeUndefined();
    expect(readDeepSeekUsage(md)).toEqual({ cachedPromptTokens: 0, reasoningTokens: 0 });
  });

  it("流式:累计到末尾携带 usage 的块", () => {
    const ex = deepseekMetadataExtractor.createStreamExtractor();
    ex.processChunk({ choices: [{ delta: { content: "你" } }] });
    ex.processChunk({ choices: [{ delta: { content: "好" } }] });
    ex.processChunk({
      choices: [{ delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 2000, prompt_cache_hit_tokens: 1920, completion_tokens: 100 },
    });
    expect(readDeepSeekUsage(ex.buildMetadata())).toEqual({
      cachedPromptTokens: 1920,
      reasoningTokens: 0,
    });
  });

  it("readDeepSeekUsage 容忍 null/缺失", () => {
    expect(readDeepSeekUsage(undefined)).toEqual({ cachedPromptTokens: 0, reasoningTokens: 0 });
    expect(readDeepSeekUsage({})).toEqual({ cachedPromptTokens: 0, reasoningTokens: 0 });
  });
});
