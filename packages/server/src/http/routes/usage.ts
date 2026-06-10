import { Hono } from "hono";
import type { BookRegistry } from "../book-registry.js";
import { loadConfig, saveConfig, type AppConfig } from "../../config/load.js";
import { saveSecret, maskKey } from "../../config/secrets.js";
import type { ModelManager } from "../../ai/model-manager.js";

export interface UsageRoutesDeps {
  registry: BookRegistry;
  configJsonPath?: string;
  secretsEnvPath?: string;
  modelManager?: ModelManager;
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

  // 全局设置(API key / 模型 / 预算上限)
  app.get("/api/settings", async (c) => {
    if (!deps.configJsonPath) return c.json({ error: "服务未就绪" }, 503);
    const config = loadConfig(deps.configJsonPath);
    const state = deps.modelManager?.getState();
    return c.json({
      ...config,
      apiKeyMasked: state?.apiKey ? maskKey(state.apiKey) : null,
      hasApiKey: !!state?.apiKey,
    });
  });

  app.put("/api/settings", async (c) => {
    if (!deps.configJsonPath) return c.json({ error: "服务未就绪" }, 503);
    const body = await c.req.json().catch(() => ({})) as Partial<AppConfig> & { apiKey?: string };
    const current = loadConfig(deps.configJsonPath);
    const next: AppConfig = {
      ...current,
      ...(typeof body.singleBudgetUsd === "number" && body.singleBudgetUsd > 0
        ? { singleBudgetUsd: body.singleBudgetUsd }
        : {}),
      ...(typeof body.writeModelId === "string" && body.writeModelId
        ? { writeModelId: body.writeModelId }
        : {}),
      ...(typeof body.auditModelId === "string" && body.auditModelId
        ? { auditModelId: body.auditModelId }
        : {}),
    };
    saveConfig(deps.configJsonPath, next);

    // API key:只写 secrets.env,不进 config.json,热生效
    if (typeof body.apiKey === "string" && body.apiKey.trim() && deps.secretsEnvPath) {
      saveSecret(deps.secretsEnvPath, "DEEPSEEK_API_KEY", body.apiKey.trim());
      deps.modelManager?.configure({ apiKey: body.apiKey.trim() });
    }
    deps.modelManager?.configure({
      writeModelId: next.writeModelId,
      auditModelId: next.auditModelId,
    });

    const state = deps.modelManager?.getState();
    return c.json({
      ...next,
      apiKeyMasked: state?.apiKey ? maskKey(state.apiKey) : null,
      hasApiKey: !!state?.apiKey,
    });
  });

  // 实时拉模型列表
  app.get("/api/models", async (c) => {
    if (!deps.modelManager) return c.json({ error: "服务未就绪" }, 503);
    try {
      const models = await deps.modelManager.listModels();
      return c.json({ models });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 503);
    }
  });

  return app;
}
