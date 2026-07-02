import { describe, expect, it, vi } from "vitest";

/**
 * streamLlm 的契约是"不抛错、只 yield {type:'error'} 事件后结束"。
 * task 的默认流若不把它转成 throw,供应商中途失败会让截断正文被当成
 * 完整内容提交(write-chapter 尤其致命)。这组测试 mock 掉 llm-call,
 * 锁死"error 事件必须变成异常"的行为。
 */
vi.mock("../../../../src/ai/llm-call.js", () => {
  const calls: Array<{ messages: Array<{ role: string; content: string }> }> = [];
  return {
    __calls: calls,
    streamLlm: vi.fn(async function* (input: { messages: Array<{ role: string; content: string }> }) {
      calls.push({ messages: input.messages });
      yield { type: "text_delta", delta: "写到一半" };
      yield { type: "error", errorClass: "unknown", message: "provider exploded mid-stream" };
    }),
    generateLlmText: vi.fn(async () => ({
      text: "{}",
      usage: { promptTokens: 1, completionTokens: 1 },
    })),
    generateTextWithRetry: vi.fn(),
  };
});

import { chatTask } from "../../../../src/ai/tasks/chat.js";
import { reviseTask } from "../../../../src/ai/tasks/revise.js";
import * as llmCall from "../../../../src/ai/llm-call.js";

function chatCtx(deepestPrompt?: string) {
  return {
    handle: {} as any,
    writeModel: {} as any,
    auditModel: {} as any,
    request: { message: "你好", source: "chat" as const },
    deepestPrompt,
  } as any;
}

describe("default stream error propagation", () => {
  it("chat:streamLlm 产出 error 事件 → stream() 抛异常(dispatch 走 stream_failed)", async () => {
    const deltas: string[] = [];
    await expect(async () => {
      for await (const ev of chatTask.stream(chatCtx())) {
        if (ev.type === "text_delta") deltas.push(ev.delta);
      }
    }).rejects.toThrow(/provider exploded mid-stream/);
    // error 前的正文照常流出(前端能看到已生成部分),但流以异常收尾
    expect(deltas.join("")).toBe("写到一半");
  });

  it("revise:同样把 error 事件转成异常,截断段落不会拼进章节", async () => {
    const ctx = {
      handle: {} as any,
      writeModel: {} as any,
      auditModel: {} as any,
      request: {
        message: "改写",
        source: "revision" as const,
        target: { revisionRange: { chapterNo: 1, selectedText: "旧段落" } },
      },
    } as any;
    await expect(async () => {
      for await (const _ of reviseTask.stream(ctx)) { /* drain */ }
    }).rejects.toThrow(/provider exploded mid-stream/);
  });
});

describe("deepest prompt injection", () => {
  it("chat:ctx.deepestPrompt 作为第一条 system 消息进入 streamLlm", async () => {
    const before = (llmCall as any).__calls.length;
    try {
      for await (const _ of chatTask.stream(chatCtx("永远用第一人称。"))) { /* drain */ }
    } catch { /* mock 以 error 事件收尾,忽略 */ }
    const call = (llmCall as any).__calls[before];
    expect(call.messages[0]).toEqual({ role: "system", content: "永远用第一人称。" });
  });

  it("chat:未配置最深处提示词时不注入额外消息", async () => {
    const before = (llmCall as any).__calls.length;
    try {
      for await (const _ of chatTask.stream(chatCtx(undefined))) { /* drain */ }
    } catch { /* ignore */ }
    const call = (llmCall as any).__calls[before];
    expect(call.messages[0].content).toContain("小说写作助手");
  });
});
