import type { ModelInfo } from "@scribe/shared";

interface Cache {
  fetchedAt: number;
  data: Map<string, Partial<ModelInfo>>;
}

let cache: Cache | undefined;
const TTL = 24 * 3600 * 1000;

export function _resetEnrichCache(): void {
  cache = undefined;
}

export async function enrichFromOpenRouter(
  modelId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Partial<ModelInfo>> {
  if (!cache || Date.now() - cache.fetchedAt > TTL) {
    try {
      const res = await fetchImpl("https://openrouter.ai/api/v1/models");
      if (!res.ok) return {};
      const j: any = await res.json();
      const map = new Map<string, Partial<ModelInfo>>();
      for (const m of j.data ?? []) {
        const baseId = String(m.id).split("/").pop() ?? m.id;
        const entry: Partial<ModelInfo> = {};
        if (typeof m.context_length === "number") {
          entry.contextWindow = m.context_length;
        }
        if (Array.isArray(m.supported_parameters)) {
          entry.supportsTools = m.supported_parameters.includes("tools");
        }
        if (m.pricing) {
          entry.pricing = {
            input: Number(m.pricing.prompt) * 1e6,
            output: Number(m.pricing.completion) * 1e6,
          };
        }
        map.set(baseId, entry);
      }
      cache = { fetchedAt: Date.now(), data: map };
    } catch {
      return {};
    }
  }
  return cache.data.get(modelId) ?? {};
}
