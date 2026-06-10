import * as fs from "node:fs";
import * as path from "node:path";
import { Hono } from "hono";
import type { BookRegistry } from "../book-registry.js";
import type { AppPaths } from "../../config/paths.js";
import { exportChapters, type ExportRange } from "../../fs/exporter.js";

export interface ExportRoutesDeps {
  registry: BookRegistry;
  paths: AppPaths;
}

export function exportRoutes(deps: ExportRoutesDeps) {
  const app = new Hono();

  app.post("/api/books/:bookId/export", async (c) => {
    const bookId = c.req.param("bookId");
    const book = deps.registry.booksRepo.get(bookId);
    if (!book) return c.json({ error: "书不存在" }, 404);
    const body = await c.req.json().catch(() => ({})) as { format?: unknown; chapter?: unknown };
    const format = body.format === "txt" ? "txt" : "md";
    const range: ExportRange = typeof body.chapter === "number" && body.chapter >= 1
      ? { chapter: body.chapter }
      : "all";
    const handle = deps.registry.open(bookId);
    try {
      const result = exportChapters(
        { chapterFiles: handle.chapterFiles, exportsDir: deps.paths.exportsDir(bookId) },
        book.title,
        { format, range },
      );
      return c.json({ filename: result.filename, bytes: result.bytes });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });

  // 直接下载导出文件
  app.get("/api/books/:bookId/exports/:filename", async (c) => {
    const bookId = c.req.param("bookId");
    const book = deps.registry.booksRepo.get(bookId);
    if (!book) return c.json({ error: "书不存在" }, 404);
    const filename = c.req.param("filename");
    if (filename.includes("..") || filename.includes("/")) {
      return c.json({ error: "文件名无效" }, 400);
    }
    const full = path.posix.join(deps.paths.exportsDir(bookId), filename);
    if (!fs.existsSync(full)) return c.json({ error: "文件不存在" }, 404);
    const content = fs.readFileSync(full);
    return new Response(content, {
      headers: {
        "Content-Type": filename.endsWith(".md") ? "text/markdown; charset=utf-8" : "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    });
  });

  return app;
}
