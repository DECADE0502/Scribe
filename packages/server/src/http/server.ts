import { Hono } from "hono";
import type { LanguageModel } from "ai";
import { conversationRoutes } from "./routes/conversation.js";
import { chapterRoutes, type ChapterRoutesDeps } from "./routes/chapters.js";
import { bookRoutes, type BookRoutesDeps } from "./routes/books.js";
import { reviseRoutes } from "./routes/revise.js";
import { sidebarRoutes } from "./routes/sidebar.js";

export interface AppDeps {
  getModel?: () => LanguageModel | undefined;
  getChapterDeps?: ChapterRoutesDeps["getDeps"];
  bookRegistry?: BookRoutesDeps["registry"];
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
  }
  return app;
}
