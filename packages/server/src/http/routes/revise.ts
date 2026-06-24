import { Hono } from "hono";
import type { LanguageModel } from "ai";
import type { ModelInfo } from "@scribe/shared";
import type { BookRegistry } from "../book-registry.js";

export interface ReviseRoutesDeps {
  registry: BookRegistry;
  getModel?: () => LanguageModel | undefined;
  writeModelInfo?: ModelInfo;
}

export function reviseRoutes(deps: ReviseRoutesDeps) {
  const app = new Hono();

  app.post("/api/books/:bookId/chapters/:no/revise-segment", async (c) => {
    const bookId = c.req.param("bookId");
    const no = Number(c.req.param("no"));
    if (!Number.isInteger(no) || no < 1) return c.json({ error: "invalid_chapter_no" }, 400);
    const book = deps.registry.booksRepo.get(bookId);
    if (!book) return c.json({ error: "book_not_found" }, 404);
    return c.json({
      error: "legacy_revise_segment_removed",
      message: "Use /api/books/:bookId/agent/run with source:\"revision\".",
      bookId,
      chapterNo: no,
    }, 410);
  });

  app.post("/api/books/:bookId/chapters/:no/apply-revision", async (c) => c.json({
    error: "legacy_apply_revision_removed",
    message: "Use /api/books/:bookId/agent/run with source:\"revision\" and commit staged changes.",
  }, 410));

  return app;
}
