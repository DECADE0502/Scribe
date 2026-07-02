import { Hono } from "hono";
import type { BookRegistry } from "../book-registry.js";

export interface ConversationDeps {
  registry?: BookRegistry;
}

/**
 * 只剩对话历史读取。写入走 /agent/run(agent.ts 里持久化 user/assistant 消息),
 * 旧的 POST /conversation 聊天入口已随 4-agent 管线一起删除。
 */
export function conversationRoutes(deps: ConversationDeps = {}) {
  const app = new Hono();

  app.get("/api/books/:bookId/conversation", async (c) => {
    if (!deps.registry) return c.json({ error: "service_unavailable" }, 503);
    const bookId = c.req.param("bookId");
    const limit = Number(c.req.query("limit") ?? 100);
    const handle = deps.registry.open(bookId);
    const rows = handle.conversationsRepo.listLatest(limit).reverse();
    return c.json({ messages: rows });
  });

  return app;
}
