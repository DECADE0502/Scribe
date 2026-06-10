import { useCallback, useEffect, useRef, useState } from "react";
import { parseSlashCommand } from "@scribe/shared";
import { t } from "../../i18n/zh-CN.js";
import { useConversationStore } from "../../stores/conversation.js";
import { startSseStream, type SseStreamHandle, type StartStreamOptions } from "../../api/streaming.js";
import { Message } from "./message.js";
import { StreamingMessage } from "./streaming-message.js";
import { SlashSuggestions } from "./slash-suggestions.js";

export type StreamFn = (opts: StartStreamOptions) => SseStreamHandle;

export interface ConversationPaneProps {
  bookId: string;
  /** 流式端点;默认普通对话,onboard 页可覆盖 */
  endpoint?: (bookId: string) => string;
  /** 测试注入用 */
  streamFn?: StreamFn;
}

let streamSeq = 0;

export function ConversationPane(props: ConversationPaneProps) {
  const endpoint = props.endpoint ?? ((id: string) => `/api/books/${encodeURIComponent(id)}/conversation?mode=chat`);
  const streamFn = props.streamFn ?? startSseStream;
  const {
    messages, streaming, error, autoStatus,
    appendUserMessage, appendSystemMessage, beginStream, appendDelta, appendReasoning,
    pushToolEvent, finishStream, setError, clearError, setAutoStatus,
  } = useConversationStore();
  const handleRef = useRef<SseStreamHandle | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [lastSent, setLastSent] = useState<string | null>(null);

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
          case "tool_call_start":
            pushToolEvent({ kind: "start", toolName: String(ev.toolName ?? "") });
            break;
          case "tool_call_end":
            pushToolEvent({ kind: "end", toolName: String(ev.toolName ?? ""), payload: ev.result });
            break;
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
            finishStream();
            setAutoStatus(null);
            handleRef.current = null;
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
  }, [props.bookId, endpoint, streamFn, streaming, appendUserMessage, appendSystemMessage, beginStream, appendDelta, appendReasoning, pushToolEvent, finishStream, setError, clearError, setAutoStatus]);

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
          <button data-testid="btn-send" onClick={submit} disabled={props.streaming || !value.trim()}>
            {t.conversation.sendButton}
          </button>
        </div>
      </div>
    </div>
  );
}
