import { useEffect, useRef, useState } from "react";
import { t } from "../../i18n/zh-CN.js";
import { startSseStream, type SseStreamHandle, type StartStreamOptions } from "../../api/streaming.js";

export type StreamFn = (opts: StartStreamOptions) => SseStreamHandle;

export interface RevisePreviewProps {
  bookId: string;
  chapterNo: number;
  segmentText: string;
  instruction: string;
  onAccepted: (newContent: string) => void;
  onDismiss: () => void;
  streamFn?: StreamFn;
  fetchFn?: typeof fetch;
}

type Phase = "streaming" | "ready" | "applying" | "error";

export function RevisePreview(props: RevisePreviewProps) {
  const streamFn = props.streamFn ?? startSseStream;
  const fetchFn = props.fetchFn ?? fetch;
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>("streaming");
  const [error, setErrorMsg] = useState<string | null>(null);
  const handleRef = useRef<SseStreamHandle | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return; // StrictMode 双调用保护
    startedRef.current = true;
    handleRef.current = streamFn({
      url: `/api/books/${encodeURIComponent(props.bookId)}/chapters/${props.chapterNo}/revise-segment`,
      body: { segmentText: props.segmentText, instruction: props.instruction },
      onEvent: (ev) => {
        if (ev.type === "text_delta") setText(prev => prev + String(ev.delta ?? ""));
        else if (ev.type === "done") setPhase("ready");
        else if (ev.type === "error") {
          setErrorMsg(String(ev.message ?? t.errors.unknown));
          setPhase("error");
        }
      },
    });
    return () => { handleRef.current?.cancel(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const accept = async () => {
    setPhase("applying");
    try {
      const res = await fetchFn(
        `/api/books/${encodeURIComponent(props.bookId)}/chapters/${props.chapterNo}/apply-revision`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ segmentText: props.segmentText, newSegment: text }),
        },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const j = await res.json() as { content: string };
      props.onAccepted(j.content);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  };

  return (
    <div
      data-testid="revise-preview"
      style={{
        borderTop: "2px solid #cfe3ff",
        background: "#f7fbff",
        padding: 12,
        maxHeight: "40%",
        overflow: "auto",
      }}
    >
      <div style={{ fontSize: 12, color: "#557", marginBottom: 6 }}>
        📍 {t.editor.revise}{phase === "streaming" ? "(生成中...)" : ""}
      </div>
      <div data-testid="revise-text" style={{ whiteSpace: "pre-wrap", marginBottom: 8 }}>
        {text || <span style={{ color: "#999" }}>{t.conversation.aiThinking}</span>}
      </div>
      {error && (
        <div role="alert" style={{ color: "#c00", fontSize: 12, marginBottom: 8 }}>{error}</div>
      )}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button data-testid="revise-dismiss" onClick={() => { handleRef.current?.cancel(); props.onDismiss(); }}>
          {t.common.cancel}
        </button>
        <button
          data-testid="revise-accept"
          disabled={phase !== "ready" || !text.trim()}
          onClick={accept}
        >
          {t.audit.accept}
        </button>
      </div>
    </div>
  );
}
