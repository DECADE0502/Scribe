import { Hono } from "hono";
import type { LanguageModel } from "ai";
import type { ModelInfo } from "@scribe/shared";
import { streamSseResponse } from "../sse.js";
import type { BookRegistry } from "../book-registry.js";
import { runAutoMode } from "../../ai/orchestrator/auto-mode.js";
import {
  buildBookPromptContext,
  buildChapterWriteMessages,
} from "../../ai/context-builder/book-context.js";
import {
  recordChapterState,
  buildArchiveSummary,
} from "../../ai/orchestrator/record-state.js";

export interface AutoRoutesDeps {
  registry: BookRegistry;
  getModel?: () => LanguageModel | undefined;
  getAuditModel?: () => LanguageModel | undefined;
  budgetLimitUsd?: number;
  writeModelInfo?: ModelInfo;
  auditModelInfo?: ModelInfo;
  onChapterCommitted?: (bookId: string) => void;
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
    // B-5-001 修复:把书的设定(premise/角色/大纲/规则)注入写作与审查 prompt
    const promptCtx = buildBookPromptContext(handle);

    // 章末状态记录 pass(spec §6.3)
    const makeRecordState = (chapterNo: number) => {
      const chapter = handle.chapterFiles.read(chapterNo);
      if (!chapter) return emptyIterable();
      const archiveSummary = buildArchiveSummary({
        genreSections: handle.genreSectionsRepo.listSections().map(section => ({
          section,
          items: handle.genreSectionsRepo.listItems(section.id),
        })),
        characters: handle.charactersRepo.list(),
        activeForeshadowing: handle.foreshadowingRepo.list("active"),
      });
      return recordChapterState(
        {
          model: auditModel!, // 记录用便宜的审查模型即可
          stateDeps: {
            charactersRepo: handle.charactersRepo,
            foreshadowingRepo: handle.foreshadowingRepo,
            timelineRepo: handle.timelineRepo,
            chapterNo,
          },
          genreDeps: {
            repo: handle.genreSectionsRepo,
            charactersRepo: handle.charactersRepo,
          },
          abortSignal: controller.signal,
        },
        { chapterNo, chapterContent: chapter.content, archiveSummary },
      );
    };

    async function* withCleanup() {
      let currentChapter: number | undefined;
      let committedCount = 0;
      try {
        for await (const ev of runAutoMode(
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
            recordState: makeRecordState,
            // spec §6.1:逐章组装召回+最近摘要+题材板块+伏笔的完整防漂移上下文
            buildWriteMessages: (chapterNo) =>
              buildChapterWriteMessages(handle, chapterNo, "").messages,
          },
          { n, writeCtx: promptCtx.writeCtx, auditCtx: promptCtx.auditCtx },
        )) {
          if (ev.type === "auto_status" && ev.currentChapter != null) {
            currentChapter = ev.currentChapter;
          }
          // 每完成一章触发自动快照计数(spec §3.4)
          if (ev.type === "auto_status" && ev.doneChapters.length > committedCount) {
            committedCount = ev.doneChapters.length;
            deps.onChapterCommitted?.(bookId);
          }
          // usage 事件落库(写作模型的用量;audit 用量由 generateText 路径暂不上报)
          if (ev.type === "usage") {
            const pricing = writeModelInfo.pricing;
            const cost = pricing
              ? (ev.promptTokens / 1e6) * pricing.input + (ev.completionTokens / 1e6) * pricing.output
              : 0;
            handle.tokenUsageRepo.record({
              taskType: "write",
              model: writeModelInfo.id,
              promptTokens: ev.promptTokens,
              completionTokens: ev.completionTokens,
              cachedTokens: ev.cachedTokens ?? 0,
              reasoningTokens: ev.reasoningTokens ?? 0,
              costUsd: cost,
              chapterNo: currentChapter ?? null,
            });
            deps.registry.booksRepo.addCost(bookId, cost);
          }
          yield ev;
        }
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

async function* emptyIterable(): AsyncIterable<never> {
  // 章节缺失时的空记录流
}
