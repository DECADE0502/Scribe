import { Hono } from "hono";
import type { LanguageModel } from "ai";
import type { ModelInfo } from "@scribe/shared";
import { streamSseResponse } from "../sse.js";
import type { BookRegistry } from "../book-registry.js";
import { runAutoMode } from "../../ai/orchestrator/auto-mode.js";

export interface AutoRoutesDeps {
  registry: BookRegistry;
  getModel?: () => LanguageModel | undefined;
  getAuditModel?: () => LanguageModel | undefined;
  budgetLimitUsd?: number;
  writeModelInfo?: ModelInfo;
  auditModelInfo?: ModelInfo;
}

export function autoRoutes(deps: AutoRoutesDeps) {
  const app = new Hono();
  // per-book 活跃自动会话的 abort 控制
  const running = new Map<string, AbortController>();

  app.post("/api/books/:bookId/auto", async (c) => {
    const bookId = c.req.param("bookId");
    const book = deps.registry.booksRepo.get(bookId);
    if (!book) return c.json({ error: "书不存在" }, 404);
    if (running.has(bookId)) return c.json({ error: "该书已有自动写作进行中" }, 409);

    const body = await c.req.json().catch(() => ({})) as { n?: unknown };
    const n = Number(body.n);
    if (!Number.isInteger(n) || n < 1 || n > 50) {
      return c.json({ error: "章节数必须是 1-50 的整数" }, 400);
    }

    const model = deps.getModel?.();
    const auditModel = deps.getAuditModel?.() ?? model;
    if (!model || !auditModel) {
      return c.json({ error: "未配置模型,请先在设置中配置 API Key" }, 503);
    }

    const handle = deps.registry.open(bookId);
    const controller = new AbortController();
    running.set(bookId, controller);
    // 客户端断连也触发取消
    c.req.raw.signal.addEventListener("abort", () => controller.abort());

    const writeModelInfo = deps.writeModelInfo ?? { id: "unknown" };
    const auditModelInfo = deps.auditModelInfo ?? writeModelInfo;

    async function* withCleanup() {
      try {
        yield* runAutoMode(
          {
            model: model!,
            auditModel: auditModel!,
            auditModelId: auditModelInfo.id,
            chaptersRepo: handle.chaptersRepo,
            chapterFiles: handle.chapterFiles,
            maxChapterNo: () => handle.chaptersRepo.maxChapterNo(),
            getVerdict: (no) => handle.chaptersRepo.getAudit(no)?.verdict,
            budgetLimitUsd: deps.budgetLimitUsd ?? 5,
            writeModelInfo,
            auditModelInfo,
            abortSignal: controller.signal,
          },
          { n },
        );
      } finally {
        running.delete(bookId);
      }
    }
    return streamSseResponse(withCleanup());
  });

  app.post("/api/books/:bookId/auto/cancel", async (c) => {
    const bookId = c.req.param("bookId");
    const controller = running.get(bookId);
    if (!controller) return c.json({ cancelled: false, reason: "没有进行中的自动写作" });
    controller.abort();
    return c.json({ cancelled: true });
  });

  return app;
}
