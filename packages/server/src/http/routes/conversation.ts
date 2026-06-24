import { Hono } from "hono";
import type { LanguageModel } from "ai";
import type { ModelInfo } from "@scribe/shared";
import type { BookRegistry } from "../book-registry.js";
import type { StyleReference } from "../../config/load.js";

export interface ConversationDeps {
  getModel?: () => LanguageModel | undefined;
  getAuditModel?: () => LanguageModel | undefined;
  registry?: BookRegistry;
  writeModelInfo?: ModelInfo;
  auditModelInfo?: ModelInfo;
  onChapterCommitted?: (bookId: string) => void;
  getMasterPrompt?: () => string;
  getStyleReferences?: () => StyleReference[];
}

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

  app.post("/api/books/:bookId/conversation", async (c) => {
    const bookId = c.req.param("bookId");
    return c.json({
      error: "legacy_conversation_post_removed",
      message: "Use /api/books/:bookId/agent/run with source:\"chat\".",
      bookId,
    }, 410);
  });

  return app;
}
