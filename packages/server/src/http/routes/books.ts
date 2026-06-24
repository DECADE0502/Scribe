import { Hono } from "hono";
import * as fs from "node:fs";
import type { LanguageModel } from "ai";
import type { ModelInfo } from "@scribe/shared";
import type { BookRegistry } from "../book-registry.js";
import { loadBookSnapshot } from "../../ai/context-builder/snapshot.js";
import { isOnboardComplete } from "../../ai/orchestrator/onboard-completeness.js";
import {
  seedPetCaptureDemo,
  shouldSeedPetCaptureDemo,
} from "../../ai/demo-seeds/pet-capture-demo.js";
import type { StyleReference } from "../../config/load.js";

export interface BookRoutesDeps {
  registry: BookRegistry;
  getModel?: () => LanguageModel | undefined;
  writeModelInfo?: ModelInfo;
  getMasterPrompt?: () => string;
  getStyleReferences?: () => StyleReference[];
}

export function bookRoutes(deps: BookRoutesDeps) {
  const app = new Hono();

  app.post("/api/books", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const titleRaw = String((body as Record<string, unknown> | null)?.title ?? "").trim();
    const title = titleRaw || "未命名作品";
    const genreRaw = (body as Record<string, unknown> | null)?.genre;
    const genre = typeof genreRaw === "string" ? genreRaw : null;
    const book = deps.registry.booksRepo.create({ title, genre });
    const handle = deps.registry.open(book.id);
    handle.bookMetaRepo.set("title", title);
    if (genre) handle.bookMetaRepo.set("genre", genre);

    const seedContent = [`Title: ${title}`, genre ? `Genre: ${genre}` : ""]
      .filter(Boolean)
      .join("\n");
    if (seedContent.trim()) {
      handle.worldbookRepo.create({
        title: "Core book seed",
        content: seedContent,
        activation: "constant",
        constant: true,
        priority: 100,
        category: "core",
        metadata: { seed: true, source: "create_book" },
      });
    }
    if (shouldSeedPetCaptureDemo(genre)) seedPetCaptureDemo(handle);

    return c.json(
      { id: book.id, title: book.title, genre: book.genre, createdAt: book.createdAt },
      201,
    );
  });

  app.get("/api/books", async (c) => {
    return c.json({ books: deps.registry.booksRepo.list() });
  });

  app.delete("/api/books/:bookId", async (c) => {
    const bookId = c.req.param("bookId");
    const book = deps.registry.booksRepo.get(bookId);
    if (!book) return c.json({ error: "book_not_found" }, 404);
    if (!deps.registry.tryBeginExclusive(bookId)) {
      return c.json({ error: "book_busy" }, 409);
    }
    try {
      deps.registry.closeBook(bookId);
      deps.registry.booksRepo.delete(bookId);
      const bookDir = deps.registry.paths.bookDir(bookId);
      if (fs.existsSync(bookDir)) fs.rmSync(bookDir, { recursive: true, force: true });
      return c.json({ ok: true });
    } finally {
      deps.registry.endExclusive(bookId);
    }
  });

  app.get("/api/books/:bookId/meta", async (c) => {
    const bookId = c.req.param("bookId");
    if (!deps.registry.booksRepo.get(bookId)) return c.json({ error: "book_not_found" }, 404);
    const handle = deps.registry.open(bookId);
    return c.json({
      title: handle.bookMetaRepo.get("title") ?? "",
      premise: handle.bookMetaRepo.get("premise") ?? "",
      tone: handle.bookMetaRepo.get("tone") ?? "",
      genre: handle.bookMetaRepo.get("genre") ?? "",
      goalForm: handle.bookMetaRepo.get("goal_form") ?? "",
      goalTargetChapters: handle.bookMetaRepo.get("goal_target_chapters") ?? "",
      goalEnding: handle.bookMetaRepo.get("goal_ending") ?? "",
      goalSequel: handle.bookMetaRepo.get("goal_sequel") ?? "",
    });
  });

  app.put("/api/books/:bookId/meta", async (c) => {
    const bookId = c.req.param("bookId");
    if (!deps.registry.booksRepo.get(bookId)) return c.json({ error: "book_not_found" }, 404);
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const handle = deps.registry.open(bookId);
    if (typeof body.premise === "string") handle.bookMetaRepo.set("premise", body.premise);
    if (typeof body.tone === "string") handle.bookMetaRepo.set("tone", body.tone);
    if (typeof body.genre === "string") handle.bookMetaRepo.set("genre", body.genre);
    if (typeof body.title === "string" && body.title.trim()) handle.bookMetaRepo.set("title", body.title.trim());
    if (typeof body.goalForm === "string") handle.bookMetaRepo.set("goal_form", body.goalForm.trim());
    if (typeof body.goalEnding === "string") handle.bookMetaRepo.set("goal_ending", body.goalEnding.trim());
    if (typeof body.goalSequel === "string") handle.bookMetaRepo.set("goal_sequel", body.goalSequel.trim());
    if (body.goalTargetChapters !== undefined) {
      const n = Number(body.goalTargetChapters);
      handle.bookMetaRepo.set("goal_target_chapters", Number.isFinite(n) && n > 0 ? String(Math.floor(n)) : "");
    }
    return c.json({ ok: true });
  });

  app.post("/api/books/:bookId/onboard", async (c) => {
    const bookId = c.req.param("bookId");
    const book = deps.registry.booksRepo.get(bookId);
    if (!book) return c.json({ error: "book_not_found" }, 404);
    return c.json({
      error: "legacy_onboard_route_removed",
      message: "Use /api/books/:bookId/agent/run with source:\"onboard\".",
      bookId,
    }, 410);
  });

  app.get("/api/books/:bookId/onboard-status", async (c) => {
    const bookId = c.req.param("bookId");
    const book = deps.registry.booksRepo.get(bookId);
    if (!book) return c.json({ error: "book_not_found" }, 404);
    const handle = deps.registry.open(bookId);
    const snapshot = loadBookSnapshot(
      bookId,
      {
        charactersRepo: handle.charactersRepo,
        outlineRepo: handle.outlineRepo,
        foreshadowingRepo: handle.foreshadowingRepo,
        chaptersRepo: handle.chaptersRepo,
        genreSectionsRepo: handle.genreSectionsRepo,
        bookMetaRepo: handle.bookMetaRepo,
      },
      { rulesMd: handle.rulesMdPath },
    );
    return c.json(isOnboardComplete(snapshot));
  });

  app.post("/api/books/:bookId/onboard/skip", async (c) => {
    const bookId = c.req.param("bookId");
    const book = deps.registry.booksRepo.get(bookId);
    if (!book) return c.json({ error: "book_not_found" }, 404);
    deps.registry.open(bookId);
    return c.json({ skipped: true });
  });

  app.get("/api/books/:bookId/master-prompt", async (c) => {
    const bookId = c.req.param("bookId");
    if (!deps.registry.booksRepo.get(bookId)) return c.json({ error: "book_not_found" }, 404);
    const handle = deps.registry.open(bookId);
    return c.json({
      perBook: handle.bookMetaRepo.get("master_prompt") ?? "",
      global: deps.getMasterPrompt?.() ?? "",
      enabled: handle.bookMetaRepo.get("master_prompt_enabled") !== "0",
    });
  });

  app.put("/api/books/:bookId/master-prompt", async (c) => {
    const bookId = c.req.param("bookId");
    if (!deps.registry.booksRepo.get(bookId)) return c.json({ error: "book_not_found" }, 404);
    const body = await c.req.json().catch(() => ({})) as { perBook?: unknown; enabled?: unknown };
    const handle = deps.registry.open(bookId);
    if (typeof body.perBook === "string") handle.bookMetaRepo.set("master_prompt", body.perBook);
    if (typeof body.enabled === "boolean") handle.bookMetaRepo.set("master_prompt_enabled", body.enabled ? "1" : "0");
    return c.json({
      perBook: handle.bookMetaRepo.get("master_prompt") ?? "",
      enabled: handle.bookMetaRepo.get("master_prompt_enabled") !== "0",
    });
  });

  app.get("/api/books/:bookId/style-reference", async (c) => {
    const bookId = c.req.param("bookId");
    if (!deps.registry.booksRepo.get(bookId)) return c.json({ error: "book_not_found" }, 404);
    const handle = deps.registry.open(bookId);
    return c.json({
      selectedId: handle.bookMetaRepo.get("style_reference_id") ?? "",
      enabled: handle.bookMetaRepo.get("style_reference_enabled") !== "0",
      references: deps.getStyleReferences?.() ?? [],
    });
  });

  app.put("/api/books/:bookId/style-reference", async (c) => {
    const bookId = c.req.param("bookId");
    if (!deps.registry.booksRepo.get(bookId)) return c.json({ error: "book_not_found" }, 404);
    const body = await c.req.json().catch(() => ({})) as { selectedId?: unknown; enabled?: unknown };
    const handle = deps.registry.open(bookId);
    if (typeof body.selectedId === "string") handle.bookMetaRepo.set("style_reference_id", body.selectedId.trim());
    if (typeof body.enabled === "boolean") handle.bookMetaRepo.set("style_reference_enabled", body.enabled ? "1" : "0");
    return c.json({
      selectedId: handle.bookMetaRepo.get("style_reference_id") ?? "",
      enabled: handle.bookMetaRepo.get("style_reference_enabled") !== "0",
    });
  });

  return app;
}
