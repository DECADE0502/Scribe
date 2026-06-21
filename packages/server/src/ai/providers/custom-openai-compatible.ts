import { OpenAICompatibleProvider } from "./openai-compatible.js";

function stripV1Suffix(baseUrl: string): string {
  let next = baseUrl.trim();
  while (next.endsWith("/")) next = next.slice(0, -1);
  if (next.toLowerCase().endsWith("/v1")) next = next.slice(0, -3);
  while (next.endsWith("/")) next = next.slice(0, -1);
  return next;
}

export class CustomOpenAICompatibleProvider extends OpenAICompatibleProvider {
  private readonly auth: "bearer" | "api-key";

  constructor(cfg: {
    id: string;
    baseUrl: string;
    apiKey: string;
    auth: "bearer" | "api-key";
    fetchImpl?: typeof fetch;
  }) {
    super({
      id: cfg.id,
      baseUrl: stripV1Suffix(cfg.baseUrl),
      apiKey: cfg.apiKey,
      fetchImpl: cfg.fetchImpl,
    });
    this.auth = cfg.auth;
  }

  protected override authHeaders(apiKey: string): Record<string, string> {
    if (this.auth === "api-key") return { "api-key": apiKey };
    return { Authorization: `Bearer ${apiKey}` };
  }
}
