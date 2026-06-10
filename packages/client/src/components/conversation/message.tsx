import type { ChatMessage } from "../../stores/conversation.js";
import { t } from "../../i18n/zh-CN.js";

export function Message(props: { m: ChatMessage }) {
  const { m } = props;
  const isUser = m.role === "user";
  const isSystem = m.role === "system";

  if (isSystem) {
    return (
      <div data-testid={`msg-${m.id}`} data-role="system" className="bubble-system fade-up" style={{ margin: "10px 0" }}>
        {m.content}
      </div>
    );
  }

  return (
    <div
      data-testid={`msg-${m.id}`}
      data-role={m.role}
      className="fade-up"
      style={{
        display: "flex",
        justifyContent: isUser ? "flex-end" : "flex-start",
        margin: "8px 0",
      }}
    >
      <div
        className={isUser ? "bubble-user" : "bubble-ai"}
        style={{
          maxWidth: "85%",
          padding: "9px 14px",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          fontSize: 14,
          lineHeight: 1.6,
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
                  fontSize: 11,
                  color: "var(--ios-blue)",
                  background: "rgba(0,122,255,0.1)",
                  borderRadius: 999,
                  padding: "1px 8px",
                  marginRight: 4,
                  marginBottom: 2,
                }}
              >
                ⚙ {t.conversation.toolCalled}:{ev.toolName}
              </span>
            ))}
          </div>
        )}
        {m.content}
        {m.error && (
          <div role="alert" style={{ color: "var(--ios-red)", fontSize: 12, marginTop: 6 }}>
            {m.error.message}
          </div>
        )}
      </div>
    </div>
  );
}
