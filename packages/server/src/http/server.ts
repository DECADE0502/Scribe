import { Hono } from "hono";
import { conversationRoutes } from "./routes/conversation.js";

export function createApp() {
  const app = new Hono();
  app.get("/api/health", (c) => c.json({ status: "ok", name: "scribe" }));
  app.route("/", conversationRoutes());
  return app;
}
