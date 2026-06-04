import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  use: { baseURL: "http://127.0.0.1:6789", locale: "zh-CN" },
  reporter: [["list"], ["html", { open: "never" }]],
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
