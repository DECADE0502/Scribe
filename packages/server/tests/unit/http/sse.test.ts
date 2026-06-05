import { describe, it, expect } from "vitest";
import { streamSseResponse } from "../../../src/http/sse.js";
import type { SseEvent } from "@scribe/shared";

async function readSse(res: Response): Promise<string[]> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(decoder.decode(value));
  }
  return chunks;
}

describe("streamSseResponse", () => {
  it("发出 event 头与 JSON data,以 \\n\\n 分隔", async () => {
    async function* gen(): AsyncIterable<SseEvent> {
      yield { type: "text_delta", delta: "你好" };
      yield { type: "done" };
    }
    const res = streamSseResponse(gen());
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    const all = (await readSse(res)).join("");
    expect(all).toContain("event: text_delta");
    expect(all).toContain('"delta":"你好"');
    expect(all).toContain("event: done");
    expect(all.endsWith("\n\n")).toBe(true);
  });

  it("done 事件后流结束,不再发后续事件", async () => {
    async function* gen(): AsyncIterable<SseEvent> {
      yield { type: "done" };
      yield { type: "text_delta", delta: "不应出现" };
    }
    const all = (await readSse(streamSseResponse(gen()))).join("");
    expect(all).not.toContain("不应出现");
  });

  it("生成器抛错时,发出 error 事件", async () => {
    async function* gen(): AsyncIterable<SseEvent> {
      yield { type: "text_delta", delta: "前半段" };
      throw new Error("oops");
    }
    const all = (await readSse(streamSseResponse(gen()))).join("");
    expect(all).toContain("event: error");
    expect(all).toContain("oops");
  });
});
