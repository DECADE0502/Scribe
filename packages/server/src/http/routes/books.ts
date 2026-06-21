import { Hono } from "hono";
import * as fs from "node:fs";
import type { LanguageModel } from "ai";
import { ExecutionModeSchema } from "@scribe/shared";
import { streamSseResponse } from "../sse.js";
import type { BookRegistry } from "../book-registry.js";
import { runNewBookConversation } from "../../ai/orchestrator/new-book.js";
import { resolveDeepestPrompt } from "../../ai/prompts/deepest-prompt.js";
import { loadBookSnapshot } from "../../ai/context-builder/snapshot.js";
import {
  isOnboardComplete,
  formatCompletenessHint,
} from "../../ai/orchestrator/onboard-completeness.js";
import {
  seedPetCaptureDemo,
  shouldSeedPetCaptureDemo,
} from "../../ai/demo-seeds/pet-capture-demo.js";
import type { StyleReference } from "../../config/load.js";

export interface BookRoutesDeps {
  registry: BookRegistry;
  getModel?: () => LanguageModel | undefined;
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
    const seedContent = [
      `Title: ${title}`,
      genre ? `Genre: ${genre}` : "",
    ].filter(Boolean).join("\n");
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
    if (shouldSeedPetCaptureDemo(genre)) {
      seedPetCaptureDemo(handle);
    }
    return c.json(
      { id: book.id, title: book.title, genre: book.genre, createdAt: book.createdAt },
      201,
    );
  });

  app.get("/api/books", async (c) => {
    const books = deps.registry.booksRepo.list();
    return c.json({ books });
  });

  // 删除书:关闭 DB 连接 → 删除 library.db 记录 → 删除书目录文件
  app.delete("/api/books/:bookId", async (c) => {
    const bookId = c.req.param("bookId");
    const book = deps.registry.booksRepo.get(bookId);
    if (!book) return c.json({ error: "书不存在" }, 404);
    // 先关闭 workspace.db 连接,避免文件锁
    deps.registry.closeBook(bookId);
    // 删除 library.db 里的书记录
    deps.registry.booksRepo.delete(bookId);
    // 删除书目录(章节 md、workspace.db 等)
    try {
      const bookDir = deps.registry.paths.bookDir(bookId);
      if (fs.existsSync(bookDir)) {
        fs.rmSync(bookDir, { recursive: true, force: true });
      }
    } catch (e) {
      // 文件删除失败不阻断 API 响应,只记录
      console.error(`删除书目录失败(${bookId}):`, (e as Error).message);
    }
    return c.json({ ok: true });
  });

  // ---- Meta 设置 API ----
  // 作者直接填表设置 premise/tone/genre,不需要走对话流程
  app.get("/api/books/:bookId/meta", async (c) => {
    const bookId = c.req.param("bookId");
    if (!deps.registry.booksRepo.get(bookId)) return c.json({ error: "书不存在" }, 404);
    const handle = deps.registry.open(bookId);
    return c.json({
      title: handle.bookMetaRepo.get("title") ?? "",
      premise: handle.bookMetaRepo.get("premise") ?? "",
      tone: handle.bookMetaRepo.get("tone") ?? "",
      genre: handle.bookMetaRepo.get("genre") ?? "",
    });
  });

  app.put("/api/books/:bookId/meta", async (c) => {
    const bookId = c.req.param("bookId");
    if (!deps.registry.booksRepo.get(bookId)) return c.json({ error: "书不存在" }, 404);
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const handle = deps.registry.open(bookId);
    if (typeof body.premise === "string") handle.bookMetaRepo.set("premise", body.premise);
    if (typeof body.tone === "string") handle.bookMetaRepo.set("tone", body.tone);
    if (typeof body.genre === "string") handle.bookMetaRepo.set("genre", body.genre);
    if (typeof body.title === "string" && body.title.trim()) {
      handle.bookMetaRepo.set("title", body.title.trim());
    }
    return c.json({ ok: true });
  });

  app.post("/api/books/:bookId/onboard", async (c) => {
    const bookId = c.req.param("bookId");
    const book = deps.registry.booksRepo.get(bookId);
    if (!book) return c.json({ error: "书不存在" }, 404);

    const body = await c.req.json().catch(() => ({}));
    const message = String((body as Record<string, unknown> | null)?.message ?? "").trim();
    if (!message) return c.json({ error: "message 不能为空" }, 400);
    const historyRaw = (body as Record<string, unknown> | null)?.history;
    const history = Array.isArray(historyRaw) ? historyRaw : [];
    const executionMode = ExecutionModeSchema.optional().catch(undefined).parse(
      (body as Record<string, unknown> | null)?.executionMode,
    );

    const model = deps.getModel?.();
    if (!model) return c.json({ error: "未配置模型,请先在设置中配置 API Key" }, 503);

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
    const completeness = isOnboardComplete(snapshot);
    const completenessHint = formatCompletenessHint(completeness);

    const inner = runNewBookConversation(
      {
        model,
        toolDeps: {
          bookMetaToolsDeps: {
            bookMetaRepo: handle.bookMetaRepo,
            charactersRepo: handle.charactersRepo,
            outlineRepo: handle.outlineRepo,
            rulesMdPath: handle.rulesMdPath,
          },
          genreToolsDeps: {
            repo: handle.genreSectionsRepo,
            charactersRepo: handle.charactersRepo,
          },
        },
        abortSignal: c.req.raw.signal,
        deepestPrompt: resolveDeepestPrompt({
          perBook: handle.bookMetaRepo.get("master_prompt"),
          global: deps.getMasterPrompt?.() ?? "",
        }),
      },
      { history, message, completenessHint, executionMode },
    );

    // 对话持久化:user 消息即刻入库,assistant 文本在流完后入库
    async function* persisting() {
      handle.conversationsRepo.append({ role: "user", content: message, metadata: { kind: "onboard" } });
      let buf = "";
      for await (const ev of inner) {
        if (ev.type === "text_delta") buf += ev.delta;
        if (ev.type === "done" && buf.trim()) {
          handle.conversationsRepo.append({ role: "assistant", content: buf, metadata: { kind: "onboard" } });
        }
        yield ev;
      }
    }
    return streamSseResponse(persisting());
  });

  app.get("/api/books/:bookId/onboard-status", async (c) => {
    const bookId = c.req.param("bookId");
    const book = deps.registry.booksRepo.get(bookId);
    if (!book) return c.json({ error: "书不存在" }, 404);
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
    if (!book) return c.json({ error: "书不存在" }, 404);
    deps.registry.open(bookId);
    return c.json({ skipped: true });
  });

  // 本书的「最深处提示词」覆盖(空串=不覆盖,回退全局)
  app.get("/api/books/:bookId/master-prompt", async (c) => {
    const bookId = c.req.param("bookId");
    if (!deps.registry.booksRepo.get(bookId)) return c.json({ error: "书不存在" }, 404);
    const handle = deps.registry.open(bookId);
    return c.json({
      perBook: handle.bookMetaRepo.get("master_prompt") ?? "",
      global: deps.getMasterPrompt?.() ?? "",
    });
  });

  app.put("/api/books/:bookId/master-prompt", async (c) => {
    const bookId = c.req.param("bookId");
    if (!deps.registry.booksRepo.get(bookId)) return c.json({ error: "书不存在" }, 404);
    const body = await c.req.json().catch(() => ({})) as { perBook?: unknown };
    const value = typeof body.perBook === "string" ? body.perBook : "";
    const handle = deps.registry.open(bookId);
    handle.bookMetaRepo.set("master_prompt", value);
    return c.json({ perBook: value });
  });

  app.get("/api/books/:bookId/style-reference", async (c) => {
    const bookId = c.req.param("bookId");
    if (!deps.registry.booksRepo.get(bookId)) return c.json({ error: "书不存在" }, 404);
    const handle = deps.registry.open(bookId);
    return c.json({
      selectedId: handle.bookMetaRepo.get("style_reference_id") ?? "",
      references: deps.getStyleReferences?.() ?? [],
    });
  });

  app.put("/api/books/:bookId/style-reference", async (c) => {
    const bookId = c.req.param("bookId");
    if (!deps.registry.booksRepo.get(bookId)) return c.json({ error: "书不存在" }, 404);
    const body = await c.req.json().catch(() => ({})) as { selectedId?: unknown };
    const selectedId = typeof body.selectedId === "string" ? body.selectedId.trim() : "";
    const handle = deps.registry.open(bookId);
    handle.bookMetaRepo.set("style_reference_id", selectedId);
    return c.json({ selectedId });
  });

  return app;
}
