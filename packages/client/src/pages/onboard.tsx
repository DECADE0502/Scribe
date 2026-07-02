import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { t } from "../i18n/zh-CN.js";
import { startSseStream, type SseStreamHandle } from "../api/streaming.js";

interface Msg {
  role: "user" | "assistant" | "system";
  content: string;
}

const INTRO =
  "我们用对话把这本书的底子搭起来吧。您可以直接说想写什么，题材、主角、大概的故事走向都行。小克会边聊边整理设定,自动写进世界书、角色和大纲。";

export function OnboardPage() {
  const { bookId = "" } = useParams();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Msg[]>([{ role: "system", content: INTRO }]);
  const [streamingText, setStreamingText] = useState("");
  const [status, setStatus] = useState<{ ok: boolean; missing: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const handleRef = useRef<SseStreamHandle | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/books/${encodeURIComponent(bookId)}/onboard-status`);
      if (res.ok) setStatus(await res.json());
    } catch {
      // Status is advisory; the chat can still proceed.
    }
  }, [bookId]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streamingText]);

  useEffect(() => () => handleRef.current?.cancel(), []);

  const finishRun = useCallback((buf: string) => {
    if (buf.trim()) {
      setMessages((prev) => [...prev, { role: "assistant", content: buf }]);
    }
    setStreamingText("");
    setBusy(false);
    handleRef.current = null;
    void refreshStatus();
  }, [refreshStatus]);

  const send = useCallback((text: string) => {
    const content = text.trim();
    if (!content || busy) return;

    setError(null);
    setMessages((prev) => [...prev, { role: "user", content }]);
    setStreamingText("");
    setBusy(true);

    let buf = "";
    handleRef.current = startSseStream({
      url: `/api/books/${encodeURIComponent(bookId)}/agent/run`,
      body: {
        message: content,
        source: "onboard",
      },
      onEvent: (ev) => {
        switch (ev.type) {
          case "text_delta": {
            const delta = String(ev.delta ?? "");
            if (delta) {
              buf += delta;
              setStreamingText(buf);
            }
            break;
          }
          case "done":
            finishRun(buf);
            break;
          case "error":
            if (buf.trim()) setMessages((prev) => [...prev, { role: "assistant", content: buf }]);
            setStreamingText("");
            setError(String(ev.message ?? t.errors.unknown));
            setBusy(false);
            handleRef.current = null;
            break;
          default:
            break;
        }
      },
    });
  }, [bookId, busy, finishRun]);

  const skip = useCallback(async () => {
    await fetch(`/api/books/${encodeURIComponent(bookId)}/onboard/skip`, { method: "POST" }).catch(() => {});
    navigate(`/books/${encodeURIComponent(bookId)}`);
  }, [bookId, navigate]);

  return (
    <main data-testid="page-onboard" style={{ display: "flex", flexDirection: "column", height: "100vh", maxWidth: 760, margin: "0 auto" }}>
      <header className="nav-bar" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px" }}>
        <button className="ios-btn-small" onClick={() => navigate("/library")}>‹ {t.common.back}</button>
        <h1 className="large-title" style={{ fontSize: 22, flex: 1 }}>新建书 · 对话搭设定</h1>
        <button className="ios-btn-small" data-testid="onboard-skip" onClick={() => void skip()}>跳过</button>
      </header>

      {status && (
        <div
          data-testid="onboard-status"
          style={{
            padding: "8px 16px",
            fontSize: 13,
            background: status.ok ? "#e8f7ec" : "#fff7e6",
            borderBottom: "1px solid var(--ios-separator, #e5e5e5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span>
            {status.ok ? "基础设定已齐，可以开始写第一章" : `还差:${status.missing.join("、") || "无"}`}
          </span>
          {status.ok && (
            <button
              className="ios-btn-primary"
              data-testid="onboard-start"
              style={{ padding: "4px 14px", fontSize: 13 }}
              onClick={() => navigate(`/books/${encodeURIComponent(bookId)}`)}
            >
              进入工作台
            </button>
          )}
        </div>
      )}

      <div ref={scrollRef} style={{ flex: 1, overflow: "auto", padding: 16 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start", marginBottom: 10 }}>
            <div
              className={m.role === "user" ? "bubble bubble-user" : "bubble bubble-assistant"}
              style={{
                maxWidth: "78%",
                padding: "9px 13px",
                borderRadius: 16,
                whiteSpace: "pre-wrap",
                lineHeight: 1.5,
                background: m.role === "user" ? "var(--ios-blue, #007AFF)" : m.role === "system" ? "#f0f0f3" : "#fff",
                color: m.role === "user" ? "#fff" : "#1c1c1e",
                border: m.role === "assistant" ? "1px solid #ececf0" : "none",
                fontSize: m.role === "system" ? 13 : 15,
              }}
            >
              {m.content}
            </div>
          </div>
        ))}

        {streamingText && (
          <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 10 }}>
            <div className="bubble bubble-assistant" style={{ maxWidth: "78%", padding: "9px 13px", borderRadius: 16, whiteSpace: "pre-wrap", lineHeight: 1.5, background: "#fff", border: "1px solid #ececf0", fontSize: 15 }}>
              {streamingText}
              <span className="typing-caret" aria-hidden />
            </div>
          </div>
        )}

        {busy && !streamingText && (
          <div data-testid="onboard-thinking" style={{ display: "flex", justifyContent: "flex-start", marginBottom: 10 }}>
            <div className="bubble bubble-assistant" style={{ padding: "11px 14px", borderRadius: 16, background: "#fff", border: "1px solid #ececf0", display: "flex", alignItems: "center", gap: 9 }}>
              <span className="typing-dots" aria-hidden><span /><span /><span /></span>
              <span style={{ fontSize: 13, color: "#8a8a8e" }}>AI 正在思考</span>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div role="alert" style={{ margin: "0 16px 8px", padding: "8px 12px", background: "#fff2f0", border: "1px solid #ffccc7", borderRadius: 8, color: "#c00", fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ borderTop: "1px solid var(--ios-separator, #e5e5e5)", padding: 12 }}>
        <textarea
          data-testid="onboard-input"
          value={input}
          rows={2}
          placeholder="说说您想写的故事… Ctrl/⌘ + Enter 发送"
          style={{ width: "100%", resize: "vertical", padding: 8, borderRadius: 8, border: "1px solid #d0d0d0", fontSize: 15 }}
          disabled={busy}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
              e.preventDefault();
              send(input);
              setInput("");
            }
          }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
          <button
            className="ios-btn-primary"
            data-testid="onboard-send"
            disabled={busy || !input.trim()}
            onClick={() => {
              send(input);
              setInput("");
            }}
          >
            {busy ? t.app.loading : t.conversation.sendButton}
          </button>
        </div>
      </div>
    </main>
  );
}
