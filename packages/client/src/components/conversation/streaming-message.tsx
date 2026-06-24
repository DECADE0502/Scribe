import { useEffect, useState } from "react";
import type { StreamingState } from "../../stores/conversation.js";
import { useConversationStore } from "../../stores/conversation.js";
import { t } from "../../i18n/zh-CN.js";

export function StreamingMessage(props: { state: StreamingState }) {
  const { state } = props;
  const acceptanceReport = useConversationStore(s => s.acceptanceReport);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(timer);
  }, [state.id]);

  const hasWorkflow = state.workflowStages.length > 0;

  return (
    <div data-testid="streaming-message" style={{ margin: "8px 0" }}>
      <div
        style={{
          maxWidth: "85%",
          padding: "8px 12px",
          borderRadius: 8,
          border: "1px solid #cfe3ff",
          background: "#f7fbff",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {hasWorkflow && <WorkflowProgress stages={state.workflowStages} />}
        {acceptanceReport && (
          <div data-testid="validation-report" style={{ marginTop: 8, marginBottom: 8, fontSize: 12, color: "#445" }}>
            验收:{acceptanceReport.verdict}
          </div>
        )}
        {state.text && (
          <>
            {state.text}
            <span data-testid="streaming-cursor" style={{ opacity: 0.6 }}>▌</span>
          </>
        )}
        {!state.text && !hasWorkflow && (
          <span data-testid="streaming-placeholder" style={{ color: "#999" }}>
            {elapsed > 5 ? "AI 正在思考中,请稍候..." : t.conversation.aiThinking}
          </span>
        )}
        {!state.text && hasWorkflow && (
          <span style={{ color: "#999", fontSize: 13 }}>处理中...</span>
        )}
      </div>
    </div>
  );
}

function WorkflowProgress(props: { stages: StreamingState["workflowStages"] }) {
  return (
    <div data-testid="workflow-progress" style={{ display: "grid", gap: 6, marginBottom: 8 }}>
      {props.stages.map((stage) => {
        const color = stage.status === "done"
          ? "#34c759"
          : stage.status === "active"
            ? "var(--ios-blue)"
            : stage.status === "error"
              ? "var(--ios-red)"
              : "#a8a8a8";
        const mark = stage.status === "done" ? "✓" : stage.status === "active" ? "●" : stage.status === "error" ? "×" : "○";
        return (
          <div
            key={stage.id}
            data-testid={`workflow-stage-${stage.id}`}
            style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color }}
          >
            <span style={{ width: 14, display: "inline-block", textAlign: "center" }}>{mark}</span>
            <span>{stage.label}</span>
          </div>
        );
      })}
    </div>
  );
}
