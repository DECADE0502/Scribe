import { Hono } from "hono";
import type { LanguageModel } from "ai";
import { streamSseResponse } from "../sse.js";
import { runEcho, runChat } from "../../ai/orchestrator/chat.js";

export interface ConversationDeps {
  getModel?: () => LanguageModel | undefined;
}

export function conversationRoutes(deps: ConversationDeps = {}) {
  const app = new Hono();
  app.post("/api/books/:bookId/conversation", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const message = String((body as { message?: unknown })?.message ?? "");
    if (!message) return c.json({ error: "message 不能为空" }, 400);
    const mode = c.req.query("mode") ?? "echo";
    const model = deps.getModel?.();
    if (mode === "chat" && model) {
      return streamSseResponse(runChat({ model, message }));
    }
    return streamSseResponse(runEcho({ message }));
  });
  return app;
}
