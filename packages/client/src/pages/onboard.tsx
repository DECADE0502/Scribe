import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { t } from "../i18n/zh-CN.js";
import { startSseStream, type SseStreamHandle } from "../api/streaming.js";

interface Msg { role: "user" | "assistant" | "system"; content: string }
interface ToolChip { id: number; toolName: string; done: boolean }

const INTRO =
  "我们用对话把这本书的底子搭起来吧。你可以直接说想写什么——题材、主角、大概的故事走向都行,想到哪说到哪。我会一边聊一边把设定记到右边的资料库里。";

export function OnboardPage() {
  const { bookId = "" } = useParams();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Msg[]>([{ role: "system", content: INTRO }]);
  const [streamingText, setStreamingText] = useState("");
  const [tools, setTools] = useState<ToolChip[]>([]);
  const [status, setStatus] = useState<{ ok: boolean; missing: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const handleRef = useRef<SseStreamHandle | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const toolSeq = useRef(0);

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/books/${encodeURIComponent(bookId)}/onboard-status`);
      if (res.ok) setStatus(await res.json());
    } catch { /* 忽略 */ }
  }, [bookId]);

  useEffect(() => { void refreshStatus(); }, [refreshStatus]);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streamingText, tools]);

  const send = useCallback((text: string) => {
    const content = text.trim();
    if (!content || busy) return;
    setError(null);
    // 仅把真实对话(user/assistant)作为 history 传给后端
    const history = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, { role: "user", content }]);
    setStreamingText("");
    setTools([]);
    setBusy(true);

    let buf = "";
    handleRef.current = startSseStream({
      url: `/api/books/${encodeURIComponent(bookId)}/onboard`,
      body: { message: content, history },
      onEvent: (ev) => {
        switch (ev.type) {
          case "text_delta":
            buf += String(ev.delta ?? "");
            setStreamingText(buf);
            break;
          case "tool_call_start":
            toolSeq.current += 1;
            setTools((prev) => [...prev, { id: toolSeq.current, toolName: String(ev.toolName ?? ""), done: false }]);
            break;
          case "tool_call_end":
            setTools((prev) => {
              const i = [...prev].reverse().find((x) => x.toolName === String(ev.toolName ?? "") && !x.done);
              return prev.map((x) => (i && x.id === i.id ? { ...x, done: true } : x));
            });
            break;
          case "done":
            if (buf.trim()) setMessages((prev) => [...prev, { role: "assistant", content: buf }]);
            setStreamingText("");
            setBusy(false);
            handleRef.current = null;
            void refreshStatus();
            break;
          case "error":
            // 固化已收到的部分内容为一条消息,清空流式气泡,避免半截 bubble 滞留
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
  }, [bookId, busy, messages, refreshStatus]);

  const skip = useCallback(async () => {
    await fetch(`/api/books/${encodeURIComponent(bookId)}/onboard/skip`, { method: "POST" }).catch(() => {});
    navigate(`/books/${encodeURIComponent(bookId)}`);
  }, [bookId, navigate]);

  const toolLabel = (name: string) => {
    const map: Record<string, string> = {
      set_book_meta: "记录书籍设定",
      create_character: "创建角色",
      update_character: "更新角色",
      create_outline_node: "添加大纲",
      update_outline_node: "更新大纲",
      set_rules_md: "更新写作规则",
      create_genre_section: "创建题材板块",
      add_genre_section_item: "添加资料条目",
      update_genre_section_schema: "调整板块结构",
    };
    return map[name] ?? name;
  };

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
            padding: "8px 16px", fontSize: 13,
            background: status.ok ? "#e8f7ec" : "#fff7e6",
            borderBottom: "1px solid var(--ios-separator, #e5e5e5)",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}
        >
          <span>
            {status.ok ? "✅ 基础设定齐了,可以开始写第一章" : `还差:${status.missing.join("、") || "—"}`}
          </span>
          {status.ok && (
            <button className="ios-btn-primary" data-testid="onboard-start" style={{ padding: "4px 14px", fontSize: 13 }}
              onClick={() => navigate(`/books/${encodeURIComponent(bookId)}`)}>
              进入工作台 ›
            </button>
          )}
        </div>
      )}

      <div ref={scrollRef} style={{ flex: 1, overflow: "auto", padding: 16 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start", marginBottom: 10 }}>
            <div className={m.role === "user" ? "bubble bubble-user" : "bubble bubble-assistant"}
              style={{
                maxWidth: "78%", padding: "9px 13px", borderRadius: 16, whiteSpace: "pre-wrap", lineHeight: 1.5,
                background: m.role === "user" ? "var(--ios-blue, #007AFF)" : m.role === "system" ? "#f0f0f3" : "#fff",
                color: m.role === "user" ? "#fff" : "#1c1c1e",
                border: m.role === "assistant" ? "1px solid #ececf0" : "none",
                fontSize: m.role === "system" ? 13 : 15,
              }}>
              {m.content}
            </div>
          </div>
        ))}
        {tools.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "4px 0 10px" }}>
            {tools.map((tc) => (
              <span key={tc.id} data-testid="onboard-tool-chip" style={{
                fontSize: 12, padding: "3px 9px", borderRadius: 12,
                background: tc.done ? "#e8f7ec" : "#eef1ff", color: "#444",
              }}>
                {tc.done ? "✓ " : "⋯ "}{toolLabel(tc.toolName)}
              </span>
            ))}
          </div>
        )}
        {streamingText && (
          <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 10 }}>
            <div className="bubble bubble-assistant" style={{ maxWidth: "78%", padding: "9px 13px", borderRadius: 16, whiteSpace: "pre-wrap", lineHeight: 1.5, background: "#fff", border: "1px solid #ececf0", fontSize: 15 }}>
              {streamingText}
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
          placeholder="说说你想写的故事…(Ctrl/⌘ + Enter 发送)"
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
          <button className="ios-btn-primary" data-testid="onboard-send" disabled={busy || !input.trim()}
            onClick={() => { send(input); setInput(""); }}>
            {busy ? t.app.loading : t.conversation.sendButton}
          </button>
        </div>
      </div>
    </main>
  );
}
