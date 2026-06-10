import { test, expect } from "@playwright/test";

/**
 * 核心旅程(API 级,against 真实 server 进程):
 * 建书 → 手动写章 → 读回 → 导出 → 下载 → 快照 → 改章 → 恢复 → 验证复原
 * (AI 写作路径需要 API key,在单测/集成测中用 stub 覆盖,此处走无模型路径)
 */
test("核心旅程:建书到快照恢复", async ({ request }) => {
  // 健康检查
  const health = await request.get("/api/health");
  expect(health.ok()).toBeTruthy();
  expect((await health.json()).name).toBe("scribe");

  // 建书
  const created = await request.post("/api/books", { data: { title: "E2E 测试书", genre: "仙侠" } });
  expect(created.status()).toBe(201);
  const { id } = await created.json() as { id: string };

  // 书架可见
  const list = await request.get("/api/books");
  const books = (await list.json() as { books: Array<{ id: string }> }).books;
  expect(books.some(b => b.id === id)).toBeTruthy();

  // onboard 状态:全空
  const status = await request.get(`/api/books/${id}/onboard-status`);
  expect((await status.json() as { ok: boolean }).ok).toBe(false);

  // 手动写第 1 章
  const put = await request.put(`/api/books/${id}/chapters/1`, {
    data: { content: "# 初见\n\n云雾之间,一人一剑。", title: "第一章 初见" },
  });
  expect(put.ok()).toBeTruthy();

  // 读回
  const chapter = await request.get(`/api/books/${id}/chapters/1`);
  const ch = await chapter.json() as { title: string; content: string };
  expect(ch.title).toBe("第一章 初见");
  expect(ch.content).toContain("一人一剑");

  // 导出全书 md + 下载
  const exp = await request.post(`/api/books/${id}/export`, { data: { format: "md" } });
  const { filename } = await exp.json() as { filename: string };
  const dl = await request.get(`/api/books/${id}/exports/${encodeURIComponent(filename)}`);
  expect(dl.ok()).toBeTruthy();
  expect(await dl.text()).toContain("一人一剑");

  // 创建快照
  const snap = await request.post(`/api/books/${id}/snapshots/create`);
  expect(snap.status()).toBe(201);
  const snapList = await request.get(`/api/books/${id}/snapshots`);
  const { snapshots } = await snapList.json() as { snapshots: Array<{ filename: string }> };
  expect(snapshots.length).toBeGreaterThanOrEqual(1);

  // 改坏章节(模拟误操作)
  await request.put(`/api/books/${id}/chapters/1`, {
    data: { content: "全部内容被误删改坏了" },
  });

  // 恢复快照(需要 RESTORE 确认词)
  const noConfirm = await request.post(`/api/books/${id}/snapshots/restore`, {
    data: { filename: snapshots[0]!.filename },
  });
  expect(noConfirm.status()).toBe(400);

  const restore = await request.post(`/api/books/${id}/snapshots/restore`, {
    data: { filename: snapshots[0]!.filename, confirmText: "RESTORE" },
  });
  expect(restore.ok()).toBeTruthy();

  // 验证复原
  const after = await request.get(`/api/books/${id}/chapters/1`);
  const restored = await after.json() as { content: string };
  expect(restored.content).toContain("一人一剑");
  expect(restored.content).not.toContain("误删改坏");

  // 用量与设置端点可用
  const usage = await request.get(`/api/books/${id}/usage/summary`);
  expect(usage.ok()).toBeTruthy();
  const settings = await request.get("/api/settings");
  expect((await settings.json() as { singleBudgetUsd: number }).singleBudgetUsd).toBeGreaterThan(0);
});
