import { useToastStore } from "../stores/toast.js";

const LEVEL_COLORS = {
  info: { bg: "#e6f4ff", border: "#91caff" },
  warning: { bg: "#fff7e6", border: "#ffd591" },
  error: { bg: "#fff2f0", border: "#ffccc7" },
} as const;

export function ToastContainer() {
  const { toasts, dismiss } = useToastStore();
  if (toasts.length === 0) return null;
  return (
    <div
      data-testid="toast-container"
      style={{
        position: "fixed", top: 12, right: 12, zIndex: 100,
        display: "flex", flexDirection: "column", gap: 8, maxWidth: 360,
      }}
    >
      {toasts.map(toast => {
        const colors = LEVEL_COLORS[toast.level];
        return (
          <div
            key={toast.id}
            data-testid={`toast-${toast.level}`}
            role={toast.level === "error" ? "alert" : "status"}
            style={{
              background: colors.bg,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              padding: "8px 12px",
              display: "flex", alignItems: "center", gap: 8,
              fontSize: 13,
            }}
          >
            <span style={{ flex: 1 }}>{toast.text}</span>
            {toast.action && (
              <button style={{ fontSize: 12 }} onClick={toast.action.onClick}>
                {toast.action.label}
              </button>
            )}
            <button
              data-testid={`toast-dismiss-${toast.id}`}
              style={{ border: "none", background: "transparent", padding: 0, color: "#999" }}
              onClick={() => dismiss(toast.id)}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
