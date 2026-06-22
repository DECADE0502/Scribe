import { Hono } from "hono";
import type { BookRegistry } from "../book-registry.js";
import {
  isBuiltinProviderId,
  loadConfig,
  normalizeCustomProviders,
  normalizeStyleReferences,
  saveConfig,
  type AppConfig,
} from "../../config/load.js";
import { loadSecrets, saveSecret, maskKey, providerSecretName } from "../../config/secrets.js";
import { listModelsFor, type ModelManager } from "../../ai/model-manager.js";

export interface UsageRoutesDeps {
  registry: BookRegistry;
  configJsonPath?: string;
  secretsEnvPath?: string;
  modelManager?: ModelManager;
}

function providerKeyStatuses(config: AppConfig, secretsEnvPath?: string) {
  const secrets = secretsEnvPath ? loadSecrets(secretsEnvPath) : {};
  const providerIds = ["anyrouter", "deepseek", "mimo", ...config.customProviders.map((provider) => provider.id)];
  const out: Record<string, { hasApiKey: boolean; apiKeyMasked: string | null }> = {};
  for (const providerId of providerIds) {
    const key = secrets[providerSecretName(providerId)] ?? "";
    out[providerId] = {
      hasApiKey: !!key,
      apiKeyMasked: key ? maskKey(key) : null,
    };
  }
  return out;
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
    const providerKeys = providerKeyStatuses(config, deps.secretsEnvPath);
    const currentKey = providerKeys[config.provider] ?? { hasApiKey: false, apiKeyMasked: null };
    return c.json({
      ...config,
      providerKeys,
      apiKeyMasked: currentKey.apiKeyMasked,
      hasApiKey: currentKey.hasApiKey,
    });
  });

  app.put("/api/settings", async (c) => {
    if (!deps.configJsonPath) return c.json({ error: "服务未就绪" }, 503);
    const body = await c.req.json().catch(() => ({})) as Partial<AppConfig> & { apiKey?: string };
    const current = loadConfig(deps.configJsonPath);
    const nextCustomProviders = Array.isArray((body as Record<string, unknown>).customProviders)
      ? normalizeCustomProviders((body as Record<string, unknown>).customProviders)
      : current.customProviders;
    const requestedProvider = typeof body.provider === "string" ? body.provider : current.provider;
    const providerExists = isBuiltinProviderId(requestedProvider) ||
      nextCustomProviders.some((provider) => provider.id === requestedProvider);
    const next: AppConfig = {
      ...current,
      ...(typeof body.singleBudgetUsd === "number" && body.singleBudgetUsd > 0
        ? { singleBudgetUsd: body.singleBudgetUsd }
        : {}),
      ...(providerExists
        ? { provider: requestedProvider }
        : {}),
      ...(typeof body.writeModelId === "string" && body.writeModelId
        ? { writeModelId: body.writeModelId }
        : {}),
      ...(typeof body.auditModelId === "string" && body.auditModelId
        ? { auditModelId: body.auditModelId }
        : {}),
      ...(typeof body.masterPrompt === "string"
        ? { masterPrompt: body.masterPrompt }
        : {}),
      ...(Array.isArray((body as Record<string, unknown>).styleReferences)
        ? { styleReferences: normalizeStyleReferences((body as Record<string, unknown>).styleReferences) }
        : {}),
      customProviders: nextCustomProviders,
    };
    saveConfig(deps.configJsonPath, next);

    // API key:按当前供应商写到对应的 secret(内置与自定义 key 独立、不可混用),热生效
    let activeKey: string | null | undefined;
    if (typeof body.apiKey === "string" && body.apiKey.trim() && deps.secretsEnvPath) {
      const secretName = providerSecretName(next.provider);
      saveSecret(deps.secretsEnvPath, secretName, body.apiKey.trim());
      activeKey = body.apiKey.trim();
    } else if (deps.secretsEnvPath) {
      activeKey = loadSecrets(deps.secretsEnvPath)[providerSecretName(next.provider)] ?? null;
    }
    deps.modelManager?.configure({
      provider: next.provider,
      ...(activeKey !== undefined ? { apiKey: activeKey } : {}),
      writeModelId: next.writeModelId,
      auditModelId: next.auditModelId,
      customProviders: next.customProviders,
      masterPrompt: next.masterPrompt,
    });

    const providerKeys = providerKeyStatuses(next, deps.secretsEnvPath);
    const currentKey = providerKeys[next.provider] ?? { hasApiKey: false, apiKeyMasked: null };
    return c.json({
      ...next,
      providerKeys,
      apiKeyMasked: currentKey.apiKeyMasked,
      hasApiKey: currentKey.hasApiKey,
    });
  });

  // 实时拉模型列表(按已保存的当前配置)
  app.get("/api/models", async (c) => {
    if (!deps.modelManager) return c.json({ error: "服务未就绪" }, 503);
    try {
      const models = await deps.modelManager.listModels();
      return c.json({ models });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 503);
    }
  });

  // 预览某套草稿配置下的模型列表:不落盘、不改动正在运行的 ModelManager。
  // 用于「设置页选了供应商/填了 Key,想先看看有哪些模型」而无需先保存整张表单。
  app.post("/api/models", async (c) => {
    if (!deps.configJsonPath) return c.json({ error: "服务未就绪" }, 503);
    const body = await c.req.json().catch(() => ({})) as {
      provider?: string;
      apiKey?: string;
      customProviders?: unknown;
    };
    const config = loadConfig(deps.configJsonPath);
    const customProviders = Array.isArray(body.customProviders)
      ? normalizeCustomProviders(body.customProviders)
      : config.customProviders;
    const requestedProvider = typeof body.provider === "string" ? body.provider : config.provider;
    const provider = isBuiltinProviderId(requestedProvider) ||
      customProviders.some((item) => item.id === requestedProvider)
      ? requestedProvider
      : config.provider;
    // Key:优先用草稿里刚填的(尚未保存),否则回退到该供应商已存的 Key
    let apiKey: string | null = null;
    if (typeof body.apiKey === "string" && body.apiKey.trim()) {
      apiKey = body.apiKey.trim();
    } else if (deps.secretsEnvPath) {
      apiKey = loadSecrets(deps.secretsEnvPath)[providerSecretName(provider)] ?? null;
    }
    try {
      const models = await listModelsFor({ provider, apiKey, customProviders });
      return c.json({ models });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 503);
    }
  });

  return app;
}
