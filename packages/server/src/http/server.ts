import { Hono } from "hono";
import type { LanguageModel } from "ai";
import { conversationRoutes } from "./routes/conversation.js";

export interface CreateAppDeps {
  getModel?: () => LanguageModel | undefined;
}

export function createApp(deps: CreateAppDeps = {}) {
  const app = new Hono();
  app.get("/api/health", (c) => c.json({ status: "ok", name: "scribe" }));
  app.route("/", conversationRoutes(deps));
  return app;
}
