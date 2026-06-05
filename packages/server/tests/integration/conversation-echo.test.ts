import { describe, it, expect } from "vitest";
import { createApp } from "../../src/http/server.js";

async function readSseText(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let out = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value);
  }
  return out;
}

describe("POST /api/books/:id/conversation echo", () => {
  it("收到 text_delta + done,正文包含输入", async () => {
    const app = createApp();
    const res = await app.request("/api/books/b1/conversation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "你好" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    const text = await readSseText(res);
    expect(text).toContain("event: text_delta");
    expect(text).toContain("event: done");
    expect(text).toMatch(/data:.*"delta":"你"/);
  });

  it("空 message 返回 400", async () => {
    const app = createApp();
    const res = await app.request("/api/books/b1/conversation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
