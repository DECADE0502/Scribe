import { useCallback, useEffect, useRef, useState } from "react";
import { parseSlashCommand, type ExecutionMode, type ExecutionStep } from "@scribe/shared";
import { t } from "../../i18n/zh-CN.js";
import { useConversationStore, type ChatMessage, type WorkflowStageStatus } from "../../stores/conversation.js";
import { startSseStream, type SseStreamHandle, type StartStreamOptions } from "../../api/streaming.js";
import { Message } from "./message.js";
import { StreamingMessage } from "./streaming-message.js";
import { SlashSuggestions } from "./slash-suggestions.js";
import { ExecutionModeSelector } from "./execution-mode-selector.js";
import { ExecutionConfirmationCard } from "./execution-confirmation-card.js";

export type StreamFn = (opts: StartStreamOptions) => SseStreamHandle;

/** 工具名 → 人类可读中文进度提示 */
const TOOL_LABELS: Record<string, string> = {
  chapter_write: "正在写正文",
  chapter_audit: "正在审查章节质量",
  chapter_repair: "发现质量问题,正在修复",
  chapter_repair_audit: "修复后再次审查",
  hard_fact_gate: "正在检查硬事实一致性",
  record_chapter_state: "正在记录角色状态和设定",
  create_character: "正在登记新角色",
  update_character_state: "正在更新角色状态",
  add_character_appearance: "正在记录角色出场",
  add_foreshadowing: "正在登记伏笔",
  pay_foreshadowing: "正在回收伏笔",
  add_timeline_event: "正在记录时间线",
  upsert_record_item: "正在更新通用记录",
  create_record_collection: "正在创建记录集合",
};

/** 判断是否是写作流程(而非纯对话) */
const WRITING_TOOLS = new Set(["chapter_write", "chapter_audit", "record_chapter_state", "hard_fact_gate", "chapter_repair", "chapter_repair_audit"]);
const WRITING_STAGES = [
  { id: "chapter_write", label: "写正文", status: "pending" as const },
  { id: "chapter_audit", label: "审查", status: "pending" as const },
  { id: "hard_fact_gate", label: "硬事实检查", status: "pending" as const },
  { id: "chapter_repair", label: "修复", status: "pending" as const },
  { id: "record_chapter_state", label: "记录状态", status: "pending" as const },
  { id: "done", label: "完成", status: "pending" as const },
];

const ASSET_AUDIT_OPTIONS = [
  { id: "all", label: "全部资产", scope: "已有所有资产:正文摘要、章节正文、书籍设定、大纲、角色、伏笔、时间线、通用记录集合" },
  { id: "elements", label: "元素", scope: "元素资产:出场元素、道具、地点、组织、能力、线索、伏笔和正文里已经出现过的可复用素材" },
  { id: "story", label: "剧情", scope: "剧情资产:已有章节、章节摘要、剧情因果、节奏、承接、未完成动作" },
  { id: "setting", label: "设定", scope: "设定资产:书籍前提、世界规则、硬事实、时间线、通用记录集合" },
  { id: "characters", label: "角色", scope: "角色资产:角色档案、当前状态、出场记录、关系、语言习惯和动机" },
  { id: "outline", label: "大纲", scope: "大纲资产:卷、弧、章级大纲、章节状态和已写正文的对应关系" },
  { id: "foreshadowing", label: "伏笔", scope: "伏笔资产:活跃伏笔、已回收伏笔、埋设章节、回收章节和正文证据" },
] as const;

function buildAssetAuditRequest(scope: string): string {
  return [
    `主动审查全书资产。范围:${scope}。`,
    "必须先读取相关已有资产,不要只审查当前章。",
    "检查重复、缺漏、冲突、OOC、时间线错误、伏笔未闭环、设定和正文不一致、工具写入失败或未落库等 bug。",
    "能通过低风险资料修正解决的,按当前执行模式走完整工作流修复;涉及高风险或不确定改动先说明并等待确认。",
    "最后输出验收报告:已检查的资产、发现的问题、已修复项、仍需用户决定的项。",
  ].join("\n");
}

