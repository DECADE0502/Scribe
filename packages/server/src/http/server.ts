import { Hono } from "hono";
import type { LanguageModel } from "ai";
import type { ModelInfo } from "@scribe/shared";
import { conversationRoutes } from "./routes/conversation.js";
import { chapterRoutes, type ChapterRoutesDeps } from "./routes/chapters.js";
import { bookRoutes, type BookRoutesDeps } from "./routes/books.js";
import { reviseRoutes } from "./routes/revise.js";
import { sidebarRoutes } from "./routes/sidebar.js";
import { autoRoutes } from "./routes/auto.js";
import { versionRoutes } from "./routes/versions.js";
import { usageRoutes } from "./routes/usage.js";
import { snapshotRoutes } from "./routes/snapshots.js";
import { exportRoutes } from "./routes/export.js";
import type { AppPaths } from "../config/paths.js";
import type { ModelManager } from "../ai/model-manager.js";

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
}

export function createApp(deps: AppDeps = {}) {
  const mm = deps.modelManager;
  const getModel = deps.getModel ?? (mm ? () => mm.getModel() : undefined);
  const getAuditModel = deps.getAuditModel ?? (mm ? () => mm.getAuditModel() : undefined);
  const writeModelInfo = deps.writeModelInfo ?? mm?.getWriteModelInfo();
  const auditModelInfo = deps.auditModelInfo ?? mm?.getAuditModelInfo();

  const app = new Hono();
  app.get("/api/health", (c) => c.json({ status: "ok", name: "scribe" }));
  app.route("/", conversationRoutes({ getModel }));
  app.route("/", chapterRoutes({ getDeps: deps.getChapterDeps, registry: deps.bookRegistry, onChapterCommitted: deps.onChapterCommitted }));
  if (deps.bookRegistry) {
    app.route("/", bookRoutes({ registry: deps.bookRegistry, getModel }));
    app.route("/", reviseRoutes({ registry: deps.bookRegistry, getModel }));
    app.route("/", sidebarRoutes({ registry: deps.bookRegistry }));
    app.route("/", autoRoutes({
      registry: deps.bookRegistry,
      getModel,
      getAuditModel,
      budgetLimitUsd: deps.budgetLimitUsd,
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
