import type { ModelInfo } from "@scribe/shared";

export const LOCAL_MODEL_TABLE: Record<string, Partial<ModelInfo>> = {
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
};

export function lookupLocal(id: string): Partial<ModelInfo> | undefined {
  return LOCAL_MODEL_TABLE[id];
}
