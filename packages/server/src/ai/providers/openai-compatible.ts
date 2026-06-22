import {
  createOpenAICompatible,
  OpenAICompatibleChatLanguageModel,
} from "@ai-sdk/openai-compatible";
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

/**
 * 包一层 fetch:对流式 chat 请求体注入 `stream_options.include_usage=true`。
 * `@ai-sdk/openai-compatible@0.1.x` 不会自动带这个选项,导致很多 OpenAI 兼容网关
 * 的流式响应不返回 token 用量(prompt/completion 全为 0,成本算出来恒为 $0)。
 */
function withIncludeUsage(baseFetch: typeof fetch): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    if (init?.body && typeof init.body === "string") {
      try {
        const obj = JSON.parse(init.body);
        if (obj && obj.stream === true) {
          obj.stream_options = { ...(obj.stream_options ?? {}), include_usage: true };
          init = { ...init, body: JSON.stringify(obj) };
        }
      } catch {
        // 非 JSON body 原样透传
      }
    }
    return baseFetch(input, init);
  }) as typeof fetch;
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

  /**
   * 鉴权头。默认 OpenAI 风格 Authorization: Bearer;
   * 子类可覆盖(如 MiMo 用 `api-key: <key>`)。
   */
  protected authHeaders(apiKey: string): Record<string, string> {
    return { Authorization: `Bearer ${apiKey}` };
  }

  async listModels(): Promise<ModelInfo[]> {
    const url = `${this.baseUrl}/v1/models`;
    try {
      const res = await this.fetchImpl(url, {
      headers: this.authHeaders(this.apiKey),
    });
    if (!res.ok) throw new Error(`listModels 失败 HTTP ${res.status}`);
      const j: any = await res.json();
      return (j.data ?? []).map((m: any) => ({ id: m.id, ownedBy: m.owned_by }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const cause = err instanceof Error && err.cause instanceof Error ? ` cause=${err.cause.message}` : "";
      throw new Error(`listModels fetch failed ${url}${cause}: ${message}`);
    }
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

  /**
   * 子类可覆盖以提供 provider 特有的用量元数据抽取(如 DeepSeek 的
   * prompt_cache_hit_tokens / reasoning_tokens)。返回 undefined 表示不抽取。
   * 形状须与 @ai-sdk/openai-compatible 的 MetadataExtractor 一致。
   */
  protected metadataExtractor(): unknown {
    return undefined;
  }

  createModel(modelId: string, opts: ModelOpts): LanguageModel {
    const apiKey = opts.apiKey ?? this.apiKey;
    const headers = this.authHeaders(apiKey);
    const extractor = this.metadataExtractor();
    const fetchImpl = withIncludeUsage(this.fetchImpl);
    if (!extractor) {
      const provider = createOpenAICompatible({
        name: this.id,
        baseURL: `${this.baseUrl}/v1`,
        headers, // 用自定义鉴权头(含 Bearer 默认或 api-key 等)
        fetch: fetchImpl, // 注入 stream_options.include_usage,否则流式响应不带 token 用量
      });
      return provider.chatModel(modelId);
    }
    // 需要注入 metadataExtractor 时直接构造 chat 模型(工厂不透传该字段)。
    const baseURL = `${this.baseUrl}/v1`;
    return new OpenAICompatibleChatLanguageModel(modelId, {}, {
      provider: `${this.id}.chat`,
      url: ({ path }: { path: string }) => `${baseURL}${path}`,
      headers: () => headers,
      fetch: fetchImpl,
      defaultObjectGenerationMode: "tool",
      metadataExtractor: extractor,
    } as never) as unknown as LanguageModel;
  }

  classifyError(_err: unknown): ErrorClass {
    return "unknown";
  }
}
