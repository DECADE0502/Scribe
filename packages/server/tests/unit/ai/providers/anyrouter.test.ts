import { describe, it, expect } from "vitest";
import { AnyRouterProvider } from "../../../../src/ai/providers/anyrouter.js";

describe("AnyRouterProvider", () => {
  it("id 为 anyrouter、baseUrl 为 AnyRouter 端点", () => {
    const p = new AnyRouterProvider({ apiKey: "sk-x" });
    expect(p.id).toBe("anyrouter");
    expect((p as any).baseUrl).toBe("https://anyrouter.top");
  });

  it("classifyError 识别常见错误", () => {
    const p = new AnyRouterProvider({ apiKey: "sk-x" });
    expect(p.classifyError(Object.assign(new Error("429"), { status: 429 }))).toBe("rate_limit");
    expect(p.classifyError(Object.assign(new Error("auth"), { status: 401 }))).toBe("auth");
    expect(p.classifyError(new Error("request timeout"))).toBe("timeout");
    expect(p.classifyError(new Error("read ECONNRESET"))).toBe("stream_idle");
    expect(p.classifyError(new Error("maximum context length exceeded"))).toBe("context_overflow");
  });
});
