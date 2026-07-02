import { describe, expect, it } from "vitest";
import type { SseEvent } from "@scribe/shared";
import { streamSseResponse } from "../../../src/http/sse.js";

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
  it("emits event headers and JSON data separated by blank lines", async () => {
    async function* gen(): AsyncIterable<SseEvent> {
      yield { type: "text_delta", delta: "第一段正文" };
      yield { type: "done", committed: true };
    }

    const res = streamSseResponse(gen());
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    const all = (await readSse(res)).join("");
    expect(all).toContain("event: text_delta");
    expect(all).toContain('"delta":"第一段正文"');
    expect(all).toContain("event: done");
    expect(all.endsWith("\n\n")).toBe(true);
  });

  it("stops after done and does not emit later events", async () => {
    async function* gen(): AsyncIterable<SseEvent> {
      yield { type: "done", committed: false };
      yield { type: "text_delta", delta: "不应出现" };
    }

    const all = (await readSse(streamSseResponse(gen()))).join("");
    expect(all).not.toContain("不应出现");
  });

  it("emits error when the generator throws", async () => {
    async function* gen(): AsyncIterable<SseEvent> {
      yield { type: "text_delta", delta: "前半段" };
      throw new Error("oops");
    }

    const all = (await readSse(streamSseResponse(gen()))).join("");
    expect(all).toContain("event: error");
    expect(all).toContain("oops");
  });
});
