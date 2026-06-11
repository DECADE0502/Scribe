import type { CoreMessage } from "ai";
import type { SseEvent, ModelInfo } from "@scribe/shared";
import {
  writeWithAudit,
  type WriteWithAuditDeps,
  type WriteWithAuditInput,
} from "./write-with-audit.js";
import { checkAutoModeBudget, type UsageStatsLike } from "../budget-check.js";

export interface AutoModeDeps extends Omit<WriteWithAuditDeps, "model" | "auditModel"> {
  model: WriteWithAuditDeps["model"];
  auditModel: WriteWithAuditDeps["auditModel"];
  /** 取当前最大章节号 */
  maxChapterNo(): number;
  /** 取某章 audit verdict */
  getVerdict(chapterNo: number): "ok" | "warning" | "critical" | undefined;
  /** 预算 */
  budgetLimitUsd: number;
  writeModelInfo: ModelInfo;
  auditModelInfo: ModelInfo;
  usageStats?: UsageStatsLike;
  abortSignal?: AbortSignal;
  /** 可选:章末状态记录 pass(spec §6.3),audit 通过后调用 */
  recordState?: (chapterNo: number) => AsyncIterable<SseEvent>;
  /**
   * 可选:为每章组装 spec §6.1 完整防漂移上下文(召回+最近摘要+题材板块+伏笔)。
   * 提供时优先于静态 writeCtx,因为召回结果逐章变化,必须按当前章号重算。
   */
  buildWriteMessages?: (chapterNo: number) => CoreMessage[];
}

export interface AutoModeInput {
  n: number;
  auditCtx?: WriteWithAuditInput["auditCtx"];
  writeCtx?: WriteWithAuditInput["ctx"];
}

/**
 * /auto N 状态机:逐章 写→审→(critical 即停),用户 abort 完成当前章后停。
 * 入口先做预算预检,超限直接 error 终结。
 */
export async function* runAutoMode(
  deps: AutoModeDeps,
  input: AutoModeInput,
): AsyncIterable<SseEvent> {
  const doneChapters: number[] = [];
  let remaining = Math.max(0, Math.floor(input.n));

  if (remaining === 0) {
    yield { type: "error", errorClass: "invalid_input", message: "章节数必须为正整数(示例:/auto 3)" };
    return;
  }

  // 预算预检
  const budget = checkAutoModeBudget(
    remaining,
    deps.budgetLimitUsd,
    deps.writeModelInfo,
    deps.auditModelInfo,
    deps.usageStats,
  );
  if (!budget.ok) {
    yield {
      type: "error",
      errorClass: "budget_exceeded",
      message: `预计花费 $${budget.estimate.estimatedUsd.toFixed(2)},超过单次上限 $${budget.limitUsd.toFixed(2)},请到设置中调整或减少章节数`,
    };
    return;
  }

  yield { type: "auto_status", state: "planning", remaining, doneChapters: [...doneChapters] };

  while (remaining > 0) {
    if (deps.abortSignal?.aborted) {
      yield { type: "auto_status", state: "paused_by_user", remaining, doneChapters: [...doneChapters] };
      return;
    }
    const next = deps.maxChapterNo() + 1;
    yield {
      type: "auto_status", state: "writing", remaining,
      doneChapters: [...doneChapters], currentChapter: next,
    };

    let chapterFailed = false;
    for await (const ev of writeWithAudit(
      {
        model: deps.model,
        auditModel: deps.auditModel,
        auditModelId: deps.auditModelId,
        chaptersRepo: deps.chaptersRepo,
        chapterFiles: deps.chapterFiles,
      },
      {
        chapterNo: next,
        userIntent: "",
        ctx: input.writeCtx,
        prebuiltMessages: deps.buildWriteMessages?.(next),
        auditCtx: input.auditCtx,
        enableRepair: true,
        abortSignal: deps.abortSignal,
      },
    )) {
      // 内层 done 不透传(整个 auto 流自己管理终结),其余事件透传
      if (ev.type === "done") continue;
      if (ev.type === "error") {
        yield ev;
        chapterFailed = true;
        break;
      }
      yield ev;
    }
    if (chapterFailed) {
      yield { type: "auto_status", state: "error", remaining, doneChapters: [...doneChapters], currentChapter: next };
      return;
    }

    const verdict = deps.getVerdict(next);
    if (verdict === "critical") {
      yield {
        type: "auto_status", state: "paused_by_critical", remaining,
        doneChapters: [...doneChapters], currentChapter: next,
      };
      return;
    }

    // 章末状态记录(角色状态/出场/伏笔/时间线/题材板块条目)
    if (deps.recordState) {
      yield { type: "tool_call_start", toolName: "record_chapter_state", args: { chapterNo: next } };
      let recordOk = true;
      for await (const ev of deps.recordState(next)) {
        if (ev.type === "error") {
          recordOk = false;
          // 记录失败不阻断自动写作,降级为提示
          yield {
            type: "tool_call_end", toolName: "record_chapter_state",
            result: { success: false, message: ev.message },
          };
          break;
        }
        // 透传内部工具事件,便于 UI 展示记录进度
        if (ev.type === "tool_call_start" || ev.type === "tool_call_end") yield ev;
      }
      if (recordOk) {
        yield { type: "tool_call_end", toolName: "record_chapter_state", result: { success: true } };
      }
    }

    doneChapters.push(next);
    remaining -= 1;
  }

  const finalState = deps.abortSignal?.aborted ? "paused_by_user" : "done";
  yield { type: "auto_status", state: finalState, remaining, doneChapters: [...doneChapters] };
  yield { type: "done" };
}
