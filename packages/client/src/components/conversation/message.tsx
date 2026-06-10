import type { ChatMessage } from "../../stores/conversation.js";
import { t } from "../../i18n/zh-CN.js";

export function Message(props: { m: ChatMessage }) {
  const { m } = props;
  const isUser = m.role === "user";
  const isSystem = m.role === "system";
  return (
    <div
      data-testid={`msg-${m.id}`}
      data-role={m.role}
      style={{
        display: "flex",
        justifyContent: isUser ? "flex-end" : "flex-start",
        margin: "8px 0",
      }}
    >
      <div
        style={{
          maxWidth: "85%",
          padding: "8px 12px",
          borderRadius: 8,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          background: isUser ? "#daf0ff" : isSystem ? "#f5f5f5" : "#fff",
          border: isSystem ? "1px dashed #ccc" : "1px solid #e5e5e5",
          color: isSystem ? "#888" : "#222",
          fontSize: isSystem ? 12 : 14,
        }}
      >
        {m.toolEvents && m.toolEvents.length > 0 && (
          <div style={{ marginBottom: 6 }}>
            {m.toolEvents.filter(ev => ev.kind === "end").map((ev, i) => (
              <span
                key={i}
                data-testid="tool-chip"
                style={{
                  display: "inline-block",
                  fontSize: 12,
                  color: "#555",
                  background: "#eef",
                  borderRadius: 4,
                  padding: "1px 6px",
                  marginRight: 4,
                }}
              >
                {t.conversation.toolCalled}:{ev.toolName}
              </span>
            ))}
          </div>
        )}
        {m.content}
        {m.error && (
          <div role="alert" style={{ color: "#c00", fontSize: 12, marginTop: 6 }}>
            {m.error.message}
          </div>
        )}
      </div>
    </div>
  );
}
