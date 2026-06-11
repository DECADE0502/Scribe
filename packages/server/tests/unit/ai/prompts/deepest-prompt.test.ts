import { describe, it, expect } from "vitest";
import {
  resolveDeepestPrompt,
  prependDeepestPrompt,
} from "../../../../src/ai/prompts/deepest-prompt.js";

describe("resolveDeepestPrompt(全局默认 + 每本覆盖)", () => {
  it("每本覆盖优先于全局", () => {
    expect(resolveDeepestPrompt({ perBook: "本书规则", global: "全局规则" })).toBe("本书规则");
  });
  it("每本为空时回退全局", () => {
    expect(resolveDeepestPrompt({ perBook: "  ", global: "全局规则" })).toBe("全局规则");
    expect(resolveDeepestPrompt({ perBook: null, global: "全局规则" })).toBe("全局规则");
  });
  it("都没有则空串", () => {
    expect(resolveDeepestPrompt({})).toBe("");
  });
});

describe("prependDeepestPrompt(原文拼到最前端)", () => {
  it("作为第一条 system 消息插到最前,内容原样无包装", () => {
    const out = prependDeepestPrompt(
      [{ role: "system", content: "内置系统提示" }, { role: "user", content: "写第一章" }],
      "你必须用第一人称、冷硬文风。",
    );
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ role: "system", content: "你必须用第一人称、冷硬文风。" });
    expect(out[1]!.content).toBe("内置系统提示"); // 内置提示仍在,排在用户提示之后
  });
  it("空提示词时原样返回", () => {
    const msgs = [{ role: "system" as const, content: "x" }];
    expect(prependDeepestPrompt(msgs, "")).toBe(msgs);
    expect(prependDeepestPrompt(msgs, undefined)).toBe(msgs);
  });
});
