import { Hono } from "hono";
import type { LanguageModel } from "ai";
import type { ModelInfo } from "@scribe/shared";
import type { BookRegistry } from "../book-registry.js";
import type { StyleReference } from "../../config/load.js";

export interface AutoRoutesDeps {
  registry: BookRegistry;
  getModel?: () => LanguageModel | undefined;
  getAuditModel?: () => LanguageModel | undefined;
  budgetLimitUsd?: number;
  writeModelInfo?: ModelInfo;
  auditModelInfo?: ModelInfo;
  onChapterCommitted?: (bookId: string) => void;
  getMasterPrompt?: () => string;
  getStyleReferences?: () => StyleReference[];
}

export function autoRoutes(deps: AutoRoutesDeps) {
  const app = new Hono();

  app.post("/api/books/:bookId/auto", async (c) => {
    const bookId = c.req.param("bookId");
    const book = deps.registry.booksRepo.get(bookId);
    if (!book) return c.json({ error: "book_not_found" }, 404);
    return c.json({
      error: "legacy_auto_route_removed",
      message: "Use /api/books/:bookId/agent/run with source:\"auto\".",
      bookId,
    }, 410);
  });

  app.post("/api/books/:bookId/auto/cancel", async (c) => {
    const bookId = c.req.param("bookId");
    return c.json({
      cancelled: false,
      reason: "legacy_auto_cancel_removed_use_stream_abort",
      bookId,
    });
  });

  return app;
}
