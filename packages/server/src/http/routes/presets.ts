import { Hono } from "hono";
import {
  SillyTavernRegexScriptSchema,
  type PromptRole,
} from "@scribe/shared";
import type { BookRegistry } from "../book-registry.js";

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function presetRoutes(deps: { registry: BookRegistry }) {
  const app = new Hono();

  function openHandle(bookId: string) {
    const book = deps.registry.booksRepo.get(bookId);
    return book ? deps.registry.open(bookId) : undefined;
  }

  app.get("/api/books/:bookId/presets", async (c) => {
    const handle = openHandle(c.req.param("bookId"));
    if (!handle) return c.json({ error: "book_not_found" }, 404);
    const presets = handle.promptPresetsRepo.listPresets().map((preset) => ({
      ...preset,
      blocks: handle.promptPresetsRepo.listBlocks(preset.id),
    }));
    return c.json({ presets });
  });

  app.put("/api/books/:bookId/presets/:presetId", async (c) => {
    const handle = openHandle(c.req.param("bookId"));
    if (!handle) return c.json({ error: "book_not_found" }, 404);
    const current = handle.promptPresetsRepo.getPreset(c.req.param("presetId"));
    if (!current) {
      return c.json({ error: "preset_not_found" }, 404);
    }
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const patch: {
      enabled?: boolean;
      name?: string;
      regexScriptsEnabled?: boolean;
      generationSettings?: Record<string, unknown>;
      extensions?: Record<string, unknown>;
    } = {};
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
    if (typeof body.regexScriptsEnabled === "boolean") {
      patch.regexScriptsEnabled = body.regexScriptsEnabled;
    }
    if (isPlainRecord(body.generationSettings)) {
      patch.generationSettings = body.generationSettings;
    }
    if (Array.isArray(body.regexScripts)) {
      const parsed = body.regexScripts.map((script) =>
        SillyTavernRegexScriptSchema.safeParse(script),
      );
      const failed = parsed.find((result) => !result.success);
      if (failed && !failed.success) {
        return c.json({
          error: "invalid_regex_script",
          issues: failed.error.issues,
        }, 400);
      }
      patch.extensions = {
        ...current.extensions,
        regex_scripts: parsed
          .filter((result) => result.success)
          .map((result) => result.data),
      };
    }
    if (typeof body.name === "string" && body.name.trim()) {
      patch.name = body.name.trim();
    }
    return c.json({
      preset: handle.promptPresetsRepo.updatePreset(
        c.req.param("presetId"),
        patch,
      ),
    });
  });

  app.put("/api/books/:bookId/presets/:presetId/blocks/:blockId", async (c) => {
    const handle = openHandle(c.req.param("bookId"));
    if (!handle) return c.json({ error: "book_not_found" }, 404);
    if (!handle.promptPresetsRepo.getPreset(c.req.param("presetId"))) {
      return c.json({ error: "preset_not_found" }, 404);
    }
    const block = handle.promptPresetsRepo.getBlock(c.req.param("blockId"));
    if (!block || block.presetId !== c.req.param("presetId")) {
      return c.json({ error: "prompt_block_not_found" }, 404);
    }

    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const patch: {
      enabled?: boolean;
      stackIndex?: number | null;
      name?: string;
      content?: string;
      role?: PromptRole;
      injectionDepth?: number | null;
      injectionOrder?: number | null;
      injectionPosition?: number | null;
    } = {};
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
    if (typeof body.stackIndex === "number") patch.stackIndex = Math.trunc(body.stackIndex);
    if (body.stackIndex === null) patch.stackIndex = null;
    if (typeof body.name === "string") patch.name = body.name;
    if (typeof body.content === "string") patch.content = body.content;
    if (body.role === "system" || body.role === "user" || body.role === "assistant") {
      patch.role = body.role;
    }
    if (typeof body.injectionDepth === "number") {
      patch.injectionDepth = Math.max(0, Math.trunc(body.injectionDepth));
    }
    if (body.injectionDepth === null) patch.injectionDepth = null;
    if (typeof body.injectionOrder === "number") {
      patch.injectionOrder = Math.trunc(body.injectionOrder);
    }
    if (body.injectionOrder === null) patch.injectionOrder = null;
    if (typeof body.injectionPosition === "number") {
      patch.injectionPosition = Math.trunc(body.injectionPosition);
    }
    if (body.injectionPosition === null) patch.injectionPosition = null;
    return c.json({
      block: handle.promptPresetsRepo.updateBlock(c.req.param("blockId"), patch),
    });
  });

  return app;
}
