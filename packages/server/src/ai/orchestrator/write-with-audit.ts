import type { LanguageModel } from "ai";
import type { SseEvent } from "@scribe/shared";
import {
  writeChapterSimple,
  type ChaptersRepoLike as ChaptersRepoWriteLike,
  type ChapterFilesLike,
  type WriteChapterInput,
} from "./write-chapter.js";
import {
  auditChapter,
  type AuditContext,
  type AuditResult,
} from "./audit-chapter.js";
import {
  persistAuditResult,
  type ChaptersRepoAuditLike,
} from "./audit-persist.js";
import { repairChapter, type RepairDeps } from "./repair-chapter.js";

/**
 * 端到端依赖。chaptersRepo 必须同时满足 write/repair 路径(saveVersion/
 * deleteVersion)与 audit/summary 落盘(saveAudit/saveSummary),用交叉类型
 * 在编译期强制调用方提供完整 repo,避免运行时 TypeError。
 */
export interface WriteWithAuditDeps {
  model: LanguageModel;
  chaptersRepo: ChaptersRepoWriteLike & ChaptersRepoAuditLike;
  chapterFiles: ChapterFilesLike;
  /** 用于 audit 与 repair 后再审的非流式模型 */
  auditModel: LanguageModel;
  /** 落盘 audit 行时记录的模型 ID,便于后续追溯 */
  auditModelId: string;
}

export interface WriteWithAuditInput extends WriteChapterInput {
  /** 审查 / 修复时附加的上下文(premise / rules / 角色 / 伏笔 等) */
  auditCtx?: Partial<Omit<AuditContext, "chapterNo" | "chapterContent">>;
  /** verdict=critical 时是否触发 repair,默认 true */
  enableRepair?: boolean;
}

/**
 * 端到端编排:写章节 → 审 → 落盘 → (可选)修复 → 再审 → 落盘。
 *
 * 阶段:
 * 1. writeChapterSimple 流式写入并落盘 .md / chapter_versions(source: ai_write)
 * 2. auditChapter 非流式审查,产出 verdict + issues + summary
 * 3. persistAuditResult 把 audit + summary 落到 chapter_audits / chapter_summaries
 *    并通过 tool_call_end(chapter_audit) 把审查摘要广播给前端
 * 4. 仅当 verdict=critical 且 enableRepair!==false 时:
 *    - tool_call_start(chapter_repair) 通知前端
 *    - repairChapter 流式输出修复版正文,落盘 ai_rewrite version
 *    - 修复成功后再 audit 一次并 persist,通过 tool_call_end(chapter_repair_audit)
 *      把"还在不在 critical"反馈给前端
 *
 * 任一阶段失败都用 yield error 替代 done(参见 backlog B-3-002),不会出现
 * "done 之后还有 error"的双终结情况。
 */
export async function* writeWithAudit(
  deps: WriteWithAuditDeps,
  input: WriteWithAuditInput,
): AsyncIterable<SseEvent> {
  // ---- 阶段 1: 写章节(流式) ----
  let writtenContent = "";
  let writeSucceeded = false;
  for await (const ev of writeChapterSimple(deps, input)) {
    if (ev.type === "text_delta") writtenContent += ev.delta;
    if (ev.type === "done") {
      writeSucceeded = true;
      // 不直接转发 done,等到端到端流程结束再发,避免双重终结
      continue;
    }
    if (ev.type === "error") {
      yield ev;
      return;
    }
    yield ev;
  }
  if (!writeSucceeded) return;
  // 写阶段汇报 done 但实际未产出任何文本时,流必须以终结事件收尾。
  // writeChapterSimple 在 buffer 为空时不会落盘,这里也不会产出任何下游
  // 工件,直接以 error(empty_response) 结束,让客户端可观察终结状态。
  if (!writtenContent.trim()) {
    yield {
      type: "error",
      errorClass: "empty_response",
      message: "LLM 未返回章节正文",
    };
    return;
  }

  // ---- 阶段 2: audit + summarize(非流式) ----
  let auditResult: AuditResult;
  try {
    auditResult = await auditChapter(
      { model: deps.auditModel, abortSignal: input.abortSignal },
      {
        chapterNo: input.chapterNo,
        chapterContent: writtenContent,
        ...input.auditCtx,
      },
    );
  } catch (e) {
    yield {
      type: "error",
      errorClass: "audit_failed",
      message: `审查失败:${(e as Error).message}`,
    };
    return;
  }

  // ---- 阶段 3: 落盘 audit + summary ----
  persistAuditResult(
    deps.chaptersRepo,
    input.chapterNo,
    auditResult,
    deps.auditModelId,
  );

  yield {
    type: "tool_call_end",
    toolName: "chapter_audit",
    result: {
      verdict: auditResult.output.verdict,
      issuesCount: auditResult.output.issues.length,
      summary: auditResult.output.summary,
    },
  };

  // ---- 阶段 4: 可选 repair ----
  const enableRepair = input.enableRepair ?? true;
  if (enableRepair && auditResult.output.verdict === "critical") {
    yield {
      type: "tool_call_start",
      toolName: "chapter_repair",
      args: { chapterNo: input.chapterNo, reason: "critical issues found" },
    };
    let repairContent = "";
    let repairOk = false;
    const repairDeps: RepairDeps = {
      model: deps.model,
      chaptersRepo: deps.chaptersRepo,
      chapterFiles: deps.chapterFiles,
      abortSignal: input.abortSignal,
    };
    for await (const ev of repairChapter(repairDeps, {
      chapterNo: input.chapterNo,
      ctx: {
        chapterContent: writtenContent,
        issues: auditResult.output.issues,
        ...(input.auditCtx as Partial<AuditContext>),
      },
    })) {
      if (ev.type === "text_delta") repairContent += ev.delta;
      if (ev.type === "done") {
        repairOk = true;
        continue;
      }
      if (ev.type === "error") {
        yield ev;
        return;
      }
      yield ev;
    }
    if (repairOk && repairContent.trim()) {
      try {
        const reAudit = await auditChapter(
          { model: deps.auditModel, abortSignal: input.abortSignal },
          {
            chapterNo: input.chapterNo,
            chapterContent: repairContent,
            ...input.auditCtx,
          },
        );
        persistAuditResult(
          deps.chaptersRepo,
          input.chapterNo,
          reAudit,
          deps.auditModelId,
        );
        yield {
          type: "tool_call_end",
          toolName: "chapter_repair_audit",
          result: {
            verdict: reAudit.output.verdict,
            stillCritical: reAudit.output.verdict === "critical",
          },
        };
      } catch (e) {
        yield {
          type: "error",
          errorClass: "repair_audit_failed",
          message: `修复后再审失败:${(e as Error).message}`,
        };
        return;
      }
    }
  }

  yield { type: "done" };
}
