import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import type { ProviderAdapter, ModelOpts } from "./_interface.js";
import type { ModelInfo, ErrorClass } from "@scribe/shared";
import { enrichFromOpenRouter } from "./enrich-from-openrouter.js";
import { lookupLocal } from "./local-model-table.js";

interface Cfg {
  id: string;
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}

export class OpenAICompatibleProvider implements ProviderAdapter {
  readonly id: string;
  protected readonly baseUrl: string;
  protected readonly apiKey: string;
  protected readonly fetchImpl: typeof fetch;

  constructor(cfg: Cfg) {
    if (!cfg.apiKey) throw new Error("apiKey 不能为空");
    this.id = cfg.id;
    this.baseUrl = cfg.baseUrl.replace(/\/+$/, "");
    this.apiKey = cfg.apiKey;
    this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  async listModels(): Promise<ModelInfo[]> {
    const res = await this.fetchImpl(`${this.baseUrl}/v1/models`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!res.ok) throw new Error(`listModels 失败 HTTP ${res.status}`);
    const j: any = await res.json();
    return (j.data ?? []).map((m: any) => ({ id: m.id, ownedBy: m.owned_by }));
  }

  async enrichModel(id: string): Promise<ModelInfo> {
    // 第一档:provider 自家 listModels
    let merged: Partial<ModelInfo> = {};
    try {
      const list = await this.listModels();
      const found = list.find((m) => m.id === id);
      if (found) merged = { ...found };
    } catch {
      /* 忽略 */
    }

    // 第二档:OpenRouter(仅填补)
    const or = await enrichFromOpenRouter(id, this.fetchImpl);
    merged = { ...or, ...merged };

    // 第三档:本地表(仅填补)
    const local = lookupLocal(id);
    if (local) merged = { ...local, ...merged };

    return { ...merged, id };
  }

  async testToolUse(): Promise<boolean> {
    return true;
  }

  createModel(modelId: string, opts: ModelOpts): LanguageModel {
    const provider = createOpenAICompatible({
      name: this.id,
      baseURL: `${this.baseUrl}/v1`,
      apiKey: opts.apiKey ?? this.apiKey,
    });
    return provider.chatModel(modelId);
  }

  classifyError(_err: unknown): ErrorClass {
    return "unknown";
  }
}
