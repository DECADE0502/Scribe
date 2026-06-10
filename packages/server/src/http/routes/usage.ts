import { Hono } from "hono";
import type { BookRegistry } from "../book-registry.js";
import { loadConfig, saveConfig, type AppConfig } from "../../config/load.js";

export interface UsageRoutesDeps {
  registry: BookRegistry;
  configJsonPath?: string;
}

export function usageRoutes(deps: UsageRoutesDeps) {
  const app = new Hono();

  app.get("/api/books/:bookId/usage/summary", async (c) => {
    const bookId = c.req.param("bookId");
    const book = deps.registry.booksRepo.get(bookId);
    if (!book) return c.json({ error: "书不存在" }, 404);
    const handle = deps.registry.open(bookId);
    const repo = handle.tokenUsageRepo;
    return c.json({
      totalUsd: repo.totalCost(),
      byTaskType: repo.sumByTaskType(),
      byModel: repo.sumByModel(),
      byChapter: repo.sumAllChapters(),
    });
  });

  app.get("/api/books/:bookId/usage/recent", async (c) => {
    const bookId = c.req.param("bookId");
    const book = deps.registry.booksRepo.get(bookId);
    if (!book) return c.json({ error: "书不存在" }, 404);
    const limit = Math.min(200, Math.max(1, Number(c.req.query("limit") ?? 50)));
    const handle = deps.registry.open(bookId);
    return c.json({ records: handle.tokenUsageRepo.listRecent(limit) });
  });

  // 全局设置(预算上限等)
  app.get("/api/settings", async (c) => {
    if (!deps.configJsonPath) return c.json({ error: "服务未就绪" }, 503);
    return c.json(loadConfig(deps.configJsonPath));
  });

  app.put("/api/settings", async (c) => {
    if (!deps.configJsonPath) return c.json({ error: "服务未就绪" }, 503);
    const body = await c.req.json().catch(() => ({})) as Partial<AppConfig>;
    const current = loadConfig(deps.configJsonPath);
    const next: AppConfig = {
      ...current,
      ...(typeof body.singleBudgetUsd === "number" && body.singleBudgetUsd > 0
        ? { singleBudgetUsd: body.singleBudgetUsd }
        : {}),
    };
    saveConfig(deps.configJsonPath, next);
    return c.json(next);
  });

  return app;
}
