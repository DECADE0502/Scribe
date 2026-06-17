import { Hono } from "hono";
import type { LanguageModel } from "ai";
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

export interface BookRoutesDeps {
  registry: BookRegistry;
  getModel?: () => LanguageModel | undefined;
  getMasterPrompt?: () => string;
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

  app.post("/api/books/:bookId/onboard", async (c) => {
    const bookId = c.req.param("bookId");
    const book = deps.registry.booksRepo.get(bookId);
    if (!book) return c.json({ error: "书不存在" }, 404);

    const body = await c.req.json().catch(() => ({}));
    const message = String((body as Record<string, unknown> | null)?.message ?? "").trim();
    if (!message) return c.json({ error: "message 不能为空" }, 400);
    const historyRaw = (body as Record<string, unknown> | null)?.history;
    const history = Array.isArray(historyRaw) ? historyRaw : [];

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
      { history, message, completenessHint },
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

  return app;
}
