import { Hono } from "hono";
import { streamSseResponse } from "../sse.js";
import { runEcho } from "../../ai/orchestrator/chat.js";

export function conversationRoutes() {
  const app = new Hono();
  app.post("/api/books/:bookId/conversation", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const message = String((body as { message?: unknown })?.message ?? "");
    if (!message) return c.json({ error: "message 不能为空" }, 400);
    return streamSseResponse(runEcho({ message }));
  });
  return app;
}
