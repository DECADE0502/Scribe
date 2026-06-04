import { test, expect } from "@playwright/test";

test("dummy:确保 Playwright 装好且能跑", async () => {
  // 不依赖真实 server,纯环境验证
  expect(1 + 1).toBe(2);
});
