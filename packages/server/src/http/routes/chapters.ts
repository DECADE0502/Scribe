import { Hono } from "hono";
import { deleteChaptersFrom } from "../../services/delete-chapters.js";
import type { LanguageModel } from "ai";
import type { ModelInfo } from "@scribe/shared";
import type { BookRegistry } from "../book-registry.js";
import { log } from "../../logger.js";
import type { StyleReference } from "../../config/load.js";

export interface ChapterRoutesDeps {
  registry?: BookRegistry;
  onChapterCommitted?: (bookId: string) => void;
  getMasterPrompt?: () => string;
  getStyleReferences?: () => StyleReference[];
  getAuditModel?: () => LanguageModel | undefined;
  writeModelInfo?: ModelInfo;
  auditModelInfo?: ModelInfo;
  getDeps?: (bookId: string) => unknown;
}

export function chapterRoutes(deps: ChapterRoutesDeps = {}) {
  const app = new Hono();
  app.post("/api/books/:bookId/chapters/:no/write", async (c) => c.json({
    error: "legacy_write_route_removed",
    message: "Use /api/books/:bookId/agent/run with source:\"editor\".",
  }, 410));
  app.post("/api/books/:bookId/chapters/:no/write-draft", async (c) => c.json({
    error: "legacy_write_draft_route_removed",
    message: "Use /api/books/:bookId/agent/run with source:\"editor\".",
  }, 410));
  app.post("/api/books/:bookId/chapters/:no/finalize", async (c) => c.json({
    error: "legacy_finalize_route_removed",
    message: "Use /api/books/:bookId/agent/run with source:\"editor\".",
  }, 410));

  app.get("/api/books/:bookId/chapters/:no", async (c) => {
    const bookId = c.req.param("bookId");
    const no = Number(c.req.param("no"));
    if (!Number.isInteger(no) || no < 1) return c.json({ error: "invalid_chapter_no" }, 400);
    if (!deps.registry) return c.json({ error: "service_not_ready" }, 503);
    const book = deps.registry.booksRepo.get(bookId);
    if (!book) return c.json({ error: "book_not_found" }, 404);
    const handle = deps.registry.open(bookId);
    const record = handle.chapterFiles.read(no);
    if (!record) return c.json({ error: "chapter_not_found" }, 404);
    return c.json(record);
  });

  app.get("/api/books/:bookId/chapters", async (c) => {
    const bookId = c.req.param("bookId");
    if (!deps.registry) return c.json({ error: "service_not_ready" }, 503);
    const book = deps.registry.booksRepo.get(bookId);
    if (!book) return c.json({ error: "book_not_found" }, 404);
    const handle = deps.registry.open(bookId);
    return c.json({ chapters: handle.chapterFiles.list() });
  });

  // Manual user edit is intentionally direct CRUD, not an AI-generated mutation.
  app.put("/api/books/:bookId/chapters/:no", async (c) => {
    const bookId = c.req.param("bookId");
    const no = Number(c.req.param("no"));
    if (!Number.isInteger(no) || no < 1) return c.json({ error: "invalid_chapter_no" }, 400);
    if (!deps.registry) return c.json({ error: "service_not_ready" }, 503);
    const book = deps.registry.booksRepo.get(bookId);
    if (!book) return c.json({ error: "book_not_found" }, 404);

    const body = await c.req.json().catch(() => ({}));
    const content = String((body as { content?: unknown })?.content ?? "");
    if (!content.trim()) return c.json({ error: "content_required" }, 400);
    const titleRaw = (body as { title?: unknown })?.title;
    const handle = deps.registry.open(bookId);
    const existing = handle.chapterFiles.read(no);
    const title = typeof titleRaw === "string" && titleRaw.trim()
      ? titleRaw.trim()
      : existing?.title ?? `第${no}章`;

    const saved = handle.chaptersRepo.saveVersion({
      chapterNo: no,
      source: "user_edit",
      contentMd: content,
    });
    try {
      handle.chapterFiles.save({ chapterNo: no, title, content, versionNo: saved.versionNo });
    } catch (fsErr) {
      try { handle.chaptersRepo.deleteVersion(no, saved.versionNo); } catch { /* ignore */ }
      return c.json({ error: `chapter_file_save_failed:${(fsErr as Error).message ?? "unknown"}` }, 500);
    }
    deps.onChapterCommitted?.(bookId);
    return c.json({ versionNo: saved.versionNo });
  });

  app.delete("/api/books/:bookId/chapters/:no", async (c) => {
    const bookId = c.req.param("bookId");
    const no = Number(c.req.param("no"));
    if (!Number.isInteger(no) || no < 1) return c.json({ error: "invalid_chapter_no" }, 400);
    if (!deps.registry) return c.json({ error: "service_not_ready" }, 503);
    const book = deps.registry.booksRepo.get(bookId);
    if (!book) return c.json({ error: "book_not_found" }, 404);
    const handle = deps.registry.open(bookId);
    if (!deps.registry.tryBeginExclusive(bookId)) {
      return c.json({ error: "book_busy" }, 409);
    }
    try {
      log.info("chapters", `DELETE received: book=${bookId} from=${no}`);
      const result = deleteChaptersFrom(handle, no);
      if (result.deletedChapters.length === 0) {
        return c.json({ error: "chapter_not_found", result }, 404);
      }
      return c.json({ result });
    } finally {
      deps.registry.endExclusive(bookId);
    }
  });

  app.delete("/api/books/:bookId/chapters", async (c) => {
    const bookId = c.req.param("bookId");
    if (!deps.registry) return c.json({ error: "service_not_ready" }, 503);
    const book = deps.registry.booksRepo.get(bookId);
    if (!book) return c.json({ error: "book_not_found" }, 404);
    const handle = deps.registry.open(bookId);
    if (!deps.registry.tryBeginExclusive(bookId)) {
      return c.json({ error: "book_busy" }, 409);
    }
    try {
      log.info("chapters", `DELETE ALL received: book=${bookId}`);
      const result = deleteChaptersFrom(handle, 1);
      return c.json({ result });
    } finally {
      deps.registry.endExclusive(bookId);
    }
  });

  return app;
}
