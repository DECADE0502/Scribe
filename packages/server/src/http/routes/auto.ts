import { Hono } from "hono";
import type { LanguageModel } from "ai";
import type { ModelInfo, SseEvent } from "@scribe/shared";
import { streamSseResponse } from "../sse.js";
import type { BookRegistry } from "../book-registry.js";
import { runAutoMode } from "../../ai/orchestrator/auto-mode.js";
import { computeUsageCost } from "../../ai/usage-tracker.js";
import { resolveDeepestPrompt } from "../../ai/prompts/deepest-prompt.js";
import {
  buildBookPromptContext,
  buildChapterWriteMessages,
  buildChapterAuditContext,
  enrichUserIntentWithOutline,
} from "../../ai/context-builder/book-context.js";
import { loadBookSnapshot } from "../../ai/context-builder/snapshot.js";
import { isOnboardComplete } from "../../ai/orchestrator/onboard-completeness.js";
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
  getMasterPrompt?: () => string;
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
    const snapshot = loadBookSnapshot(
      bookId,
      {
        charactersRepo: handle.charactersRepo,
        outlineRepo: handle.outlineRepo,
        foreshadowingRepo: handle.foreshadowingRepo,
        chaptersRepo: handle.chaptersRepo,
        genreSectionsRepo: handle.genreSectionsRepo,
        worldbookRepo: handle.worldbookRepo,
        promptPresetsRepo: handle.promptPresetsRepo,
        readerIssuesRepo: handle.readerIssuesRepo,
        bookMetaRepo: handle.bookMetaRepo,
      },
      { rulesMd: handle.rulesMdPath },
    );
    const completeness = isOnboardComplete(snapshot);
    const hasSubstantialWorldbook = snapshot.worldbookEntries.some((entry) => {
      const isSeed = entry.metadata?.seed === true;
      return entry.enabled && entry.constant && !isSeed && entry.content.trim().length >= 80;
    });
    if (!completeness.ok && !hasSubstantialWorldbook) {
      return c.json(
        {
          error: "建书信息不足，自动写作已阻止",
          errorClass: "onboarding_incomplete",
          missing: completeness.missing,
        },
        409,
      );
    }
    const controller = new AbortController();
    running.set(bookId, controller);
    // 客户端断连也触发取消
    c.req.raw.signal.addEventListener("abort", () => controller.abort());

    const writeModelInfo = deps.writeModelInfo ?? { id: "unknown" };
    const auditModelInfo = deps.auditModelInfo ?? writeModelInfo;
    // B-5-001 修复:把书的设定(premise/角色/大纲/规则)注入写作与审查 prompt
    const promptCtx = buildBookPromptContext(handle);
    // 最深处提示词:每本覆盖 || 全局
    const deepestPrompt = resolveDeepestPrompt({
      perBook: handle.bookMetaRepo.get("master_prompt"),
      global: deps.getMasterPrompt?.() ?? "",
    });

    // 章末状态记录 pass(spec §6.3)。记录用审查模型,这里就地把它的 usage 计入账,
    // 否则 auto-mode 只透传 tool 事件、丢弃 usage,导致 record-state 成本不入账。
    const makeRecordState = (
      chapterNo: number,
      qualityGateResult?: { passed: boolean; blockingIssues: string[] },
    ): AsyncIterable<SseEvent> => {
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
      const inner = recordChapterState(
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
          deepestPrompt,
        },
        {
          chapterNo,
          chapterContent: chapter.content,
          archiveSummary,
          qualityGateResult: qualityGateResult
            ? { passed: qualityGateResult.passed, blockingIssues: qualityGateResult.blockingIssues }
            : undefined,
        },
      );
      return (async function* () {
        for await (const ev of inner) {
          if (ev.type === "usage") {
            const cost = computeUsageCost(
              auditModelInfo, ev.promptTokens, ev.completionTokens, ev.cachedTokens ?? 0,
            );
            handle.tokenUsageRepo.record({
              taskType: "audit",
              model: auditModelInfo.id,
              promptTokens: ev.promptTokens,
              completionTokens: ev.completionTokens,
              cachedTokens: ev.cachedTokens ?? 0,
              reasoningTokens: ev.reasoningTokens ?? 0,
              costUsd: cost,
              chapterNo,
            });
            deps.registry.booksRepo.addCost(bookId, cost);
          }
          yield ev;
        }
      })();
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
            readerIssuesRepo: handle.readerIssuesRepo,
            maxChapterNo: () => handle.chaptersRepo.maxChapterNo(),
            getVerdict: (no) => handle.chaptersRepo.getAudit(no)?.verdict,
            budgetLimitUsd: deps.budgetLimitUsd ?? 5,
            writeModelInfo,
            auditModelInfo,
            abortSignal: controller.signal,
            recordState: makeRecordState,
            // spec §6.1:逐章组装召回+最近摘要+通用记录集合+伏笔的完整防漂移上下文
            buildWriteMessages: (chapterNo) =>
              buildChapterWriteMessages(handle, chapterNo, enrichUserIntentWithOutline(handle.outlineRepo, chapterNo, "")).messages,
            buildAuditCtx: (chapterNo) =>
              buildChapterAuditContext(handle, chapterNo, "").auditCtx,
            deepestPrompt,
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
          // usage 事件落库(写作模型用量;缓存命中按 cachedInput 价折扣)
          if (ev.type === "usage") {
            const cost = computeUsageCost(
              writeModelInfo, ev.promptTokens, ev.completionTokens, ev.cachedTokens ?? 0,
            );
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
