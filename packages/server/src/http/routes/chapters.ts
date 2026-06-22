import { Hono } from "hono";
import type { LanguageModel } from "ai";
import type { ModelInfo } from "@scribe/shared";
import { streamSseResponse } from "../sse.js";
import { withUsageRecording } from "../../ai/usage-tracker.js";
import type { WriteChapterDeps } from "../../ai/orchestrator/write-chapter.js";
import { writeChapterSimple } from "../../ai/orchestrator/write-chapter.js";
import { writeWithAudit } from "../../ai/orchestrator/write-with-audit.js";
import {
  buildChapterWriteMessages,
  buildChapterAuditContext,
  enrichUserIntentWithOutline,
  resolveChapterTitle,
} from "../../ai/context-builder/book-context.js";
import { resolveDeepestPrompt } from "../../ai/prompts/deepest-prompt.js";
import { recordChapterState, buildArchiveSummary } from "../../ai/orchestrator/record-state.js";
import { auditChapter } from "../../ai/orchestrator/audit-chapter.js";
import { persistAuditResult } from "../../ai/orchestrator/audit-persist.js";
import { repairChapter } from "../../ai/orchestrator/repair-chapter.js";
import { sanitizeChapterOutput } from "../../ai/orchestrator/output-sanitize.js";
import { createHardFactQualityGate } from "../../ai/quality-gates/hard-fact-gate.js";
import { deleteChaptersFrom, type DeleteResult } from "../../ai/orchestrator/delete-chapter.js";
import { holdBook, type BookRegistry } from "../book-registry.js";
import type { StyleReference } from "../../config/load.js";
import { log } from "../../logger.js";

export interface ChapterRoutesDeps {
  getDeps?: (bookId: string) => WriteChapterDeps | undefined;
  registry?: BookRegistry;
  onChapterCommitted?: (bookId: string) => void;
  getMasterPrompt?: () => string;
  getStyleReferences?: () => StyleReference[];
  /** 审查模型(用于 audit + recordState);如果不提供则回退到写作模型 */
  getAuditModel?: () => LanguageModel | undefined;
  /** 写作模型信息(全量计费用) */
  writeModelInfo?: ModelInfo;
  /** 审查模型信息 */
  auditModelInfo?: ModelInfo;
}

