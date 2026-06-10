import * as fs from "node:fs";
import { Hono } from "hono";
import type { BookRegistry } from "../book-registry.js";

export interface SidebarRoutesDeps {
  registry: BookRegistry;
}

/** 右栏资料区的读写路由:角色 / 大纲 / 伏笔 / 时间线 / rules.md */
export function sidebarRoutes(deps: SidebarRoutesDeps) {
  const app = new Hono();

  const withBook = (bookId: string) => {
    const book = deps.registry.booksRepo.get(bookId);
    if (!book) return null;
    return deps.registry.open(bookId);
  };

  app.get("/api/books/:bookId/characters", async (c) => {
    const handle = withBook(c.req.param("bookId"));
    if (!handle) return c.json({ error: "书不存在" }, 404);
    return c.json({ characters: handle.charactersRepo.list() });
  });

  // 用户手动改角色:写入 + 广播 system 消息给对话流(B-7 §6.4 广播机制)
  app.put("/api/books/:bookId/characters/:cid", async (c) => {
    const handle = withBook(c.req.param("bookId"));
    if (!handle) return c.json({ error: "书不存在" }, 404);
    const cid = c.req.param("cid");
    const existing = handle.charactersRepo.get(cid);
    if (!existing) return c.json({ error: "角色不存在" }, 404);
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
    if (body.role !== undefined) patch.role = body.role;
    if (body.baseData !== undefined) patch.baseData = body.baseData;
    if (body.currentState !== undefined) patch.currentState = body.currentState;
    const updated = handle.charactersRepo.update(cid, patch);
    handle.conversationsRepo.append({
      role: "system",
      content: `用户手动修改了角色「${updated.name}」的资料,请以最新资料为准。`,
      metadata: { kind: "manual_edit", target: "character", id: cid },
    });
    return c.json(updated);
  });

  app.get("/api/books/:bookId/outline", async (c) => {
    const handle = withBook(c.req.param("bookId"));
    if (!handle) return c.json({ error: "书不存在" }, 404);
    return c.json({ outline: handle.outlineRepo.listAll() });
  });

  app.get("/api/books/:bookId/foreshadowing", async (c) => {
    const handle = withBook(c.req.param("bookId"));
    if (!handle) return c.json({ error: "书不存在" }, 404);
    return c.json({ foreshadowing: handle.foreshadowingRepo.list() });
  });

  app.post("/api/books/:bookId/foreshadowing", async (c) => {
    const handle = withBook(c.req.param("bookId"));
    if (!handle) return c.json({ error: "书不存在" }, 404);
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const label = String(body.label ?? "").trim();
    if (!label) return c.json({ error: "label 不能为空" }, 400);
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
    handle.conversationsRepo.append({
      role: "system",
      content: `用户手动添加了伏笔「${label}」。`,
      metadata: { kind: "manual_edit", target: "foreshadowing", id: created.id },
    });
    return c.json(created, 201);
  });

  app.delete("/api/books/:bookId/foreshadowing/:fid", async (c) => {
    const handle = withBook(c.req.param("bookId"));
    if (!handle) return c.json({ error: "书不存在" }, 404);
    const fid = c.req.param("fid");
    const existing = handle.foreshadowingRepo.get(fid);
    if (!existing) return c.json({ error: "伏笔不存在" }, 404);
    handle.foreshadowingRepo.delete(fid);
    handle.conversationsRepo.append({
      role: "system",
      content: `用户手动删除了伏笔「${existing.label}」。`,
      metadata: { kind: "manual_edit", target: "foreshadowing", id: fid },
    });
    return c.json({ deleted: fid });
  });

  app.get("/api/books/:bookId/timeline", async (c) => {
    const handle = withBook(c.req.param("bookId"));
    if (!handle) return c.json({ error: "书不存在" }, 404);
    return c.json({ timeline: handle.timelineRepo.listAll() });
  });

  app.get("/api/books/:bookId/rules", async (c) => {
    const handle = withBook(c.req.param("bookId"));
    if (!handle) return c.json({ error: "书不存在" }, 404);
    const content = fs.existsSync(handle.rulesMdPath)
      ? fs.readFileSync(handle.rulesMdPath, "utf-8")
      : "";
    return c.json({ content });
  });

  app.put("/api/books/:bookId/rules", async (c) => {
    const handle = withBook(c.req.param("bookId"));
    if (!handle) return c.json({ error: "书不存在" }, 404);
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const content = String(body.content ?? "");
    fs.writeFileSync(handle.rulesMdPath, content, "utf-8");
    handle.conversationsRepo.append({
      role: "system",
      content: "用户手动更新了写作规则(rules.md),请以最新规则为准。",
      metadata: { kind: "manual_edit", target: "rules" },
    });
    return c.json({ bytes: Buffer.byteLength(content, "utf-8") });
  });

  // 题材专属板块(Task 8.7 的 UI 用,顺手一起暴露)
  app.get("/api/books/:bookId/genre-sections", async (c) => {
    const handle = withBook(c.req.param("bookId"));
    if (!handle) return c.json({ error: "书不存在" }, 404);
    const sections = handle.genreSectionsRepo.listSections().map(section => ({
      section,
      items: handle.genreSectionsRepo.listItems(section.id),
    }));
    return c.json({ sections });
  });

  return app;
}
