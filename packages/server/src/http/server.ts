import { Hono } from "hono";

export function createApp() {
  const app = new Hono();
  app.get("/api/health", (c) => c.json({ status: "ok", name: "scribe" }));
  return app;
}
