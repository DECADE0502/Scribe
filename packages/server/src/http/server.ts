import { Hono } from "hono";
import type { LanguageModel } from "ai";
import { conversationRoutes } from "./routes/conversation.js";
import { chapterRoutes, type ChapterRoutesDeps } from "./routes/chapters.js";

export interface AppDeps {
  getModel?: () => LanguageModel | undefined;
  getChapterDeps?: ChapterRoutesDeps["getDeps"];
}

export function createApp(deps: AppDeps = {}) {
  const app = new Hono();
  app.get("/api/health", (c) => c.json({ status: "ok", name: "scribe" }));
  app.route("/", conversationRoutes({ getModel: deps.getModel }));
  app.route("/", chapterRoutes({ getDeps: deps.getChapterDeps }));
  return app;
}
