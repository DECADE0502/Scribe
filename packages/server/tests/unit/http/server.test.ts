import { describe, it, expect } from "vitest";
import { createApp } from "../../../src/http/server.js";

describe("HTTP server smoke", () => {
  it("GET /api/health 返回 ok", async () => {
    const app = createApp();
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", name: "scribe" });
  });
});
