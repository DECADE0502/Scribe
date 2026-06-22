/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// 本地会话令牌:由后端首启写到 .scribe-data/session.json。
// 开发代理在转发 /api、/sse 时注入 X-Scribe-Session 头,前端业务代码无需改动。
const dir = path.dirname(fileURLToPath(import.meta.url));
function sessionTokenPath(): string {
  if (process.env.SCRIBE_HOME) return path.join(process.env.SCRIBE_HOME, "session.json");
  return path.resolve(dir, "../../.scribe-data/session.json");
}
function readSessionToken(): string | null {
  try {
    const raw = JSON.parse(fs.readFileSync(sessionTokenPath(), "utf-8")) as { token?: unknown };
    return typeof raw.token === "string" ? raw.token : null;
  } catch {
    return null;
  }
}
// 用 any 适配 vite/http-proxy 的 configure 回调签名(构建期脚本,放宽类型)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function injectSession(proxy: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  proxy.on("proxyReq", (proxyReq: any) => {
    const token = readSessionToken();
    if (token) proxyReq.setHeader("x-scribe-session", token);
  });
}

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:6789", configure: injectSession },
      "/sse": { target: "http://127.0.0.1:6789", configure: injectSession },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
  },
});
