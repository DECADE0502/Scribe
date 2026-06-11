import { OpenAICompatibleProvider } from "./openai-compatible.js";
import { deepseekMetadataExtractor } from "./deepseek-metadata.js";
import type { ErrorClass } from "@scribe/shared";

/**
 * 小米 MiMo「Token Plan」供应商(OpenAI 兼容协议)。
 *
 * 与标准 OpenAI 兼容的两点差异:
 * - 鉴权头是 `api-key: tp-xxxxx`,不是 `Authorization: Bearer`
 * - Token Plan 订阅制(非按量),key 形如 tp-xxxxx,与 sk-xxxxx 独立
 *
 * 集群(以订阅管理页为准):
 *   cn:  https://token-plan-cn.xiaomimimo.com
 *   sgp: https://token-plan-sgp.xiaomimimo.com
 *   ams: https://token-plan-ams.xiaomimimo.com
 * baseUrl 不含 /v1,由基类统一拼接 /v1。
 */
const CLUSTERS: Record<string, string> = {
  cn: "https://token-plan-cn.xiaomimimo.com",
  sgp: "https://token-plan-sgp.xiaomimimo.com",
  ams: "https://token-plan-ams.xiaomimimo.com",
};

export class MiMoProvider extends OpenAICompatibleProvider {
  constructor(cfg: {
    apiKey: string;
    cluster?: "cn" | "sgp" | "ams";
    baseUrl?: string;
    fetchImpl?: typeof fetch;
  }) {
    super({
      id: "mimo",
      baseUrl: cfg.baseUrl ?? CLUSTERS[cfg.cluster ?? "cn"]!,
      apiKey: cfg.apiKey,
      fetchImpl: cfg.fetchImpl,
    });
  }

  // MiMo 用 api-key 头鉴权
  protected override authHeaders(apiKey: string): Record<string, string> {
    return { "api-key": apiKey };
  }

  // mimo-v2.5-pro 为 reasoning 模型,返回标准 cached_tokens / reasoning_tokens
  protected override metadataExtractor(): unknown {
    return deepseekMetadataExtractor;
  }

  override classifyError(err: unknown): ErrorClass {
    const e = err as { message?: string; status?: number; statusCode?: number };
    const msg = String(e?.message ?? "");
    const status = Number(e?.status ?? e?.statusCode ?? 0);
    if (status === 429) return "rate_limit";
    if (status === 401 || status === 403 || /invalid api key|invalid_key/i.test(msg)) return "auth";
    if (/timeout|ETIMEDOUT/i.test(msg)) return "timeout";
    if (/aborted|stream.*idle|ECONNRESET|socket hang up|EAI_AGAIN|terminated|fetch failed|premature close/i.test(msg)) return "stream_idle";
    if (/context length|context_length|too long|maximum context/i.test(msg)) return "context_overflow";
    return "unknown";
  }
}
