import { describe, it, expect } from "vitest";
import { createApp } from "../../src/http/server.js";
import { runChat } from "../../src/ai/orchestrator/chat.js";

function makeStubModel(chunks: string[]): any {
  return {
    specificationVersion: "v1",
    provider: "stub",
    modelId: "stub",
    async doGenerate() {
      throw new Error("not used");
    },
    async doStream() {
      return {
        stream: new ReadableStream({
          start(ctrl) {
            for (const ch of chunks) ctrl.enqueue({ type: "text-delta", textDelta: ch });
            ctrl.enqueue({
              type: "finish",
              finishReason: "stop",
              usage: { promptTokens: 5, completionTokens: chunks.length },
            });
            ctrl.close();
          },
        }),
        rawCall: { rawPrompt: null, rawSettings: {} },
      };
    },
  };
}

async function collect(stream: AsyncIterable<any>): Promise<any[]> {
  const out: any[] = [];
  for await (const ev of stream) out.push(ev);
  return out;
}

describe("runChat 流式", () => {
  it("拼接 text-delta 输出 + usage + done", async () => {
    const evs = await collect(
      runChat({
        model: makeStubModel(["黎", "明", "时,雾气", "浸透山道"]),
        message: "测试",
      }),
    );
    const deltas = evs
      .filter((e) => e.type === "text_delta")
      .map((e) => e.delta)
      .join("");
    expect(deltas).toBe("黎明时,雾气浸透山道");
    expect(evs.at(-1)?.type).toBe("done");
    expect(evs.find((e) => e.type === "usage")?.completionTokens).toBe(4);
  });

  it("HTTP /conversation?mode=chat + model 注入,SSE 输出真实文本", async () => {
    const app = createApp({ getModel: () => makeStubModel(["你", "好"]) });
    const res = await app.request("/api/books/b1/conversation?mode=chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "在吗" }),
    });
    const text = await new Response(res.body).text();
    expect(text).toContain("event: text_delta");
    expect(text).toContain('"delta":"你"');
    expect(text).toContain('"delta":"好"');
    expect(text).toContain("event: usage");
    expect(text).toContain("event: done");
    expect(text).not.toContain("[echo]");
  });

  it("无 model 注入或 mode=echo 时走回声", async () => {
    const app = createApp();
    const res = await app.request("/api/books/b1/conversation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "你好" }),
    });
    const text = await new Response(res.body).text();
    expect(text).toContain("[echo]");
  });
});
