import { Hono } from "hono";
import type { LanguageModel } from "ai";
import {
  NewWorldbookEntryInputSchema,
  WorldbookEntryPatchSchema,
} from "@scribe/shared";
import type { BookRegistry } from "../book-registry.js";
import { streamSseResponse } from "../sse.js";
import {
  renderWorldbookEntries,
  retrieveWorldbookEntries,
} from "../../ai/worldbook/retrieval.js";
import { runWorldbookChat } from "../../ai/orchestrator/worldbook-chat.js";

export interface WorldbookRoutesDeps {
  registry: BookRegistry;
  getModel?: () => LanguageModel | undefined;
}

export function worldbookRoutes(deps: WorldbookRoutesDeps) {
  const app = new Hono();

  function openHandle(bookId: string) {
    const book = deps.registry.booksRepo.get(bookId);
    if (!book) return undefined;
    return deps.registry.open(bookId);
  }

  app.get("/api/books/:bookId/worldbook", async (c) => {
    const handle = openHandle(c.req.param("bookId"));
    if (!handle) return c.json({ error: "book_not_found" }, 404);
    return c.json({ entries: handle.worldbookRepo.list() });
  });

  app.post("/api/books/:bookId/worldbook", async (c) => {
    const handle = openHandle(c.req.param("bookId"));
    if (!handle) return c.json({ error: "book_not_found" }, 404);
    const body = await c.req.json().catch(() => undefined);
    const parsed = NewWorldbookEntryInputSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_worldbook_entry", issues: parsed.error.issues }, 400);
    }
    return c.json({ entry: handle.worldbookRepo.create(parsed.data) }, 201);
  });

  app.put("/api/books/:bookId/worldbook/:entryId", async (c) => {
    const handle = openHandle(c.req.param("bookId"));
    if (!handle) return c.json({ error: "book_not_found" }, 404);
    const body = await c.req.json().catch(() => undefined);
    const parsed = WorldbookEntryPatchSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_worldbook_patch", issues: parsed.error.issues }, 400);
    }
    const id = c.req.param("entryId");
    if (!handle.worldbookRepo.get(id)) {
      return c.json({ error: "worldbook_entry_not_found" }, 404);
    }
    return c.json({ entry: handle.worldbookRepo.update(id, parsed.data) });
  });

  app.delete("/api/books/:bookId/worldbook/:entryId", async (c) => {
    const handle = openHandle(c.req.param("bookId"));
    if (!handle) return c.json({ error: "book_not_found" }, 404);
    const id = c.req.param("entryId");
    if (!handle.worldbookRepo.get(id)) {
      return c.json({ error: "worldbook_entry_not_found" }, 404);
    }
    handle.worldbookRepo.delete(id);
    return c.body(null, 204);
  });

  app.post("/api/books/:bookId/worldbook/preview", async (c) => {
    const handle = openHandle(c.req.param("bookId"));
    if (!handle) return c.json({ error: "book_not_found" }, 404);
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const query = typeof body.query === "string" ? body.query : "";
    const extraText = Array.isArray(body.extraText)
      ? body.extraText.filter((value): value is string => typeof value === "string")
      : undefined;
    const tokenBudget =
      typeof body.tokenBudget === "number" ? body.tokenBudget : undefined;
    const result = retrieveWorldbookEntries({
      entries: handle.worldbookRepo.list({ enabledOnly: true }),
      query,
      extraText,
      tokenBudget,
    });
    return c.json({
      ...result,
      rendered: renderWorldbookEntries(result.selected),
    });
  });

  app.post("/api/books/:bookId/worldbook/chat", async (c) => {
    const handle = openHandle(c.req.param("bookId"));
    if (!handle) return c.json({ error: "book_not_found" }, 404);
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) return c.json({ error: "message_required" }, 400);
    const model = deps.getModel?.();
    if (!model) return c.json({ error: "model_not_configured" }, 503);
    const history = Array.isArray(body.history) ? body.history : [];
    const chatHandle = handle;
    const chatModel = model;

    async function* persisting() {
      chatHandle.conversationsRepo.append({
        role: "user",
        content: message,
        metadata: { kind: "worldbook" },
      });
      let buffer = "";
      for await (const event of runWorldbookChat(
        {
          model: chatModel,
          toolDeps: { repo: chatHandle.worldbookRepo },
          abortSignal: c.req.raw.signal,
        },
        { message, history: history as never },
      )) {
        if (event.type === "text_delta") buffer += event.delta;
        if (event.type === "done" && buffer.trim()) {
          chatHandle.conversationsRepo.append({
            role: "assistant",
            content: buffer,
            metadata: { kind: "worldbook" },
          });
        }
        yield event;
      }
    }

    return streamSseResponse(persisting());
  });

  return app;
}
