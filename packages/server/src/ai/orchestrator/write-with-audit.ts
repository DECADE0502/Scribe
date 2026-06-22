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
  type ReaderIssuesRepoAuditLike,
} from "./audit-persist.js";
import type { RepairContext } from "../prompts/repair-chapter.js";
import { repairChapter, type RepairDeps } from "./repair-chapter.js";
import { sanitizeChapterOutput } from "./output-sanitize.js";

type ReadableChapterFilesLike = ChapterFilesLike & {
  read(chapterNo: number): { content: string } | undefined;
};

function readChapterContent(
  chapterFiles: ChapterFilesLike,
  chapterNo: number,
): string | undefined {
  if ("read" in chapterFiles && typeof chapterFiles.read === "function") {
    return (chapterFiles as ReadableChapterFilesLike).read(chapterNo)?.content;
  }
  return undefined;
}

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
  readerIssuesRepo?: ReaderIssuesRepoAuditLike;
}

export interface WriteWithAuditInput extends WriteChapterInput {
  /** 审查 / 修复时附加的上下文(premise / rules / 角色 / 伏笔 等) */
  auditCtx?: Partial<Omit<AuditContext, "chapterNo" | "chapterContent">>;
  /** verdict=critical 时是否触发 repair,默认 true */
  enableRepair?: boolean;
  /**
   * 调用方提供的机器质量门禁。用于捕捉 audit 模型可能漏掉的硬约束,
   * 例如导入预设要求的固定输出段落或非小说 meta 泄漏。
   */
  qualityGate?: (input: {
    chapterNo: number;
    chapterContent: string;
    stage: "draft" | "repair";
    auditVerdict: string;
    /** audit 模型提取的硬事实声明（如果 audit 输出了 hardFacts） */
    auditHardFacts?: import("@scribe/shared").HardFactClaimOutput[];
  }) => RepairContext["issues"] | Promise<RepairContext["issues"]>;
  /**
   * 如果为 true,在 writeWithAudit 结束时通过 yield 一个
   * tool_call_end(hard_fact_gate) 事件广播最终质量门禁结果,
   * 供调用方(recordState)使用。默认 false。
   */
  broadcastHardFactGate?: boolean;
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
  let writeSucceeded = false;
  /** 最终质量门禁 issues（用于广播给 recordState 调用方） */
  let finalQualityIssues: RepairContext["issues"] = [];
  for await (const ev of writeChapterSimple(deps, input)) {
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
  const finalWrittenContent = sanitizeChapterOutput(readChapterContent(deps.chapterFiles, input.chapterNo) ?? "");
  if (!finalWrittenContent.trim()) {
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
      { model: deps.auditModel, abortSignal: input.abortSignal, deepestPrompt: input.deepestPrompt },
      {
        chapterNo: input.chapterNo,
        chapterContent: finalWrittenContent,
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

  // 全量计费:审查也是一次 LLM 调用(审查模型定价)
  yield {
    type: "usage",
    promptTokens: auditResult.usage.promptTokens,
    completionTokens: auditResult.usage.completionTokens,
    cachedTokens: auditResult.usage.cachedTokens,
    reasoningTokens: auditResult.usage.reasoningTokens,
    modelRole: "audit",
    taskType: "audit",
    chapterNo: input.chapterNo,
  };

  // ---- 阶段 3: 落盘 audit + summary ----
  persistAuditResult(
    deps.chaptersRepo,
    input.chapterNo,
    auditResult,
    deps.auditModelId,
    deps.readerIssuesRepo,
  );

  yield {
    type: "tool_call_end",
    toolName: "chapter_audit",
    result: {
      verdict: auditResult.output.verdict,
      issuesCount: auditResult.output.issues.filter((i) => i.severity !== "ok").length,
      summary: auditResult.output.summary,
    },
  };

  // ---- 阶段 4: 可选 repair ----
  const enableRepair = input.enableRepair ?? true;
  const draftQualityIssues = await runQualityGate(input, {
    chapterNo: input.chapterNo,
    chapterContent: finalWrittenContent,
    stage: "draft",
    auditVerdict: auditResult.output.verdict,
    auditHardFacts: auditResult.hardFacts,
  });
  if (draftQualityIssues.error) {
    yield draftQualityIssues.error;
    return;
  }
  finalQualityIssues = draftQualityIssues.issues;
  const shouldRepair =
    enableRepair &&
    (auditResult.output.verdict === "critical" || draftQualityIssues.issues.length > 0);
  if (shouldRepair) {
    const repairIssues =
      auditResult.output.verdict === "critical"
        ? [...auditResult.output.issues, ...draftQualityIssues.issues]
        : draftQualityIssues.issues;
    yield {
      type: "tool_call_start",
      toolName: "chapter_repair",
      args: {
        chapterNo: input.chapterNo,
        reason: auditResult.output.verdict === "critical"
          ? "critical issues found"
          : "quality gate failed",
        qualityIssueCount: draftQualityIssues.issues.length,
      },
    };

    /**
     * chapter_repair 的 tool_call_start 必须严格成对一个 tool_call_end,
     * 否则前端的 toolCall 加载状态会卡死。所有可能的退出路径都通过这个
     * 帮助函数广播 end,以 success 标记区分"修复有效完成"还是"修复中断/空跑"。
     */
    const repairEnd = (
      success: boolean,
      extra: Record<string, unknown> = {},
    ): SseEvent => ({
      type: "tool_call_end",
      toolName: "chapter_repair",
      result: { success, ...extra },
    });

    let repairOk = false;
    const repairDeps: RepairDeps = {
      model: deps.model,
      chaptersRepo: deps.chaptersRepo,
      chapterFiles: deps.chapterFiles,
      abortSignal: input.abortSignal,
      deepestPrompt: input.deepestPrompt,
    };
    let repairStreamErrored = false;
    for await (const ev of repairChapter(repairDeps, {
      chapterNo: input.chapterNo,
      chapterTitle: input.chapterTitle,
      ctx: {
        chapterContent: finalWrittenContent,
        issues: repairIssues,
        ...(input.auditCtx as Partial<AuditContext>),
      },
    })) {
      if (ev.type === "done") {
        repairOk = true;
        continue;
      }
      if (ev.type === "error") {
        yield ev;
        yield repairEnd(false, {
          reason: "repair_stream_error",
          message: ev.message,
        });
        repairStreamErrored = true;
        return;
      }
      yield ev;
    }
    // 上面 return 不会走到这里;此处是为了让类型/控制流显式
    if (repairStreamErrored) return;

    const finalRepairContent = sanitizeChapterOutput(readChapterContent(deps.chapterFiles, input.chapterNo) ?? "");
    if (repairOk && finalRepairContent.trim()) {
      try {
        const reAudit = await auditChapter(
          { model: deps.auditModel, abortSignal: input.abortSignal, deepestPrompt: input.deepestPrompt },
          {
            chapterNo: input.chapterNo,
            chapterContent: finalRepairContent,
            ...input.auditCtx,
          },
        );
        persistAuditResult(
          deps.chaptersRepo,
          input.chapterNo,
          reAudit,
          deps.auditModelId,
          deps.readerIssuesRepo,
        );
        yield {
          type: "usage",
          promptTokens: reAudit.usage.promptTokens,
          completionTokens: reAudit.usage.completionTokens,
          cachedTokens: reAudit.usage.cachedTokens,
          reasoningTokens: reAudit.usage.reasoningTokens,
          modelRole: "audit",
          taskType: "audit",
          chapterNo: input.chapterNo,
        };
        const repairQualityIssues = await runQualityGate(input, {
          chapterNo: input.chapterNo,
          chapterContent: finalRepairContent,
          stage: "repair",
          auditVerdict: reAudit.output.verdict,
          auditHardFacts: reAudit.hardFacts,
        });
        if (repairQualityIssues.error) {
          yield repairQualityIssues.error;
          yield repairEnd(true, { reason: "repair_done_but_quality_gate_failed" });
          return;
        }
        finalQualityIssues = repairQualityIssues.issues;
        yield repairEnd(true);
        yield {
          type: "tool_call_end",
          toolName: "chapter_repair_audit",
          result: {
            verdict: reAudit.output.verdict,
            stillCritical:
              reAudit.output.verdict === "critical" ||
              repairQualityIssues.issues.length > 0,
            qualityIssues: repairQualityIssues.issues.map((issue) => issue.note),
          },
        };
      } catch (e) {
        yield {
          type: "error",
          errorClass: "repair_audit_failed",
          message: `修复后再审失败:${(e as Error).message}`,
        };
        // repair 流本身已经成功落盘,这里把 chapter_repair 标记为成功结束,
        // 但通过 reason 传递再审失败的语义,避免 UI 误判 repair 没跑完
        yield repairEnd(true, { reason: "repair_done_but_reaudit_failed" });
        return;
      }
    } else {
      // repair 内部 silent skip(buffer 为空或未收到 done):
      // write+audit 已成功落盘,继续 yield done,但补齐 chapter_repair 的 end
      yield repairEnd(false, { reason: "empty_or_silent" });
    }
  }

  // 广播最终质量门禁结果,供调用方(recordState)使用
  if (input.broadcastHardFactGate) {
    const blockingIssues = finalQualityIssues
      .filter((issue) => issue.severity === "critical")
      .map((issue) => issue.note);
    yield {
      type: "tool_call_end",
      toolName: "hard_fact_gate",
      result: {
        passed: blockingIssues.length === 0,
        blockingIssues,
      },
    };
  }

  yield { type: "done" };
}

async function runQualityGate(
  input: WriteWithAuditInput,
  gateInput: {
    chapterNo: number;
    chapterContent: string;
    stage: "draft" | "repair";
    auditVerdict: string;
    auditHardFacts?: import("@scribe/shared").HardFactClaimOutput[];
  },
): Promise<{
  issues: RepairContext["issues"];
  error?: SseEvent;
}> {
  if (!input.qualityGate) return { issues: [] };
  try {
    return { issues: await input.qualityGate(gateInput) };
  } catch (e) {
    return {
      issues: [],
      error: {
        type: "error",
        errorClass: "quality_gate_failed",
        message: `质量门禁失败:${(e as Error).message}`,
      },
    };
  }
}
