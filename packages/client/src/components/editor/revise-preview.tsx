import { useEffect, useRef, useState } from "react";
import { t } from "../../i18n/zh-CN.js";
import { startSseStream, type SseStreamHandle, type StartStreamOptions } from "../../api/streaming.js";

export type StreamFn = (opts: StartStreamOptions) => SseStreamHandle;

export interface RevisePreviewProps {
  bookId: string;
  chapterNo: number;
  segmentText: string;
  instruction: string;
  /** 服务端已完成段落替换并落库,通知父组件重载章节内容。 */
  onApplied: () => void;
  onDismiss: () => void;
  streamFn?: StreamFn;
}

type Phase = "streaming" | "applied" | "failed";

/**
 * 局部改写预览:新段落流式展示;done.committed=true 表示服务端已把
 * 合并后的整章落库(revise 任务在 apply 里完成替换),前端点"刷新显示"
 * 让编辑器重载,不再由前端拼接/回写。中途取消会 abort 请求,服务端
 * 的 LLM 调用随 abortSignal 终止,不会落库。
 */
export function RevisePreview(props: RevisePreviewProps) {
  const streamFn = props.streamFn ?? startSseStream;
  const [candidate, setCandidate] = useState("");
  const [phase, setPhase] = useState<Phase>("streaming");
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
        if (ev.type === "text_delta") {
          const delta = String(ev.delta ?? "");
          if (delta) setCandidate(prev => prev + delta);
        } else if (ev.type === "done") {
          setPhase(ev.committed === true ? "applied" : "failed");
        } else if (ev.type === "error") {
          setErrorMsg(String(ev.message ?? t.errors.unknown));
          setPhase("failed");
        }
      },
    });
    return () => { handleRef.current?.cancel(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        {t.editor.revise}
        {phase === "streaming" ? "(生成中...)" : phase === "applied" ? "(已提交,章节已更新)" : ""}
      </div>
      <div data-testid="revise-text" style={{ whiteSpace: "pre-wrap", marginBottom: 8 }}>
        {candidate || <span style={{ color: "#999" }}>{t.conversation.aiThinking}</span>}
      </div>
      {error && (
        <div role="alert" style={{ color: "#c00", fontSize: 12, marginBottom: 8 }}>{error}</div>
      )}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button data-testid="revise-dismiss" onClick={() => { handleRef.current?.cancel(); props.onDismiss(); }}>
          {phase === "applied" ? t.common.close ?? "关闭" : t.common.cancel}
        </button>
        {phase === "applied" && (
          <button
            data-testid="revise-accept"
            className="ios-btn-primary"
            onClick={() => props.onApplied()}
          >
            刷新显示
          </button>
        )}
      </div>
    </div>
  );
}
