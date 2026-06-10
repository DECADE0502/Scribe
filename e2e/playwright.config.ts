import { defineConfig } from "@playwright/test";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// e2e 专用数据目录(测试按 bookId 隔离,不要求每轮清空)
const e2eDataDir = path.resolve(__dirname, ".scribe-e2e-data");

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  retries: 1,
  use: { baseURL: "http://127.0.0.1:6789", locale: "zh-CN" },
  reporter: [["list"], ["html", { open: "never" }]],
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "pnpm --filter @scribe/server exec tsx src/main.ts",
    url: "http://127.0.0.1:6789/api/health",
    timeout: 30_000,
    reuseExistingServer: false,
    env: {
      SCRIBE_HOME: e2eDataDir,
      PORT: "6789",
    },
  },
});