export function chapterRoutes(deps: ChapterRoutesDeps = {}) {
  const app = new Hono();

  app.post("/api/books/:bookId/chapters/:no/write", async (c) => {
    const bookId = c.req.param("bookId");
    const no = Number(c.req.param("no"));
    if (!Number.isInteger(no) || no < 1) {
      return c.json({ error: "章节号无效" }, 400);
    }
    const body = await c.req.json().catch(() => ({}));
    const rawIntent = String((body as { userIntent?: unknown })?.userIntent ?? "");
    const wcDeps = deps.getDeps?.(bookId);
    if (!wcDeps) {
      return c.json({ error: "未配置模型,请先在设置中配置 API Key" }, 503);
    }
    if (!deps.registry) {
      return c.json({ error: "服务未就绪" }, 503);
    }
    const handle = deps.registry.open(bookId);
    const styleReferences = deps.getStyleReferences?.() ?? [];
    const userIntent = enrichUserIntentWithOutline(handle.outlineRepo, no, rawIntent);
    const auditModel = deps.getAuditModel?.() ?? wcDeps.model;
    const auditModelId = deps.auditModelInfo?.id ?? "unknown";

    // spec §6.1:注入完整防漂移上下文(召回+最近摘要+通用记录集合+伏笔)
    const writeContext = buildChapterWriteMessages(handle, no, userIntent, undefined, styleReferences);
    const auditCtx = buildChapterAuditContext(handle, no, userIntent).auditCtx;
    const deepestPrompt = resolveDeepestPrompt({
      perBook: handle.bookMetaRepo.get("master_prompt"),
      perBookEnabled: handle.bookMetaRepo.get("master_prompt_enabled") !== "0",
      global: deps.getMasterPrompt?.() ?? "",
    });

    // 创建硬事实闸门(通用,不依赖题材词汇)
    const hardFactGate = createHardFactQualityGate({ handle });

    // 完整流程: write → audit → (repair) → hard fact gate → recordState
    const inner = writeWithAudit(
      {
        model: wcDeps.model,
        auditModel,
        auditModelId,
        chaptersRepo: handle.chaptersRepo,
        chapterFiles: handle.chapterFiles,
        readerIssuesRepo: handle.readerIssuesRepo,
      },
      {
        chapterNo: no,
        userIntent,
        chapterTitle: resolveChapterTitle(handle.outlineRepo, no),
        prebuiltMessages: writeContext.messages,
        auditCtx,
        enableRepair: true,
        broadcastHardFactGate: true,
        qualityGate: hardFactGate,
        abortSignal: c.req.raw.signal,
        deepestPrompt,
      },
    );

    async function* withCommitAndRecord() {
      let hardFactGateResult: { passed: boolean; blockingIssues: string[] } | undefined;
      let chapterFailed = false;
      for await (const ev of inner) {
        if (ev.type === "done") continue;
        if (ev.type === "error") {
          yield ev;
          chapterFailed = true;
          break;
        }
        // 捕获硬事实闸门结果
        if (ev.type === "tool_call_end" && ev.toolName === "hard_fact_gate") {
          const result = ev.result as { passed?: boolean; blockingIssues?: string[] };
          hardFactGateResult = {
            passed: result.passed ?? true,
            blockingIssues: result.blockingIssues ?? [],
          };
        }
        yield ev;
      }
      if (chapterFailed) return;

      // 章末状态记录(角色状态/出场/伏笔/时间线/通用记录条目)
      const chapter = handle.chapterFiles.read(no);
      if (chapter) {
        const archiveSummary = buildArchiveSummary({
          genreSections: handle.genreSectionsRepo.listSections().map((section) => ({
            section,
            items: handle.genreSectionsRepo.listItems(section.id),
          })),
          characters: handle.charactersRepo.list(),
          activeForeshadowing: handle.foreshadowingRepo.list("active"),
        });
        yield { type: "tool_call_start" as const, toolName: "record_chapter_state", args: { chapterNo: no } };
        let recordOk = true;
        for await (const ev of recordChapterState(
          {
            model: auditModel,
            stateDeps: {
              charactersRepo: handle.charactersRepo,
              foreshadowingRepo: handle.foreshadowingRepo,
              timelineRepo: handle.timelineRepo,
              chapterNo: no,
            },
            genreDeps: { repo: handle.genreSectionsRepo, charactersRepo: handle.charactersRepo },
            abortSignal: c.req.raw.signal,
            deepestPrompt,
            readerIssuesRepo: handle.readerIssuesRepo,
          },
          {
            chapterNo: no,
            chapterContent: chapter.content,
            archiveSummary,
            qualityGateResult: hardFactGateResult,
          },
        )) {
          if (ev.type === "error") {
            recordOk = false;
            yield ev;
            break;
          }
          if (ev.type === "tool_call_start" || ev.type === "tool_call_end") yield ev;
        }
        if (recordOk) {
          yield { type: "tool_call_end" as const, toolName: "record_chapter_state", result: { success: true } };
        }
      }

      deps.onChapterCommitted?.(bookId);
      yield { type: "done" as const };
    }
    return streamSseResponse(holdBook(deps.registry, bookId, withUsageRecording(withCommitAndRecord(), {
      tokenUsageRepo: handle.tokenUsageRepo,
      booksRepo: deps.registry.booksRepo,
      bookId,
      modelInfo: deps.writeModelInfo,
      taskType: "write",
      chapterNo: no,
    })));
  });

  // ---- 分步写作: /write-draft (只写正文) + /finalize (审计+闸门+记录) ----

  // 只写正文,不审计不记录状态。作者确认后再调 /finalize。
  app.post("/api/books/:bookId/chapters/:no/write-draft", async (c) => {
    const bookId = c.req.param("bookId");
    const no = Number(c.req.param("no"));
    if (!Number.isInteger(no) || no < 1) return c.json({ error: "章节号无效" }, 400);
    const body = await c.req.json().catch(() => ({}));
    const rawIntent = String((body as { userIntent?: unknown })?.userIntent ?? "");
    const wcDeps = deps.getDeps?.(bookId);
    if (!wcDeps) return c.json({ error: "未配置模型,请先在设置中配置 API Key" }, 503);
    if (!deps.registry) return c.json({ error: "服务未就绪" }, 503);
    const handle = deps.registry.open(bookId);
    const styleReferences = deps.getStyleReferences?.() ?? [];
    const userIntent = enrichUserIntentWithOutline(handle.outlineRepo, no, rawIntent);
    const writeContext = buildChapterWriteMessages(handle, no, userIntent, undefined, styleReferences);
    const deepestPrompt = resolveDeepestPrompt({
      perBook: handle.bookMetaRepo.get("master_prompt"),
      perBookEnabled: handle.bookMetaRepo.get("master_prompt_enabled") !== "0",
      global: deps.getMasterPrompt?.() ?? "",
    });
    const inner = writeChapterSimple(wcDeps, {
      chapterNo: no,
      userIntent,
      chapterTitle: resolveChapterTitle(handle.outlineRepo, no),
      prebuiltMessages: writeContext.messages,
      deepestPrompt,
      abortSignal: c.req.raw.signal,
    });
    async function* withCommit() {
      for await (const ev of inner) {
        if (ev.type === "done") deps.onChapterCommitted?.(bookId);
        yield ev;
      }
    }
    return streamSseResponse(holdBook(deps.registry, bookId, withUsageRecording(withCommit(), {
      tokenUsageRepo: handle.tokenUsageRepo,
      booksRepo: deps.registry.booksRepo,
      bookId,
      modelInfo: deps.writeModelInfo,
      taskType: "write",
      chapterNo: no,
    })));
  });

  // 在已落盘正文上跑 audit + hardFactGate + recordState。
  // 作者可以在此前手动编辑正文,/finalize 始终读最新版本。
  app.post("/api/books/:bookId/chapters/:no/finalize", async (c) => {
    const bookId = c.req.param("bookId");
    const no = Number(c.req.param("no"));
    if (!Number.isInteger(no) || no < 1) return c.json({ error: "章节号无效" }, 400);
    if (!deps.registry) return c.json({ error: "服务未就绪" }, 503);
    const handle = deps.registry.open(bookId);
    const auditModel = deps.getAuditModel?.() ?? deps.getDeps?.(bookId)?.model;
    const auditModelId = deps.auditModelInfo?.id ?? "unknown";
    if (!auditModel) return c.json({ error: "未配置模型" }, 503);
    const auditModelResolved = auditModel;

    const chapter = handle.chapterFiles.read(no);
    if (!chapter) return c.json({ error: "章节不存在,请先 write-draft" }, 404);

    const userIntent = String((await c.req.json().catch(() => ({})))?.userIntent ?? "");
    const deepestPrompt = resolveDeepestPrompt({
      perBook: handle.bookMetaRepo.get("master_prompt"),
      perBookEnabled: handle.bookMetaRepo.get("master_prompt_enabled") !== "0",
      global: deps.getMasterPrompt?.() ?? "",
    });
    const auditCtx = buildChapterAuditContext(handle, no, userIntent).auditCtx;
    const hardFactGate = createHardFactQualityGate({ handle });
    const finalContent = sanitizeChapterOutput(chapter.content);

    async function* finalizeFlow() {
      // 1. 审计
      let auditResult;
      try {
        auditResult = await auditChapter(
          { model: auditModelResolved, abortSignal: c.req.raw.signal, deepestPrompt },
          { chapterNo: no, chapterContent: finalContent, ...auditCtx },
        );
      } catch (e) {
        yield { type: "error" as const, errorClass: "audit_failed", message: `审查失败:${(e as Error).message}` };
        return;
      }
      persistAuditResult(handle.chaptersRepo, no, auditResult, auditModelId, handle.readerIssuesRepo);
      yield {
        type: "tool_call_end" as const,
        toolName: "chapter_audit",
        result: {
          verdict: auditResult.output.verdict,
          issuesCount: auditResult.output.issues.filter((i) => i.severity !== "ok").length,
          summary: auditResult.output.summary,
        },
      };

      // 2. 硬事实闸门 + 可选修复
      let qualityIssues = await hardFactGate({
        chapterNo: no,
        chapterContent: finalContent,
        stage: "draft" as const,
        auditVerdict: auditResult.output.verdict,
        auditHardFacts: auditResult.hardFacts,
      });

      const shouldRepair = auditResult.output.verdict === "critical" || qualityIssues.length > 0;
      if (shouldRepair) {
        yield { type: "tool_call_start" as const, toolName: "chapter_repair", args: { chapterNo: no } };
        let repairOk = false;
        const repairDeps = {
          model: deps.getDeps!(bookId)!.model,
          chaptersRepo: handle.chaptersRepo,
          chapterFiles: handle.chapterFiles,
          abortSignal: c.req.raw.signal,
          deepestPrompt,
        };
        const repairIssues = auditResult.output.verdict === "critical"
          ? [...auditResult.output.issues, ...qualityIssues]
          : qualityIssues;
        for await (const ev of repairChapter(repairDeps, {
          chapterNo: no,
          ctx: { chapterContent: finalContent, issues: repairIssues, ...auditCtx },
        })) {
          if (ev.type === "done") repairOk = true;
          if (ev.type === "error") { yield ev; break; }
        }
        const finalRepairContent = sanitizeChapterOutput(handle.chapterFiles.read(no)?.content ?? "");
        if (repairOk && finalRepairContent.trim()) {
          // 再审计
          try {
            const reAudit = await auditChapter(
              { model: auditModelResolved, abortSignal: c.req.raw.signal, deepestPrompt },
              { chapterNo: no, chapterContent: finalRepairContent, ...auditCtx },
            );
            persistAuditResult(handle.chaptersRepo, no, reAudit, auditModelId, handle.readerIssuesRepo);
            qualityIssues = await hardFactGate({
              chapterNo: no,
              chapterContent: finalRepairContent,
              stage: "repair" as const,
              auditVerdict: reAudit.output.verdict,
              auditHardFacts: reAudit.hardFacts,
            });
            yield { type: "tool_call_end" as const, toolName: "chapter_repair", result: { success: true } };
            yield {
              type: "tool_call_end" as const,
              toolName: "chapter_repair_audit",
              result: {
                verdict: reAudit.output.verdict,
                stillCritical: reAudit.output.verdict === "critical" || qualityIssues.length > 0,
              },
            };
          } catch (e) {
            yield { type: "error" as const, errorClass: "repair_audit_failed", message: (e as Error).message };
          }
        } else {
          yield { type: "tool_call_end" as const, toolName: "chapter_repair", result: { success: false, reason: "empty" } };
        }
      }

      // 3. 广播硬事实闸门结果
      const blockingIssues = qualityIssues.filter((i) => i.severity === "critical").map((i) => i.note);
      yield {
        type: "tool_call_end" as const,
        toolName: "hard_fact_gate",
        result: { passed: blockingIssues.length === 0, blockingIssues },
      };

      // 4. 状态记录
      const archiveSummary = buildArchiveSummary({
        genreSections: handle.genreSectionsRepo.listSections().map((section) => ({
          section,
          items: handle.genreSectionsRepo.listItems(section.id),
        })),
        characters: handle.charactersRepo.list(),
        activeForeshadowing: handle.foreshadowingRepo.list("active"),
      });
      yield { type: "tool_call_start" as const, toolName: "record_chapter_state", args: { chapterNo: no } };
      let recordOk = true;
      for await (const ev of recordChapterState(
        {
          model: auditModelResolved,
          stateDeps: {
            charactersRepo: handle.charactersRepo,
            foreshadowingRepo: handle.foreshadowingRepo,
            timelineRepo: handle.timelineRepo,
            chapterNo: no,
          },
          genreDeps: { repo: handle.genreSectionsRepo, charactersRepo: handle.charactersRepo },
          abortSignal: c.req.raw.signal,
          deepestPrompt,
          readerIssuesRepo: handle.readerIssuesRepo,
        },
        {
          chapterNo: no,
          chapterContent: finalContent,
          archiveSummary,
          qualityGateResult: { passed: blockingIssues.length === 0, blockingIssues },
        },
      )) {
        if (ev.type === "error") { recordOk = false; yield ev; break; }
        if (ev.type === "tool_call_start" || ev.type === "tool_call_end") yield ev;
      }
      if (recordOk) {
        yield { type: "tool_call_end" as const, toolName: "record_chapter_state", result: { success: true } };
      }
      deps.onChapterCommitted?.(bookId);
      yield { type: "done" as const };
    }
    return streamSseResponse(holdBook(deps.registry, bookId, withUsageRecording(finalizeFlow(), {
      tokenUsageRepo: handle.tokenUsageRepo,
      booksRepo: deps.registry.booksRepo,
      bookId,
      modelInfo: deps.writeModelInfo ?? deps.auditModelInfo,
      taskType: "audit",
      chapterNo: no,
    })));
  });

  // 读取章节(编辑器加载)
  app.get("/api/books/:bookId/chapters/:no", async (c) => {
    const bookId = c.req.param("bookId");
    const no = Number(c.req.param("no"));
    if (!Number.isInteger(no) || no < 1) return c.json({ error: "章节号无效" }, 400);
    if (!deps.registry) return c.json({ error: "服务未就绪" }, 503);
    const book = deps.registry.booksRepo.get(bookId);
    if (!book) return c.json({ error: "书不存在" }, 404);
    const handle = deps.registry.open(bookId);
    const record = handle.chapterFiles.read(no);
    if (!record) return c.json({ error: "章节不存在" }, 404);
    return c.json(record);
  });

  // 章节列表
  app.get("/api/books/:bookId/chapters", async (c) => {
    const bookId = c.req.param("bookId");
    if (!deps.registry) return c.json({ error: "服务未就绪" }, 503);
    const book = deps.registry.booksRepo.get(bookId);
    if (!book) return c.json({ error: "书不存在" }, 404);
    const handle = deps.registry.open(bookId);
    return c.json({ chapters: handle.chapterFiles.list() });
  });

  // 用户手动保存(user_edit version)
  app.put("/api/books/:bookId/chapters/:no", async (c) => {
    const bookId = c.req.param("bookId");
    const no = Number(c.req.param("no"));
    if (!Number.isInteger(no) || no < 1) return c.json({ error: "章节号无效" }, 400);
    if (!deps.registry) return c.json({ error: "服务未就绪" }, 503);
    const book = deps.registry.booksRepo.get(bookId);
    if (!book) return c.json({ error: "书不存在" }, 404);

    const body = await c.req.json().catch(() => ({}));
    const content = String((body as { content?: unknown })?.content ?? "");
    if (!content.trim()) return c.json({ error: "content 不能为空" }, 400);
    const titleRaw = (body as { title?: unknown })?.title;
    const handle = deps.registry.open(bookId);
    const existing = handle.chapterFiles.read(no);
    const title = typeof titleRaw === "string" && titleRaw.trim()
      ? titleRaw.trim()
      : existing?.title ?? `第${no}章`;

    const saved = handle.chaptersRepo.saveVersion({
      chapterNo: no,
      source: "user_edit",
      contentMd: content,
    });
    try {
      handle.chapterFiles.save({ chapterNo: no, title, content, versionNo: saved.versionNo });
    } catch (fsErr) {
      try { handle.chaptersRepo.deleteVersion(no, saved.versionNo); } catch { /* ignore */ }
      return c.json({ error: `章节文件落盘失败:${(fsErr as Error).message ?? "unknown"}` }, 500);
    }
    deps.onChapterCommitted?.(bookId);
    return c.json({ versionNo: saved.versionNo });
  });

  // 删除章节（回档语义）：删第 N 章及之后所有章 + 所有派生数据
  app.delete("/api/books/:bookId/chapters/:no", async (c) => {
    const bookId = c.req.param("bookId");
    const no = Number(c.req.param("no"));
    if (!Number.isInteger(no) || no < 1) return c.json({ error: "章节号无效" }, 400);
    if (!deps.registry) return c.json({ error: "服务未就绪" }, 503);
    const book = deps.registry.booksRepo.get(bookId);
    if (!book) return c.json({ error: "书不存在" }, 404);
    const handle = deps.registry.open(bookId);
    if (!deps.registry.tryBeginExclusive(bookId)) {
      return c.json({ error: "这本书正在写作/生成或另一项操作进行中,请稍后再删除章节" }, 409);
    }
    try {
      log.info("chapters", `DELETE 收到：book=${bookId} from=${no}`);
      const result = deleteChaptersFrom(handle, no);
      if (result.deletedChapters.length === 0) {
        return c.json({ error: `没有第 ${no} 章或更后的章节`, result }, 404);
      }
      return c.json({ result });
    } finally {
      deps.registry.endExclusive(bookId);
    }
  });

  // 删除所有章节（回档到书初状态）
  app.delete("/api/books/:bookId/chapters", async (c) => {
    const bookId = c.req.param("bookId");
    if (!deps.registry) return c.json({ error: "服务未就绪" }, 503);
    const book = deps.registry.booksRepo.get(bookId);
    if (!book) return c.json({ error: "书不存在" }, 404);
    const handle = deps.registry.open(bookId);
    if (!deps.registry.tryBeginExclusive(bookId)) {
      return c.json({ error: "这本书正在写作/生成或另一项操作进行中,请稍后再清空章节" }, 409);
    }
    try {
      log.info("chapters", `DELETE ALL：book=${bookId}`);
      const result = deleteChaptersFrom(handle, 1);
      return c.json({ result });
    } finally {
      deps.registry.endExclusive(bookId);
    }
  });

  return app;
}
