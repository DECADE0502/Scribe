import { Hono } from "hono";
import type { LanguageModel } from "ai";
import type { ModelInfo } from "@scribe/shared";
import { log } from "../logger.js";
import { conversationRoutes } from "./routes/conversation.js";
import { chapterRoutes, type ChapterRoutesDeps } from "./routes/chapters.js";
import { bookRoutes, type BookRoutesDeps } from "./routes/books.js";
import { sidebarRoutes } from "./routes/sidebar.js";
import { versionRoutes } from "./routes/versions.js";
import { usageRoutes } from "./routes/usage.js";
import { snapshotRoutes } from "./routes/snapshots.js";
import { exportRoutes } from "./routes/export.js";
import { worldbookRoutes } from "./routes/worldbook.js";
import { importRoutes } from "./routes/imports.js";
import { presetRoutes } from "./routes/presets.js";
import { agentRoutes } from "./routes/agent.js";
import type { AppPaths } from "../config/paths.js";
import type { ModelManager } from "../ai/model-manager.js";
import { loadConfig, type StyleReference } from "../config/load.js";

export interface AppDeps {
  getModel?: () => LanguageModel | undefined;
  getAuditModel?: () => LanguageModel | undefined;
  getChapterDeps?: ChapterRoutesDeps["getDeps"];
  bookRegistry?: BookRoutesDeps["registry"];
  budgetLimitUsd?: number;
  writeModelInfo?: ModelInfo;
  auditModelInfo?: ModelInfo;
  configJsonPath?: string;
  secretsEnvPath?: string;
  appPaths?: AppPaths;
  /** 注入后 getModel 等自动回落到 manager(显式 deps 优先,便于测试) */
  modelManager?: ModelManager;
  /** 章节提交回调(自动快照计数,spec §3.4) */
  onChapterCommitted?: (bookId: string) => void;
  /** 全局最深处提示词(可被每本书覆盖) */
  getMasterPrompt?: () => string;
  /** 全局文风参考列表,每本书可选择一组注入写作 Agent */
  getStyleReferences?: () => StyleReference[];
  /**
   * 本地会话令牌。设置后:对 /api、/sse 的非 GET 请求强制校验 Origin 为 localhost
   * 且带正确的 X-Scribe-Session 头,挡住恶意网页的 CSRF / DNS-rebinding。
   * 测试不传则不启用。
   */
  sessionToken?: string;
}

export function createApp(deps: AppDeps = {}) {
  const mm = deps.modelManager;
  const getModel = deps.getModel ?? (mm ? () => mm.getModel() : undefined);
  const getAuditModel = deps.getAuditModel ?? (mm ? () => mm.getAuditModel() : undefined);
  const writeModelInfo = deps.writeModelInfo ?? mm?.getWriteModelInfo();
  const auditModelInfo = deps.auditModelInfo ?? mm?.getAuditModelInfo();
  const getMasterPrompt = deps.getMasterPrompt ?? (mm ? () => mm.getMasterPrompt() : () => "");
  const getStyleReferences = deps.getStyleReferences ?? (
    deps.configJsonPath ? () => loadConfig(deps.configJsonPath!).styleReferences : () => []
  );

  // 自动构建 getChapterDeps:从 modelManager + bookRegistry 获取每本书的写作依赖
  const getChapterDeps = deps.getChapterDeps ?? ((bookId: string) => {
    if (!mm || !deps.bookRegistry) return undefined;
    const model = mm.getModel();
    if (!model) return undefined;
    const handle = deps.bookRegistry.open(bookId);
    return {
      model,
      chaptersRepo: handle.chaptersRepo,
      chapterFiles: handle.chapterFiles,
    };
  });

  const app = new Hono();
  app.get("/api/health", (c) => c.json({ status: "ok", name: "scribe" }));
  // 全局请求日志
  app.use("*", async (c, next) => {
    const start = Date.now();
    await next();
    const ms = Date.now() - start;
    if (!c.req.path.startsWith("/sse")) {
      log.info("http", `${c.req.method} ${c.req.path} → ${c.res.status} (${ms}ms)`);
    }
  });

  // 本地安全:对状态改写请求校验 Origin(localhost)+ 会话令牌,防恶意网页 CSRF / DNS-rebinding。
  // 只在注入了 sessionToken 时启用(测试环境不传,行为不变)。
  if (deps.sessionToken) {
    const token = deps.sessionToken;
    app.use("*", async (c, next) => {
      const method = c.req.method;
      const path = c.req.path;
      const mutating = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
      const guarded = path.startsWith("/api") || path.startsWith("/sse");
      if (!mutating || !guarded) return next();
      const origin = c.req.header("origin");
      if (origin) {
        let host = "";
        try { host = new URL(origin).hostname; } catch { /* malformed */ }
        if (host !== "127.0.0.1" && host !== "localhost") {
          return c.json({ error: "forbidden_origin" }, 403);
        }
      }
      if (c.req.header("x-scribe-session") !== token) {
        return c.json({ error: "forbidden" }, 403);
      }
      return next();
    });
  }

  app.route("/", conversationRoutes({ registry: deps.bookRegistry }));
  app.route("/", chapterRoutes({ registry: deps.bookRegistry, onChapterCommitted: deps.onChapterCommitted, getMasterPrompt, getStyleReferences, getAuditModel, writeModelInfo, auditModelInfo, getDeps: getChapterDeps }));
  if (deps.bookRegistry) {
    app.route("/", bookRoutes({ registry: deps.bookRegistry, getModel, writeModelInfo, getMasterPrompt, getStyleReferences }));
    app.route("/", sidebarRoutes({ registry: deps.bookRegistry }));
    app.route("/", worldbookRoutes({ registry: deps.bookRegistry, getModel, writeModelInfo }));
    app.route("/", importRoutes({ registry: deps.bookRegistry }));
    app.route("/", presetRoutes({ registry: deps.bookRegistry }));
    app.route("/", agentRoutes({
      registry: deps.bookRegistry,
      getModel,
      getAuditModel,
      writeModelInfo,
      auditModelInfo,
      onChapterCommitted: deps.onChapterCommitted,
    }));
    app.route("/", versionRoutes({ registry: deps.bookRegistry }));
    app.route("/", usageRoutes({
      registry: deps.bookRegistry,
      configJsonPath: deps.configJsonPath,
      secretsEnvPath: deps.secretsEnvPath,
      modelManager: deps.modelManager,
    }));
    if (deps.appPaths) {
      app.route("/", snapshotRoutes({ registry: deps.bookRegistry, paths: deps.appPaths }));
      app.route("/", exportRoutes({ registry: deps.bookRegistry, paths: deps.appPaths }));
    }
  }
  return app;
}

