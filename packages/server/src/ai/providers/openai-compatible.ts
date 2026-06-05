import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import type { ProviderAdapter, ModelOpts } from "./_interface.js";
import type { ModelInfo, ErrorClass } from "@scribe/shared";

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
    return { id };
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
