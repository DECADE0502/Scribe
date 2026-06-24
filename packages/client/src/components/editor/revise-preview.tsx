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

type Phase = "streaming" | "ready" | "error";

export function RevisePreview(props: RevisePreviewProps) {
  const streamFn = props.streamFn ?? startSseStream;
  const [candidate, setCandidate] = useState("");
  const [statusText, setStatusText] = useState("");
  const [phase, setPhase] = useState<Phase>("streaming");
  const [validationPass, setValidationPass] = useState(false);
  const [needsDecision, setNeedsDecision] = useState(false);
  const [error, setErrorMsg] = useState<string | null>(null);
  const handleRef = useRef<SseStreamHandle | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    handleRef.current = streamFn({
      url: `/api/books/${encodeURIComponent(props.bookId)}/agent/run`,
      body: {
        message: props.instruction || "revise selected text",
        source: "revision",
        target: {
          revisionRange: {
            chapterNo: props.chapterNo,
            selectedText: props.segmentText,
          },
        },
      },
      onEvent: (ev) => {
        if (ev.type === "main_output") {
          const draft = String(ev.draft ?? "");
          const reply = String(ev.reply ?? "");
          if (draft) setCandidate(draft);
          if (reply) setStatusText(reply);
        } else if (ev.type === "validation_report") {
          const verdict = String(ev.verdict ?? "");
          setValidationPass(verdict === "pass");
          setStatusText(`验收:${verdict}`);
        } else if (ev.type === "done") {
          setNeedsDecision(ev.needsUserDecision === true);
          setPhase("ready");
        } else if (ev.type === "error") {
          setErrorMsg(String(ev.message ?? t.errors.unknown));
          setPhase("error");
        }
      },
    });
    return () => { handleRef.current?.cancel(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canAccept = phase === "ready" && Boolean(candidate.trim()) && validationPass && needsDecision;

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
        {t.editor.revise}{phase === "streaming" ? "(生成中...)" : ""}
      </div>
      {statusText && (
        <div data-testid="revise-status" style={{ color: "#667", fontSize: 12, marginBottom: 6 }}>
          {statusText}
        </div>
      )}
      <div data-testid="revise-text" style={{ whiteSpace: "pre-wrap", marginBottom: 8 }}>
        {candidate || <span style={{ color: "#999" }}>{t.conversation.aiThinking}</span>}
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
          disabled={!canAccept}
          onClick={() => {
            props.onAccepted(candidate);
            props.onDismiss();
          }}
        >
          {t.audit.accept}
        </button>
      </div>
    </div>
  );
}
