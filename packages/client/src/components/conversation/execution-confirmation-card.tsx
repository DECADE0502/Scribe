import type { ExecutionPolicy } from "@scribe/shared";

export function ExecutionConfirmationCard(props: {
  taskId: string;
  message: string;
  policy: ExecutionPolicy;
  onApprove: () => void;
  onReroll: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      data-testid="execution-confirmation-card"
      style={{
        margin: "8px 12px",
        padding: 10,
        border: "1px solid #ffd591",
        borderRadius: 6,
        background: "#fffbe6",
        fontSize: 13,
      }}
    >
      <div style={{ fontWeight: 600 }}>需要确认</div>
      <div>{props.message}</div>
      <div style={{ marginTop: 4, color: "#666" }}>
        模式: {props.policy.configuredMode} · 风险: {props.policy.highestRisk}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button data-testid="execution-approve" onClick={props.onApprove}>同意执行</button>
        <button data-testid="execution-edit-plan" disabled title="计划编辑将在后续任务接入">修改计划</button>
        <button data-testid="execution-reroll" onClick={props.onReroll}>打回重 roll</button>
        <button data-testid="execution-cancel" onClick={props.onCancel}>取消</button>
      </div>
    </div>
  );
}
