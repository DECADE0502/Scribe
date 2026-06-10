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

export interface AppDeps {
  getModel?: () => LanguageModel | undefined;
  getAuditModel?: () => LanguageModel | undefined;
  getChapterDeps?: ChapterRoutesDeps["getDeps"];
  bookRegistry?: BookRoutesDeps["registry"];
  budgetLimitUsd?: number;
  writeModelInfo?: ModelInfo;
  auditModelInfo?: ModelInfo;
  configJsonPath?: string;
}

export function createApp(deps: AppDeps = {}) {
  const app = new Hono();
  app.get("/api/health", (c) => c.json({ status: "ok", name: "scribe" }));
  app.route("/", conversationRoutes({ getModel: deps.getModel }));
  app.route("/", chapterRoutes({ getDeps: deps.getChapterDeps, registry: deps.bookRegistry }));
  if (deps.bookRegistry) {
    app.route("/", bookRoutes({ registry: deps.bookRegistry, getModel: deps.getModel }));
    app.route("/", reviseRoutes({ registry: deps.bookRegistry, getModel: deps.getModel }));
    app.route("/", sidebarRoutes({ registry: deps.bookRegistry }));
    app.route("/", autoRoutes({
      registry: deps.bookRegistry,
      getModel: deps.getModel,
      getAuditModel: deps.getAuditModel,
      budgetLimitUsd: deps.budgetLimitUsd,
      writeModelInfo: deps.writeModelInfo,
      auditModelInfo: deps.auditModelInfo,
    }));
    app.route("/", versionRoutes({ registry: deps.bookRegistry }));
    app.route("/", usageRoutes({ registry: deps.bookRegistry, configJsonPath: deps.configJsonPath }));
  }
  return app;
}
