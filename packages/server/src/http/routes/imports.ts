import { Hono } from "hono";
import type { BookRegistry } from "../book-registry.js";
import {
  importSillyTavernJson,
  previewSillyTavernImport,
  ImportTooLargeError,
} from "../../ai/import/import-service.js";
import {
  BUILTIN_SAMPLES,
  getBuiltinSample,
  readBuiltinSampleJson,
} from "../../ai/demo-seeds/builtin-samples.js";

export function importRoutes(deps: { registry: BookRegistry }) {
  const app = new Hono();

  function openHandle(bookId: string) {
    const book = deps.registry.booksRepo.get(bookId);
    return book ? deps.registry.open(bookId) : undefined;
  }

  // 列出内置示例(供导入面板一键导入)
  app.get("/api/sample-imports", async (c) => {
    const samples = BUILTIN_SAMPLES.map((s) => {
      let sourceType = "unknown_json";
      let stats: unknown = undefined;
      try {
        const { filename, json } = readBuiltinSampleJson(s);
        const preview = previewSillyTavernImport({ filename, json });
        sourceType = preview.sourceType;
        stats = preview.stats;
      } catch { /* 文件缺失则该示例标为 unknown */ }
      return { id: s.id, name: s.name, description: s.description, sourceType, stats };
    });
    return c.json({ samples });
  });

  // 一键导入某个内置示例(复用与文件导入完全相同的流水线)
  app.post("/api/books/:bookId/imports/sample", async (c) => {
    const handle = openHandle(c.req.param("bookId"));
    if (!handle) return c.json({ error: "book_not_found" }, 404);
    const body = await c.req.json().catch(() => undefined) as { sampleId?: unknown } | undefined;
    const sample = typeof body?.sampleId === "string" ? getBuiltinSample(body.sampleId) : undefined;
    if (!sample) return c.json({ error: "sample_not_found" }, 404);
    if (!deps.registry.tryBeginExclusive(c.req.param("bookId"))) {
      return c.json({ error: "book_busy", message: "这本书正在写作/生成或另一项操作进行中,请稍后再导入" }, 409);
    }
    try {
      const { filename, json } = readBuiltinSampleJson(sample);
      const result = importSillyTavernJson(handle, { filename, json });
      if (result.sourceType === "unknown_json") {
        return c.json({ error: "unsupported_import_json" }, 400);
      }
      return c.json(result, 201);
    } catch (error) {
      if (error instanceof ImportTooLargeError) {
        return c.json({ error: "import_too_large", message: error.message }, 413);
      }
      return c.json({
        error: "invalid_import_json",
        message: error instanceof Error ? error.message : String(error),
      }, 400);
    } finally {
      deps.registry.endExclusive(c.req.param("bookId"));
    }
  });

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
      if (error instanceof ImportTooLargeError) {
        return c.json({ error: "import_too_large", message: error.message }, 413);
      }
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
    if (!deps.registry.tryBeginExclusive(c.req.param("bookId"))) {
      return c.json({ error: "book_busy", message: "这本书正在写作/生成或另一项操作进行中,请稍后再导入" }, 409);
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
      if (error instanceof ImportTooLargeError) {
        return c.json({ error: "import_too_large", message: error.message }, 413);
      }
      return c.json({
        error: "invalid_import_json",
        message: error instanceof Error ? error.message : String(error),
      }, 400);
    } finally {
      deps.registry.endExclusive(c.req.param("bookId"));
    }
  });

  return app;
}
