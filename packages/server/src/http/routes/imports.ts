import { Hono } from "hono";
import type { BookRegistry } from "../book-registry.js";
import {
  importSillyTavernJson,
  previewSillyTavernImport,
} from "../../ai/import/import-service.js";

export function importRoutes(deps: { registry: BookRegistry }) {
  const app = new Hono();

  function openHandle(bookId: string) {
    const book = deps.registry.booksRepo.get(bookId);
    return book ? deps.registry.open(bookId) : undefined;
  }

  app.post("/api/books/:bookId/imports/preview", async (c) => {
    const handle = openHandle(c.req.param("bookId"));
    if (!handle) return c.json({ error: "book_not_found" }, 404);
    const body = await c.req.json().catch(() => undefined) as
      | { filename?: unknown; json?: unknown }
      | undefined;
    if (!body || typeof body.filename !== "string") {
      return c.json({ error: "invalid_import_payload" }, 400);
    }
    try {
      return c.json(previewSillyTavernImport({
        filename: body.filename,
        json: body.json,
      }));
    } catch (error) {
      return c.json({
        error: "invalid_import_json",
        message: error instanceof Error ? error.message : String(error),
      }, 400);
    }
  });

  app.post("/api/books/:bookId/imports", async (c) => {
    const handle = openHandle(c.req.param("bookId"));
    if (!handle) return c.json({ error: "book_not_found" }, 404);
    const body = await c.req.json().catch(() => undefined) as
      | { filename?: unknown; json?: unknown }
      | undefined;
    if (!body || typeof body.filename !== "string") {
      return c.json({ error: "invalid_import_payload" }, 400);
    }
    try {
      const result = importSillyTavernJson(handle, {
        filename: body.filename,
        json: body.json,
      });
      if (result.sourceType === "unknown_json") {
        return c.json({ error: "unsupported_import_json" }, 400);
      }
      return c.json(result, 201);
    } catch (error) {
      return c.json({
        error: "invalid_import_json",
        message: error instanceof Error ? error.message : String(error),
      }, 400);
    }
  });

  return app;
}