const EXECUTION_STEP_LABELS: Record<string, string> = {
  chapter_write: "写正文",
  multi_chapter_write: "写正文",
  record_chapter_state: "记录状态",
  chapter_audit: "审查",
  chapter_repair: "修复",
  chapter_repair_audit: "复核",
  hard_fact_gate: "硬事实检查",
};

function workflowLabelForStep(step: ExecutionStep): string {
  const base = EXECUTION_STEP_LABELS[step.actionType] ?? step.actionType;
  return step.argsSummary ? `${base} · ${step.argsSummary}` : base;
}

function workflowStatusFromStep(step: ExecutionStep): WorkflowStageStatus {
  if (step.status === "succeeded") return "done";
  if (step.status === "failed") return "error";
  if (step.status === "running") return "active";
  return "pending";
}

const MUTATING_LIBRARY_TOOLS = new Set([
  "add_outline_node",
  "update_outline_node",
  "delete_outline_node",
  "create_character",
  "update_character",
  "delete_character",
  "create_foreshadowing",
  "pay_foreshadowing",
  "delete_foreshadowing",
  "add_timeline_event",
  "update_book_meta",
  "create_genre_section",
  "update_genre_section_schema",
  "delete_genre_section",
  "add_genre_section_item",
  "upsert_genre_section_item",
  "update_genre_section_item",
  "delete_genre_section_item",
  "create_record_collection",
  "update_record_collection_schema",
  "delete_record_collection",
  "upsert_record_item",
  "update_record_item",
  "delete_record_item",
]);

const TOOL_RESULT_LABELS: Record<string, string> = {
  add_outline_node: "添加大纲节点",
  update_outline_node: "更新大纲节点",
  delete_outline_node: "删除大纲节点",
  create_character: "创建角色",
  update_character: "更新角色",
  delete_character: "删除角色",
  create_foreshadowing: "登记伏笔",
  pay_foreshadowing: "回收伏笔",
  delete_foreshadowing: "删除伏笔",
  add_timeline_event: "记录时间线",
  update_book_meta: "更新书籍设定",
  create_genre_section: "创建记录集合",
  update_genre_section_schema: "更新记录结构",
  delete_genre_section: "删除记录集合",
  add_genre_section_item: "添加记录条目",
  upsert_genre_section_item: "更新记录条目",
  update_genre_section_item: "更新记录条目",
  delete_genre_section_item: "删除记录条目",
  create_record_collection: "创建记录集合",
  update_record_collection_schema: "更新记录结构",
  delete_record_collection: "删除记录集合",
  upsert_record_item: "更新记录条目",
  update_record_item: "更新记录条目",
  delete_record_item: "删除记录条目",
};

const EXTRA_TOOL_LABELS: Record<string, string> = {
  list_outline: "正在查看大纲",
  add_outline_node: "正在添加大纲节点",
  update_outline_node: "正在更新大纲节点",
  delete_outline_node: "正在删除大纲节点",
  list_characters: "正在查看角色",
  update_character: "正在更新角色",
  delete_character: "正在删除角色",
  list_foreshadowing: "正在查看伏笔",
  create_foreshadowing: "正在登记伏笔",
  delete_foreshadowing: "正在删除伏笔",
  list_timeline: "正在查看时间线",
  update_book_meta: "正在更新书籍设定",
  create_genre_section: "正在创建记录集合",
  update_genre_section_schema: "正在更新记录结构",
  delete_genre_section: "正在删除记录集合",
  add_genre_section_item: "正在添加记录条目",
  upsert_genre_section_item: "正在更新记录条目",
  update_genre_section_item: "正在更新记录条目",
  delete_genre_section_item: "正在删除记录条目",
  update_record_collection_schema: "正在更新记录结构",
  delete_record_collection: "正在删除记录集合",
  update_record_item: "正在更新记录条目",
  delete_record_item: "正在删除记录条目",
};

