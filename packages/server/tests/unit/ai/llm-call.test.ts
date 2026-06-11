import { describe, it, expect } from "vitest";
import { tool, type Tool } from "ai";
import { z } from "zod";
import { streamLlm } from "../../../src/ai/llm-call.js";

/** 多轮 stub LanguageModel(v1):sequenceFn(turn) 返回该轮 doStream 的 chunks。 */
function makeMultiTurnStub(sequenceFn: (turn: number) => any[]): any {
  let turn = 0;
  return {
    specificationVersion: "v1",
    provider: "stub",
    modelId: "stub",
    defaultObjectGenerationMode: "json",
    async doGenerate() {
      throw new Error("not used");
    },
    async doStream() {
      const chunks = sequenceFn(turn);
      turn++;
      return {
        stream: new ReadableStream({
          start(ctrl) {
            for (const c of chunks) ctrl.enqueue(c);
            ctrl.close();
          },
        }),
        rawCall: { rawPrompt: null, rawSettings: {} },
      };
    },
  };
}

async function consume<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of iter) out.push(v);
  return out;
}

describe("streamLlm 工具错误自恢复(B-6-002)", () => {
  it("工具 execute 抛错 → 转成 tool-result 返回 → 流不中断,LLM 续写", async () => {
    let calls = 0;
    const tools: Record<string, Tool> = {
      flaky: tool({
        description: "第一次抛错的工具",
        parameters: z.object({ x: z.string() }),
        execute: async (): Promise<unknown> => {
          calls++;
          throw new Error("字段 类型 值「错的」不在允许列表");
        },
      }),
    };

    const model = makeMultiTurnStub((turn) => {
      if (turn === 0) {
        return [
          {
            type: "tool-call",
            toolCallType: "function",
            toolCallId: "tc1",
            toolName: "flaky",
            args: JSON.stringify({ x: "错的" }),
          },
          { type: "finish", finishReason: "tool-calls", usage: { promptTokens: 10, completionTokens: 5 } },
        ];
      }
      // 第二轮:LLM 看到工具错误后改为输出文本收尾
      return [
        { type: "text-delta", textDelta: "明白,我改正后继续。" },
        { type: "finish", finishReason: "stop", usage: { promptTokens: 12, completionTokens: 4 } },
      ];
    });

    const events = await consume(
      streamLlm({ model, messages: [{ role: "user", content: "做事" }], tools, maxSteps: 5 }),
    );

    // 工具确实被调用且抛了错
    expect(calls).toBe(1);
    // 关键不变量:没有 error 事件(错误被吞进 tool-result),流以 done 收尾
    expect(events.some((e) => e.type === "error")).toBe(false);
    expect(events.some((e) => e.type === "done")).toBe(true);
    // tool_call_end 的 result 携带了失败信息,供 LLM 自我纠正
    const end = events.find((e) => e.type === "tool_call_end") as any;
    expect(end).toBeDefined();
    expect(end.result.success).toBe(false);
    expect(String(end.result.error)).toMatch(/不在允许列表/);
    // LLM 第二轮的续写文本到达
    const text = events.filter((e) => e.type === "text_delta").map((e: any) => e.delta).join("");
    expect(text).toContain("改正");
  });
});
