import type { ModelInfo } from "@scribe/shared";

export const LOCAL_MODEL_TABLE: Record<string, Partial<ModelInfo>> = {
  "gemini-2.5-pro": {
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsReasoning: true,
  },
  "deepseek-v4-pro": {
    contextWindow: 128_000,
    supportsTools: true,
    supportsReasoning: true,
    pricing: { input: 0.27, output: 1.1, cachedInput: 0.07 },
  },
  "deepseek-v4-flash": {
    contextWindow: 64_000,
    supportsTools: true,
    supportsReasoning: false,
    pricing: { input: 0.07, output: 0.28 },
  },
  // Claude 系列(按 Anthropic 公布单价估算,单位:美元/百万 token)。
  // 经第三方网关(如 anyrouter/insta360)时实际计费以网关为准,这里仅供成本估算展示。
  "claude-haiku-4-5-20251001": {
    contextWindow: 200_000,
    supportsTools: true,
    supportsReasoning: true,
    pricing: { input: 1, output: 5, cachedInput: 0.1 },
  },
  "claude-sonnet-4-5": {
    contextWindow: 200_000,
    supportsTools: true,
    supportsReasoning: true,
    pricing: { input: 3, output: 15, cachedInput: 0.3 },
  },
  "claude-sonnet-4-6": {
    contextWindow: 200_000,
    supportsTools: true,
    supportsReasoning: true,
    pricing: { input: 3, output: 15, cachedInput: 0.3 },
  },
  "claude-opus-4-6": {
    contextWindow: 200_000,
    supportsTools: true,
    supportsReasoning: true,
    pricing: { input: 15, output: 75, cachedInput: 1.5 },
  },
  "claude-opus-4-7": {
    contextWindow: 200_000,
    supportsTools: true,
    supportsReasoning: true,
    pricing: { input: 15, output: 75, cachedInput: 1.5 },
  },
  "claude-opus-4-8": {
    contextWindow: 200_000,
    supportsTools: true,
    supportsReasoning: true,
    pricing: { input: 15, output: 75, cachedInput: 1.5 },
  },
};

export function lookupLocal(id: string): Partial<ModelInfo> | undefined {
  return LOCAL_MODEL_TABLE[id];
}
