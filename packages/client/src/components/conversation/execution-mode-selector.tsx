import type { ExecutionMode } from "@scribe/shared";
import { useConversationStore } from "../../stores/conversation.js";

const LABELS: Record<ExecutionMode, string> = {
  trusted_auto: "全权交给",
  low_risk_auto: "低风险自动",
  confirm_each: "每次确认",
  plan_only: "只出方案",
};

export function ExecutionModeSelector() {
  const mode = useConversationStore(s => s.executionMode);
  const setExecutionMode = useConversationStore(s => s.setExecutionMode);

  return (
    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#555" }}>
      <span>执行模式</span>
      <select
        data-testid="execution-mode-selector"
        value={mode}
        onChange={(event) => setExecutionMode(event.target.value as ExecutionMode)}
        style={{ fontSize: 12, border: "1px solid #d0d0d0", borderRadius: 6, padding: "3px 6px" }}
      >
        {Object.entries(LABELS).map(([value, label]) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </select>
    </label>
  );
}
