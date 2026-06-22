import { describe, it, expect, vi } from "vitest";
import { withRetry, classifyLlmError } from "../../../src/ai/retry.js";

describe("classifyLlmError", () => {
  it("429 / rate limit → rate_limit", () => {
    expect(classifyLlmError(Object.assign(new Error("x"), { statusCode: 429 }))).toBe("rate_limit");
    expect(classifyLlmError(new Error("Rate limit exceeded"))).toBe("rate_limit");
  });
  it("401/403 → auth", () => {
    expect(classifyLlmError(Object.assign(new Error("x"), { status: 401 }))).toBe("auth");
  });
  it("超时/网络/5xx → timeout(可重试)", () => {
    expect(classifyLlmError(new Error("socket hang up"))).toBe("timeout");
    expect(classifyLlmError(Object.assign(new Error("x"), { statusCode: 503 }))).toBe("timeout");
  });
  it("AbortError → unknown(不重试)", () => {
    expect(classifyLlmError(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe("unknown");
  });
  it("上下文超长 → context_overflow", () => {
    expect(classifyLlmError(new Error("maximum context length is 200000"))).toBe("context_overflow");
  });
});

describe("withRetry", () => {
  it("rate_limit 指数退避至多 3 次", async () => {
    let n = 0;
    const op = vi.fn(async () => {
      n++;
      if (n < 3) throw Object.assign(new Error("429"), { status: 429 });
      return "ok";
    });
    const r = await withRetry(op, {
      classify: () => "rate_limit",
      sleepImpl: async () => {},
    });
    expect(r).toBe("ok");
    expect(op).toHaveBeenCalledTimes(3);
  });
  it("auth 不重试", async () => {
    const op = vi.fn(async () => {
      throw Object.assign(new Error("auth"), { status: 401 });
    });
    await expect(withRetry(op, { classify: () => "auth" })).rejects.toThrow();
    expect(op).toHaveBeenCalledTimes(1);
  });
  it("timeout 立刻重试 1 次", async () => {
    let n = 0;
    const op = vi.fn(async () => {
      n++;
      if (n === 1) throw new Error("timeout");
      return "ok";
    });
    const r = await withRetry(op, { classify: () => "timeout" });
    expect(r).toBe("ok");
    expect(op).toHaveBeenCalledTimes(2);
  });
  it("stream_idle 立刻重试 1 次", async () => {
    let n = 0;
    const op = vi.fn(async () => {
      n++;
      if (n === 1) throw new Error("stream idle");
      return "ok";
    });
    const r = await withRetry(op, { classify: () => "stream_idle" });
    expect(r).toBe("ok");
    expect(op).toHaveBeenCalledTimes(2);
  });
  it("context_overflow 重试 1 次,onAttempt 触发回调让上层降级", async () => {
    let n = 0;
    const onAttempt = vi.fn();
    const op = vi.fn(async () => {
      n++;
      if (n === 1) throw new Error("context length");
      return "ok";
    });
    const r = await withRetry(op, {
      classify: () => "context_overflow",
      onAttempt,
    });
    expect(r).toBe("ok");
    expect(onAttempt).toHaveBeenCalledWith(1, "context_overflow");
  });
  it("unknown 不重试", async () => {
    const op = vi.fn(async () => {
      throw new Error("?");
    });
    await expect(withRetry(op, { classify: () => "unknown" })).rejects.toThrow();
    expect(op).toHaveBeenCalledTimes(1);
  });
  it("超过 maxRetries 后抛最后一次错误", async () => {
    const op = vi.fn(async () => {
      throw Object.assign(new Error("429"), { status: 429 });
    });
    await expect(
      withRetry(op, { classify: () => "rate_limit", sleepImpl: async () => {} }),
    ).rejects.toThrow("429");
    expect(op).toHaveBeenCalledTimes(4); // 1 + 3 retry
  });
});
