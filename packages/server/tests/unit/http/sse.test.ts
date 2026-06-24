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
      yield { type: "agent_progress", phase: "thinking", label: "理解意图", status: "running" };
      yield { type: "done" };
    }

    const res = streamSseResponse(gen());
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    const all = (await readSse(res)).join("");
    expect(all).toContain("event: agent_progress");
    expect(all).toContain('"label":"理解意图"');
    expect(all).toContain("event: done");
    expect(all.endsWith("\n\n")).toBe(true);
  });

  it("stops after done and does not emit later events", async () => {
    async function* gen(): AsyncIterable<SseEvent> {
      yield { type: "done" };
      yield { type: "agent_progress", phase: "completed", label: "不应出现", status: "done" };
    }

    const all = (await readSse(streamSseResponse(gen()))).join("");
    expect(all).not.toContain("不应出现");
  });

  it("emits error when the generator throws", async () => {
    async function* gen(): AsyncIterable<SseEvent> {
      yield { type: "agent_progress", phase: "thinking", label: "前半段", status: "running" };
      throw new Error("oops");
    }

    const all = (await readSse(streamSseResponse(gen()))).join("");
    expect(all).toContain("event: error");
    expect(all).toContain("oops");
  });
});
