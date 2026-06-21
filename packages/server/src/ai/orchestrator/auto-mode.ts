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
  recordState?: (chapterNo: number, qualityGateResult?: { passed: boolean; blockingIssues: string[] }) => AsyncIterable<SseEvent>;
  /**
   * 可选:为每章组装 spec §6.1 完整防漂移上下文(召回+最近摘要+通用记录集合+伏笔)。
   * 提供时优先于静态 writeCtx,因为召回结果逐章变化,必须按当前章号重算。
   */
  buildWriteMessages?: (chapterNo: number) => CoreMessage[];
  buildAuditCtx?: (chapterNo: number) => WriteWithAuditInput["auditCtx"];
  /** 用户最深处提示词,原文拼到最前端(写作与审查) */
  deepestPrompt?: string;
}

/** 可重试的瞬时流/网络错误(provider 断流、连接重置、超时等) */
function isTransient(message: string): boolean {
  return /terminated|fetch failed|ECONNRESET|socket hang up|EAI_AGAIN|ETIMEDOUT|timeout|stream.*idle|network|aborted the connection|premature close/i.test(
    message,
  );
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

    // 单章写作带重试:长篇 reasoning 写作的流可能被 provider/网络中途 terminate。
    // 每次尝试把事件缓冲为原子单元 —— 失败且本章尚未落盘时丢弃缓冲并重试,
    // 避免一次瞬时断流就终结整个 /auto 长跑(只有写阶段断流才会"未落盘")。
    const MAX_WRITE_ATTEMPTS = 3;
    let chapterFailed = false;
    /** 从 writeWithAudit 事件流里捕获的硬事实闸门结果 */
    let hardFactGateResult: { passed: boolean; blockingIssues: string[] } | undefined;
    for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt++) {
      if (deps.abortSignal?.aborted) {
        yield { type: "auto_status", state: "paused_by_user", remaining, doneChapters: [...doneChapters] };
        return;
      }
      const buffered: SseEvent[] = [];
      let errEvent: Extract<SseEvent, { type: "error" }> | undefined;
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
          auditCtx: deps.buildAuditCtx?.(next) ?? input.auditCtx,
          enableRepair: true,
          broadcastHardFactGate: true,
          abortSignal: deps.abortSignal,
          deepestPrompt: deps.deepestPrompt,
        },
      )) {
        if (ev.type === "done") continue; // auto 流自管终结
        if (ev.type === "error") { errEvent = ev; break; }
        // 捕获硬事实闸门结果
        if (ev.type === "tool_call_end" && ev.toolName === "hard_fact_gate") {
          const result = ev.result as { passed?: boolean; blockingIssues?: string[] };
          hardFactGateResult = {
            passed: result.passed ?? true,
            blockingIssues: result.blockingIssues ?? [],
          };
        }
        buffered.push(ev);
      }

      const saved = deps.maxChapterNo() >= next; // 本章是否已落盘
      if (!errEvent) {
        for (const ev of buffered) yield ev; // 干净完成,整段一次性放出
        break;
      }
      if (saved) {
        // 写已成功落盘,错误发生在审查/修复阶段:正文有了就继续(verdict 缺省按通过)
        for (const ev of buffered) yield ev;
        yield errEvent;
        chapterFailed = true;
        break;
      }
      // 写阶段断流、未落盘:可重试的瞬时错误则丢弃缓冲重来
      const transient = isTransient(errEvent.message) && !deps.abortSignal?.aborted;
      if (transient && attempt < MAX_WRITE_ATTEMPTS) {
        yield {
          type: "auto_status", state: "writing", remaining,
          doneChapters: [...doneChapters], currentChapter: next,
        };
        continue;
      }
      // 不可重试或重试用尽:放出缓冲 + 错误,终结
      for (const ev of buffered) yield ev;
      yield errEvent;
      chapterFailed = true;
      break;
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

    // 章末状态记录(角色状态/出场/伏笔/时间线/通用记录条目)
    // 硬事实闸门未通过时,qualityGateResult 传入 recordChapterState 阻断状态记录
    if (deps.recordState) {
      yield { type: "tool_call_start", toolName: "record_chapter_state", args: { chapterNo: next } };
      let recordOk = true;
      for await (const ev of deps.recordState(next, hardFactGateResult)) {
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
      } else {
        yield {
          type: "auto_status", state: "error", remaining,
          doneChapters: [...doneChapters], currentChapter: next,
        };
        return;
      }
    }

    doneChapters.push(next);
    remaining -= 1;
  }

  const finalState = deps.abortSignal?.aborted ? "paused_by_user" : "done";
  yield { type: "auto_status", state: finalState, remaining, doneChapters: [...doneChapters] };
  yield { type: "done" };
}
