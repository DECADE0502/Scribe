import * as fs from "node:fs";
import { Hono } from "hono";
import type { BookRegistry } from "../book-registry.js";
import { validateItemAgainstSchema, ValidationError } from "../../ai/genre-section-validator.js";
import { createConversationMessageService } from "../../ai/conversation-message-service.js";

export interface SidebarRoutesDeps {
  registry: BookRegistry;
}

export function sidebarRoutes(deps: SidebarRoutesDeps) {
  const app = new Hono();

  const withBook = (bookId: string) => {
    const book = deps.registry.booksRepo.get(bookId);
    if (!book) return null;
    return deps.registry.open(bookId);
  };

  app.get("/api/books/:bookId/characters", async (c) => {
    const handle = withBook(c.req.param("bookId"));
    if (!handle) return c.json({ error: "book_not_found" }, 404);
    return c.json({ characters: handle.charactersRepo.list() });
  });

  app.put("/api/books/:bookId/characters/:cid", async (c) => {
    const handle = withBook(c.req.param("bookId"));
    if (!handle) return c.json({ error: "book_not_found" }, 404);
    const cid = c.req.param("cid");
    const existing = handle.charactersRepo.get(cid);
    if (!existing) return c.json({ error: "character_not_found" }, 404);

    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
    if (body.role !== undefined) patch.role = body.role;
    if (body.baseData !== undefined) patch.baseData = body.baseData;
    if (body.currentState !== undefined) patch.currentState = body.currentState;

    const updated = handle.charactersRepo.update(cid, patch);
    createConversationMessageService(handle.conversationsRepo).recordManualAssetChange({
      content: `用户手动修改了角色「${updated.name}」的资料，请以最新资料为准。`,
      target: "character",
      id: cid,
    });
    return c.json(updated);
  });

  app.get("/api/books/:bookId/outline", async (c) => {
    const handle = withBook(c.req.param("bookId"));
    if (!handle) return c.json({ error: "book_not_found" }, 404);
    return c.json({ outline: handle.outlineRepo.listAll() });
  });

  app.post("/api/books/:bookId/outline", async (c) => {
    const handle = withBook(c.req.param("bookId"));
    if (!handle) return c.json({ error: "book_not_found" }, 404);
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const node = handle.outlineRepo.create({
      parentId: typeof body.parentId === "string" ? body.parentId : null,
      level: typeof body.level === "string" ? body.level as "volume" | "arc" | "chapter" : "chapter",
      title: typeof body.title === "string" ? body.title : "",
      summary: typeof body.summary === "string" ? body.summary : "",
      status: typeof body.status === "string" ? body.status as "planned" | "in_progress" | "done" : "planned",
      sortOrder: typeof body.sortOrder === "number" ? body.sortOrder : 0,
      metadata: null,
    });
    if (node.parentId) handle.outlineRepo.clearAncestorSummariesByParentId(node.parentId);
    return c.json(node, 201);
  });

  app.put("/api/books/:bookId/outline/:nodeId", async (c) => {
    const handle = withBook(c.req.param("bookId"));
    if (!handle) return c.json({ error: "book_not_found" }, 404);
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if (typeof body.title === "string") patch.title = body.title;
    if (typeof body.summary === "string") patch.summary = body.summary;
    if (typeof body.status === "string") patch.status = body.status;
    if (typeof body.level === "string") patch.level = body.level;
    if (typeof body.sortOrder === "number") patch.sortOrder = body.sortOrder;
    if (typeof body.parentId === "string" || body.parentId === null) patch.parentId = body.parentId;

    const oldNode = handle.outlineRepo.get(c.req.param("nodeId"));
    const node = handle.outlineRepo.update(c.req.param("nodeId"), patch);
    handle.outlineRepo.updateSummary(node.id, null);
    handle.outlineRepo.clearAncestorSummaries(node.id);
    if (oldNode && oldNode.parentId !== node.parentId && oldNode.parentId) {
      handle.outlineRepo.clearAncestorSummariesByParentId(oldNode.parentId);
    }
    return c.json(node);
  });

  app.delete("/api/books/:bookId/outline/:nodeId", async (c) => {
    const handle = withBook(c.req.param("bookId"));
    if (!handle) return c.json({ error: "book_not_found" }, 404);
    const dying = handle.outlineRepo.get(c.req.param("nodeId"));
    handle.outlineRepo.delete(c.req.param("nodeId"));
    if (dying?.parentId) handle.outlineRepo.clearAncestorSummariesByParentId(dying.parentId);
    return c.json({ ok: true });
  });

  app.get("/api/books/:bookId/foreshadowing", async (c) => {
    const handle = withBook(c.req.param("bookId"));
    if (!handle) return c.json({ error: "book_not_found" }, 404);
    return c.json({ foreshadowing: handle.foreshadowingRepo.list() });
  });

  app.post("/api/books/:bookId/foreshadowing", async (c) => {
    const handle = withBook(c.req.param("bookId"));
    if (!handle) return c.json({ error: "book_not_found" }, 404);
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const label = String(body.label ?? "").trim();
    if (!label) return c.json({ error: "label_empty" }, 400);

    const created = handle.foreshadowingRepo.create({
      label,
      description: typeof body.description === "string" ? body.description : null,
      plantedChapter: typeof body.plantedChapter === "number" ? body.plantedChapter : null,
      paidChapter: null,
      status: "active",
      relatedCharacters: Array.isArray(body.relatedCharacters)
        ? body.relatedCharacters.map(String)
        : [],
    });
    createConversationMessageService(handle.conversationsRepo).recordManualAssetChange({
      content: `用户手动添加了伏笔「${label}」。`,
      target: "foreshadowing",
      id: created.id,
    });
    return c.json(created, 201);
  });

  app.delete("/api/books/:bookId/foreshadowing/:fid", async (c) => {
    const handle = withBook(c.req.param("bookId"));
    if (!handle) return c.json({ error: "book_not_found" }, 404);
    const fid = c.req.param("fid");
    const existing = handle.foreshadowingRepo.get(fid);
    if (!existing) return c.json({ error: "foreshadowing_not_found" }, 404);

    handle.foreshadowingRepo.delete(fid);
    createConversationMessageService(handle.conversationsRepo).recordManualAssetChange({
      content: `用户手动删除了伏笔「${existing.label}」。`,
      target: "foreshadowing",
      id: fid,
    });
    return c.json({ deleted: fid });
  });

  app.get("/api/books/:bookId/timeline", async (c) => {
    const handle = withBook(c.req.param("bookId"));
    if (!handle) return c.json({ error: "book_not_found" }, 404);
    return c.json({ timeline: handle.timelineRepo.listAll() });
  });

  app.get("/api/books/:bookId/rules", async (c) => {
    const handle = withBook(c.req.param("bookId"));
    if (!handle) return c.json({ error: "book_not_found" }, 404);
    const content = fs.existsSync(handle.rulesMdPath)
      ? fs.readFileSync(handle.rulesMdPath, "utf-8")
      : "";
    return c.json({ content });
  });

  app.put("/api/books/:bookId/rules", async (c) => {
    const handle = withBook(c.req.param("bookId"));
    if (!handle) return c.json({ error: "book_not_found" }, 404);
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const content = String(body.content ?? "");
    fs.writeFileSync(handle.rulesMdPath, content, "utf-8");
    createConversationMessageService(handle.conversationsRepo).recordManualAssetChange({
      content: "用户手动更新了写作规则 rules.md，请以最新规则为准。",
      target: "rules",
    });
    return c.json({ bytes: Buffer.byteLength(content, "utf-8") });
  });

  app.get("/api/books/:bookId/genre-sections", async (c) => {
    const handle = withBook(c.req.param("bookId"));
    if (!handle) return c.json({ error: "book_not_found" }, 404);
    const sections = handle.genreSectionsRepo.listSections().map(section => ({
      section,
      items: handle.genreSectionsRepo.listItems(section.id),
    }));
    return c.json({ sections });
  });

  app.post("/api/books/:bookId/genre-sections/:sectionId/items", async (c) => {
    const handle = withBook(c.req.param("bookId"));
    if (!handle) return c.json({ error: "book_not_found" }, 404);
    const section = handle.genreSectionsRepo.getSection(c.req.param("sectionId"));
    if (!section) return c.json({ error: "genre_section_not_found" }, 404);
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const data = (body.data ?? {}) as Record<string, unknown>;

    try {
      validateItemAgainstSchema(section, data, handle.charactersRepo, handle.genreSectionsRepo);
    } catch (e) {
      if (e instanceof ValidationError) return c.json({ error: e.message }, 400);
      throw e;
    }

    const item = handle.genreSectionsRepo.addItem(section.id, data);
    createConversationMessageService(handle.conversationsRepo).recordManualAssetChange({
      content: `用户在板块「${section.name}」手动添加了条目。`,
      target: "genre_section_item",
      id: item.id,
    });
    return c.json(item, 201);
  });

  app.put("/api/books/:bookId/genre-sections/items/:itemId", async (c) => {
    const handle = withBook(c.req.param("bookId"));
    if (!handle) return c.json({ error: "book_not_found" }, 404);
    const itemId = c.req.param("itemId");
    const item = handle.genreSectionsRepo.getItem(itemId);
    if (!item) return c.json({ error: "genre_section_item_not_found" }, 404);
    const section = handle.genreSectionsRepo.getSection(item.sectionId);
    if (!section) return c.json({ error: "genre_section_deleted" }, 409);
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const merged = { ...item.data, ...(body.data as Record<string, unknown> ?? {}) };

    try {
      validateItemAgainstSchema(section, merged, handle.charactersRepo, handle.genreSectionsRepo);
    } catch (e) {
      if (e instanceof ValidationError) return c.json({ error: e.message }, 400);
      throw e;
    }

    const updated = handle.genreSectionsRepo.updateItem(itemId, merged);
    createConversationMessageService(handle.conversationsRepo).recordManualAssetChange({
      content: `用户在板块「${section.name}」手动修改了条目。`,
      target: "genre_section_item",
      id: itemId,
    });
    return c.json(updated);
  });

  app.delete("/api/books/:bookId/genre-sections/items/:itemId", async (c) => {
    const handle = withBook(c.req.param("bookId"));
    if (!handle) return c.json({ error: "book_not_found" }, 404);
    const itemId = c.req.param("itemId");
    const item = handle.genreSectionsRepo.getItem(itemId);
    if (!item) return c.json({ error: "genre_section_item_not_found" }, 404);
    handle.genreSectionsRepo.deleteItem(itemId);
    return c.json({ deleted: itemId });
  });

  app.delete("/api/books/:bookId/genre-sections/:sectionId", async (c) => {
    const handle = withBook(c.req.param("bookId"));
    if (!handle) return c.json({ error: "book_not_found" }, 404);
    const section = handle.genreSectionsRepo.getSection(c.req.param("sectionId"));
    if (!section) return c.json({ error: "genre_section_not_found" }, 404);
    const itemsCount = handle.genreSectionsRepo.listItems(section.id).length;
    handle.genreSectionsRepo.deleteSection(section.id);
    createConversationMessageService(handle.conversationsRepo).recordManualAssetChange({
      content: `用户手动删除了板块「${section.name}」及其中 ${itemsCount} 个条目。`,
      target: "genre_section",
      id: section.id,
    });
    return c.json({ deleted: section.name, itemsRemoved: itemsCount });
  });

  return app;
}
