import { OpenAICompatibleProvider } from "./openai-compatible.js";
import type { ErrorClass } from "@scribe/shared";

export class AnyRouterProvider extends OpenAICompatibleProvider {
  constructor(cfg: { apiKey: string; baseUrl?: string; fetchImpl?: typeof fetch }) {
    super({
      id: "anyrouter",
      baseUrl: cfg.baseUrl ?? "https://anyrouter.top",
      apiKey: cfg.apiKey,
      fetchImpl: cfg.fetchImpl,
    });
  }

  override classifyError(err: unknown): ErrorClass {
    const e = err as any;
    const msg = String(e?.message ?? "");
    const status = Number(e?.status ?? e?.statusCode ?? 0);
    if (status === 429) return "rate_limit";
    if (status === 401 || status === 403) return "auth";
    if (/timeout|ETIMEDOUT/i.test(msg)) return "timeout";
    if (/aborted|stream.*idle|ECONNRESET|socket hang up|EAI_AGAIN|terminated|fetch failed|premature close/i.test(msg)) return "stream_idle";
    if (/context length|context_length|too long|maximum context/i.test(msg)) return "context_overflow";
    return "unknown";
  }
}
