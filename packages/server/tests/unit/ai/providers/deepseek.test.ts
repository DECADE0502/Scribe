import { describe, it, expect } from "vitest";
import { DeepSeekProvider } from "../../../../src/ai/providers/deepseek.js";

describe("DeepSeekProvider", () => {
  it("id 为 deepseek、baseUrl 为官方端点", () => {
    const p = new DeepSeekProvider({ apiKey: "sk-x" });
    expect(p.id).toBe("deepseek");
    expect((p as any).baseUrl).toBe("https://api.deepseek.com");
  });
  it("classifyError 识别 429", () => {
    const p = new DeepSeekProvider({ apiKey: "sk-x" });
    const e = Object.assign(new Error("429"), { status: 429 });
    expect(p.classifyError(e)).toBe("rate_limit");
  });
  it("classifyError 识别上下文超长", () => {
    const p = new DeepSeekProvider({ apiKey: "sk-x" });
    expect(p.classifyError(new Error("maximum context length exceeded"))).toBe("context_overflow");
  });
  it("classifyError 识别 401 认证", () => {
    const p = new DeepSeekProvider({ apiKey: "sk-x" });
    expect(p.classifyError(Object.assign(new Error("auth"), { status: 401 }))).toBe("auth");
  });
});
