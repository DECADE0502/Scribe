import { useCallback, useEffect, useRef, useState } from "react";
import { parseSlashCommand } from "@scribe/shared";
import { t } from "../../i18n/zh-CN.js";
import { useConversationStore, type ChatMessage } from "../../stores/conversation.js";
import { startSseStream, type SseStreamHandle, type StartStreamOptions } from "../../api/streaming.js";
import { Message } from "./message.js";
import { StreamingMessage } from "./streaming-message.js";
import { SlashSuggestions } from "./slash-suggestions.js";

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

export interface ConversationPaneProps {
  bookId: string;
  endpoint?: (bookId: string) => string;
  streamFn?: StreamFn;
}

let streamSeq = 0;

export function ConversationPane(props: ConversationPaneProps) {
  const endpoint = props.endpoint ?? ((id: string) => `/api/books/${encodeURIComponent(id)}/conversation?mode=chat`);
  const streamFn = props.streamFn ?? startSseStream;
  const {
    messages, streaming, error, autoStatus,
    appendUserMessage, appendSystemMessage, beginStream, appendDelta, appendReasoning,
    pushToolEvent, setWorkflowStages, updateWorkflowStage, setSuppressText,
    finishStream, setError, clearError, setAutoStatus,
    triggerChapterRefresh, hydrate,
  } = useConversationStore();
  const handleRef = useRef<SseStreamHandle | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [lastSent, setLastSent] = useState<string | null>(null);
  /** 追踪本次流是否是写作流程 */
  const writingFlowRef = useRef(false);

  // 加载持久化对话历史（首次挂载或 bookId 变化时）
  useEffect(() => {
    let cancelled = false;
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
  }, [props.bookId, hydrate]);

  // 自动滚到底
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming?.text]);

  const send = useCallback((text: string) => {
    const content = text.trim();
    if (!content || streaming) return;
    clearError();
    setLastSent(content);
    appendUserMessage(content);
    writingFlowRef.current = false;

    // /auto N → 自动模式端点
    const parsed = parseSlashCommand(content);
    const isAuto = parsed.kind === "command" && parsed.id === "auto";
    const autoTotal = isAuto ? Math.max(1, Number(parsed.kind === "command" ? parsed.args : "") || 1) : 0;
    const url = isAuto
      ? `/api/books/${encodeURIComponent(props.bookId)}/auto`
      : endpoint(props.bookId);
    const body = isAuto ? { n: autoTotal } : { message: content };
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
              setWorkflowStages(WRITING_STAGES);
              updateWorkflowStage(toolName, "active");
            }
            // 人类可读进度提示
            const label = TOOL_LABELS[toolName];
            if (label) appendSystemMessage(label);
            break;
          }
          case "tool_call_end": {
            const toolName = String(ev.toolName ?? "");
            pushToolEvent({ kind: "end", toolName, payload: ev.result });
            if (WRITING_TOOLS.has(toolName)) updateWorkflowStage(toolName, "done");
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
  }, [props.bookId, endpoint, streamFn, streaming, appendUserMessage, appendSystemMessage, beginStream, appendDelta, appendReasoning, pushToolEvent, setWorkflowStages, updateWorkflowStage, setSuppressText, finishStream, setError, clearError, setAutoStatus, triggerChapterRefresh]);

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
      <Composer onSend={send} onCancel={cancel} streaming={!!streaming} />
    </div>
  );
}

function Composer(props: { onSend: (text: string) => void; onCancel: () => void; streaming: boolean }) {
  const [value, setValue] = useState("");
  const [slashOpen, setSlashOpen] = useState(false);

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

  return (
    <div style={{ borderTop: "1px solid #e5e5e5", padding: 12, position: "relative" }}>
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