function resultTitle(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  const value = r.title ?? r.name ?? r.label ?? r.id;
  return typeof value === "string" && value.trim() ? value : null;
}

function toolResultMessage(toolName: string, result: unknown): string | null {
  const label = TOOL_RESULT_LABELS[toolName];
  if (!label) return null;
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (r.success === false || typeof r.error === "string") {
      return `工具${label}失败：${String(r.error ?? "未知错误")}`;
    }
  }
  const title = resultTitle(result);
  return title ? `已${label}：${title}` : `已${label}`;
}

export interface ConversationPaneProps {
  bookId: string;
  endpoint?: (bookId: string) => string;
  streamFn?: StreamFn;
}

interface SendOptions {
  executionModeOverride?: ExecutionMode;
  appendUser?: boolean;
  displayContent?: string;
}

let streamSeq = 0;

export function ConversationPane(props: ConversationPaneProps) {
  const endpoint = props.endpoint ?? ((id: string) => `/api/books/${encodeURIComponent(id)}/conversation?mode=chat`);
  const streamFn = props.streamFn ?? startSseStream;
  const {
    messages, streaming, error, autoStatus, executionMode, pendingConfirmation,
    appendUserMessage, appendSystemMessage, beginStream, appendDelta, appendReasoning,
    pushToolEvent, setWorkflowStages, startWorkflow, updateWorkflowStage, setSuppressText,
    finishStream, setError, clearError, setAutoStatus,
    triggerChapterRefresh, triggerLibraryRefresh, setPendingConfirmation, upsertExecutionStep,
    setAcceptanceReport, hydrate, reset,
  } = useConversationStore();
  const handleRef = useRef<SseStreamHandle | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [lastSent, setLastSent] = useState<string | null>(null);
  /** 追踪本次流是否是写作流程 */
  const writingFlowRef = useRef(false);
  const planDrivenWorkflowRef = useRef(false);

  // 加载持久化对话历史（首次挂载或 bookId 变化时）
  useEffect(() => {
    let cancelled = false;
    reset();
    void (async () => {
      try {
        const res = await fetch(`/api/books/${encodeURIComponent(props.bookId)}/conversation?limit=100`);
        if (!res.ok) return;
        const j = await res.json() as { messages: Array<{ id: number; role: "user" | "assistant" | "system"; content: string; metadata: { kind?: string } | null; createdAt: number }> };
        if (cancelled) return;
        // 只回放 chat 类消息（排除 note / onboard / worldbook 等操作记录）
        const msgs: ChatMessage[] = j.messages
          .filter(m => m.metadata?.kind === "chat" && (m.role === "user" || m.role === "assistant"))
          .map(m => ({
            id: `hist-${m.id}`,
            role: m.role,
            content: m.content,
          }));
        hydrate(msgs);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [props.bookId, hydrate, reset]);

  // 自动滚到底
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming?.text]);

  const send = useCallback((text: string, options: SendOptions = {}) => {
    const content = text.trim();
    if (!content || streaming) return;
    clearError();
    setLastSent(content);
    if (options.appendUser !== false) appendUserMessage(options.displayContent ?? content);
    writingFlowRef.current = false;
    planDrivenWorkflowRef.current = false;
    const requestExecutionMode = options.executionModeOverride ?? executionMode;

    // /auto N → 自动模式端点
    const parsed = parseSlashCommand(content);
    const isAuto = parsed.kind === "command" && parsed.id === "auto";
    const autoTotal = isAuto ? Math.max(1, Number(parsed.kind === "command" ? parsed.args : "") || 1) : 0;
    const url = isAuto
      ? `/api/books/${encodeURIComponent(props.bookId)}/auto`
      : endpoint(props.bookId);
    const body = isAuto ? { n: autoTotal } : { message: content, executionMode: requestExecutionMode };
    if (isAuto) setAutoStatus({ state: "planning", doneCount: 0, total: autoTotal });

    beginStream(`s${++streamSeq}`);
    handleRef.current = streamFn({
      url,
      body,
      onEvent: (ev) => {
        switch (ev.type) {
          case "text_delta":
            appendDelta(String(ev.delta ?? ""));
            break;
          case "reasoning_delta":
            appendReasoning(String(ev.delta ?? ""));
            break;
          case "tool_call_start": {
            const toolName = String(ev.toolName ?? "");
            pushToolEvent({ kind: "start", toolName });
            // 检测写作流程
            if (WRITING_TOOLS.has(toolName)) {
              writingFlowRef.current = true;
              setSuppressText(true);
              if (!planDrivenWorkflowRef.current) setWorkflowStages(WRITING_STAGES);
              updateWorkflowStage(toolName, "active");
            }
            // 人类可读进度提示
            const label = EXTRA_TOOL_LABELS[toolName] ?? TOOL_LABELS[toolName];
            if (label) appendSystemMessage(label);
            break;
          }
          case "tool_call_end": {
            const toolName = String(ev.toolName ?? "");
            pushToolEvent({ kind: "end", toolName, payload: ev.result });
            if (WRITING_TOOLS.has(toolName)) updateWorkflowStage(toolName, "done");
            const resultMessage = toolResultMessage(toolName, ev.result);
            if (resultMessage) appendSystemMessage(resultMessage);
            if (MUTATING_LIBRARY_TOOLS.has(toolName)) triggerLibraryRefresh();
            // 写作流程的关键节点提示
            if (toolName === "chapter_audit") {
              const result = ev.result as { verdict?: string };
              const verdict = result?.verdict ?? "unknown";
              const verdictLabel = verdict === "ok" ? "通过" : verdict === "warning" ? "有小问题" : "严重问题";
              appendSystemMessage(`审查完成: ${verdictLabel}`);
            } else if (toolName === "hard_fact_gate") {
              const result = ev.result as { passed?: boolean; blockingIssues?: string[] };
              if (result?.passed) {
                appendSystemMessage("硬事实检查通过");
              } else if (result?.blockingIssues?.length) {
                appendSystemMessage(`硬事实检查发现 ${result.blockingIssues.length} 个矛盾`);
              }
            } else if (toolName === "record_chapter_state") {
              const result = ev.result as { success?: boolean };
              if (result?.success) appendSystemMessage("状态记录完成");
            }
            break;
          }
          case "intent": {
            const labels: Record<string, string> = {
              writing_intent: "开始写下一章...",
              revise_intent: "准备修改内容...",
              query: "查询设定/前情中...",
              genre_section_op: "整理题材资料中...",
              command_explicit: "",
            };
            const label = labels[String(ev.category ?? "")];
            if (String(ev.category ?? "") === "writing_intent") {
              writingFlowRef.current = true;
              startWorkflow(WRITING_STAGES);
            }
            if (label) appendSystemMessage(label);
            break;
          }
          case "auto_status": {
            const done = Array.isArray(ev.doneChapters) ? ev.doneChapters.length : 0;
            const state = String(ev.state ?? "");
            setAutoStatus({
              state, doneCount: done, total: autoTotal,
              currentChapter: typeof ev.currentChapter === "number" ? ev.currentChapter : undefined,
            });
            if (["paused_by_critical", "paused_by_user", "done", "error"].includes(state)) {
              appendSystemMessage(`自动写作结束(${state === "done" ? "全部完成" : state === "paused_by_critical" ? "发现严重问题已暂停" : state === "paused_by_user" ? "已被手动停止" : "出错"}),完成 ${done} 章。`);
            }
            break;
          }
          case "confirmation_required":
            setPendingConfirmation({
              taskId: String(ev.taskId),
              policy: ev.policy as NonNullable<typeof pendingConfirmation>["policy"],
              message: String(ev.message ?? "需要确认后执行"),
            });
            break;
          case "execution_plan": {
            const steps = Array.isArray(ev.steps) ? ev.steps as ExecutionStep[] : [];
            if (steps.length > 0) {
              writingFlowRef.current = true;
              planDrivenWorkflowRef.current = true;
              setSuppressText(true);
              startWorkflow(steps.map(step => ({
                id: step.id,
                label: workflowLabelForStep(step),
                status: workflowStatusFromStep(step),
              })));
            }
            break;
          }
          case "execution_step":
            {
              const step = ev.step as ExecutionStep;
              upsertExecutionStep(String(ev.taskId), step);
              updateWorkflowStage(step.id, workflowStatusFromStep(step));
            }
            break;
          case "acceptance_report":
            setAcceptanceReport(ev.report as Parameters<typeof setAcceptanceReport>[0]);
            break;
          case "done":
            if (writingFlowRef.current) updateWorkflowStage("done", "done");
            finishStream();
            setAutoStatus(null);
            handleRef.current = null;
            // 如果是写作流程,通知编辑器刷新章节列表
            if (writingFlowRef.current) {
              appendSystemMessage("本章已完成,请在右侧编辑器查看。");
              triggerChapterRefresh();
            }
            break;
          case "error":
            setError(String(ev.message ?? t.errors.unknown), String(ev.errorClass ?? "unknown"));
            setAutoStatus(null);
            handleRef.current = null;
            break;
          default:
            break; // usage 等忽略
        }
      },
    });
  }, [props.bookId, endpoint, streamFn, streaming, executionMode, pendingConfirmation, appendUserMessage, appendSystemMessage, beginStream, appendDelta, appendReasoning, pushToolEvent, setWorkflowStages, startWorkflow, updateWorkflowStage, setSuppressText, finishStream, setError, clearError, setAutoStatus, triggerChapterRefresh, triggerLibraryRefresh, setPendingConfirmation, upsertExecutionStep, setAcceptanceReport]);

  const cancel = useCallback(() => {
    if (autoStatus) {
      // 自动模式:通知 server abort(完成当前章后停)
      void fetch(`/api/books/${encodeURIComponent(props.bookId)}/auto/cancel`, { method: "POST" });
      return;
    }
    handleRef.current?.cancel();
    handleRef.current = null;
    finishStream(); // 已收到的部分固化
  }, [finishStream, autoStatus, props.bookId]);

  const retry = useCallback(() => {
    clearError();
    if (lastSent) send(lastSent);
  }, [lastSent, send, clearError]);

  return (
    <div data-testid="conversation-pane" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {autoStatus && (
        <div
          data-testid="auto-mode-bar"
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "6px 12px", background: "#fff7e6", borderBottom: "1px solid #ffe7ba",
            fontSize: 13,
          }}
        >
          <span>
            {t.workspace.autoMode}:{autoStatus.doneCount}/{autoStatus.total} 章
            {autoStatus.currentChapter != null ? ` · 正在写第 ${autoStatus.currentChapter} 章` : ""}
          </span>
          <button data-testid="auto-stop" style={{ fontSize: 12 }} onClick={cancel}>
            {t.workspace.stopAuto}
          </button>
        </div>
      )}
      <div ref={scrollRef} style={{ flex: 1, overflow: "auto", padding: 12 }}>
        {messages.map(m => <Message key={m.id} m={m} />)}
        {streaming && <StreamingMessage state={streaming} />}
      </div>
      {error && (
        <div
          role="alert"
          data-testid="conversation-error"
          style={{
            margin: "0 12px 8px",
            padding: "8px 12px",
            background: "#fff2f0",
            border: "1px solid #ffccc7",
            borderRadius: 6,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span style={{ color: "#c00" }}>{error.message}</span>
          <button data-testid="btn-retry" onClick={retry}>{t.common.retry}</button>
        </div>
      )}
      {pendingConfirmation && (
        <ExecutionConfirmationCard
          taskId={pendingConfirmation.taskId}
          message={pendingConfirmation.message}
          policy={pendingConfirmation.policy}
          onApprove={() => {
            const approved = lastSent;
            setPendingConfirmation(null);
            if (approved) send(approved, { executionModeOverride: "trusted_auto", appendUser: false });
          }}
          onReroll={() => {
            setPendingConfirmation(null);
            if (lastSent) send(lastSent, { appendUser: false });
          }}
          onCancel={() => setPendingConfirmation(null)}
        />
      )}
      <Composer onSend={send} onCancel={cancel} streaming={!!streaming} />
    </div>
  );
}

function Composer(props: { onSend: (text: string, options?: SendOptions) => void; onCancel: () => void; streaming: boolean }) {
  const [value, setValue] = useState("");
  const [slashOpen, setSlashOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);

  const submit = () => {
    if (!value.trim()) return;
    props.onSend(value);
    setValue("");
    setSlashOpen(false);
  };

  const pickSlash = (alias: string) => {
    // 替换第一个 token 为补全的 alias
    const rest = value.includes(" ") ? value.slice(value.indexOf(" ")) : "";
    setValue(alias + (rest || " "));
    setSlashOpen(false);
  };

  const runAssetAudit = (option: typeof ASSET_AUDIT_OPTIONS[number]) => {
    setAuditOpen(false);
    props.onSend(buildAssetAuditRequest(option.scope), { displayContent: `已触发主动审查：${option.label}` });
  };

  return (
    <div style={{ borderTop: "1px solid #e5e5e5", padding: 12, position: "relative" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, gap: 8 }}>
        <div style={{ position: "relative" }}>
          <button
            type="button"
            className="ios-btn-small"
            data-testid="btn-asset-audit"
            disabled={props.streaming}
            onClick={() => setAuditOpen(v => !v)}
          >
            主动审查
          </button>
          {auditOpen && (
            <div
              data-testid="asset-audit-menu"
              style={{
                position: "absolute",
                left: 0,
                bottom: "calc(100% + 6px)",
                zIndex: 20,
                minWidth: 180,
                padding: 6,
                border: "1px solid #d8d8df",
                borderRadius: 8,
                background: "#fff",
                boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                display: "grid",
                gap: 4,
              }}
            >
              {ASSET_AUDIT_OPTIONS.map(option => (
                <button
                  key={option.id}
                  type="button"
                  data-testid={`asset-audit-option-${option.id}`}
                  onClick={() => runAssetAudit(option)}
                  style={{
                    border: 0,
                    background: "transparent",
                    textAlign: "left",
                    padding: "7px 9px",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: 13,
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <ExecutionModeSelector />
      </div>
      <SlashSuggestions
        input={value}
        visible={slashOpen}
        onPick={pickSlash}
        onClose={() => setSlashOpen(false)}
      />
      <textarea
        data-testid="composer-input"
        value={value}
        placeholder={t.conversation.placeholder}
        rows={3}
        style={{ width: "100%", resize: "vertical", padding: 8, borderRadius: 6, border: "1px solid #d0d0d0" }}
        onChange={(e) => {
          const v = e.target.value;
          setValue(v);
          setSlashOpen(v.startsWith("/") && !v.includes("\n"));
        }}
        onKeyDown={(e) => {
          if (slashOpen && ["ArrowDown", "ArrowUp", "Tab", "Enter", "Escape"].includes(e.key)) {
            // 弹层打开时这些键交给 SlashSuggestions 的全局监听处理
            if (e.key === "Enter" || e.key === "Tab") e.preventDefault();
            return;
          }
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape" && props.streaming) {
            e.preventDefault();
            props.onCancel();
          }
        }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
        <span style={{ fontSize: 12, color: "#999" }}>{t.conversation.slashHint}</span>
        <div style={{ display: "flex", gap: 8 }}>
          {props.streaming && (
            <button data-testid="btn-cancel-stream" onClick={props.onCancel}>
              {t.conversation.cancelStream}
            </button>
          )}
          <button className="ios-btn-primary" data-testid="btn-send" onClick={submit} disabled={props.streaming || !value.trim()}>
            {t.conversation.sendButton}
          </button>
        </div>
      </div>
    </div>
  );
}
