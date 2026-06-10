import type { StreamingState } from "../../stores/conversation.js";
import { t } from "../../i18n/zh-CN.js";

export function StreamingMessage(props: { state: StreamingState }) {
  const { state } = props;
  const pendingTools = collectPendingTools(state);
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
        {pendingTools.map((name, i) => (
          <div key={i} data-testid="tool-running" style={{ fontSize: 12, color: "#557" }}>
            ⏳ {t.conversation.toolCalled}:{name}...
          </div>
        ))}
        {state.text
          ? state.text
          : <span data-testid="streaming-placeholder" style={{ color: "#999" }}>{t.conversation.aiThinking}</span>}
        <span data-testid="streaming-cursor" style={{ opacity: 0.6 }}>▌</span>
      </div>
    </div>
  );
}

/** 已 start 但还没 end 的工具 */
function collectPendingTools(state: StreamingState): string[] {
  const started: string[] = [];
  for (const ev of state.toolEvents) {
    if (ev.kind === "start") started.push(ev.toolName);
    else {
      const idx = started.indexOf(ev.toolName);
      if (idx !== -1) started.splice(idx, 1);
    }
  }
  return started;
}
