import { useEffect, useState } from "react";
import type { StreamingState } from "../../stores/conversation.js";
import { useConversationStore } from "../../stores/conversation.js";
import { t } from "../../i18n/zh-CN.js";

/** 工具名 → 中文标签(与 conversation-pane 共享) */
const TOOL_LABELS: Record<string, string> = {
  chapter_audit: "审查章节质量",
  chapter_repair: "修复章节",
  chapter_repair_audit: "修复后审查",
  hard_fact_gate: "硬事实检查",
  record_chapter_state: "记录状态",
  create_character: "登记角色",
  update_character_state: "更新角色状态",
  add_character_appearance: "记录出场",
  add_foreshadowing: "登记伏笔",
  pay_foreshadowing: "回收伏笔",
  add_timeline_event: "记录时间线",
  upsert_record_item: "更新记录",
  create_record_collection: "创建记录集合",
};

/** 写作流程的工具集合——有这些工具时不显示正文 */
const WRITING_TOOLS = new Set(["chapter_write", "chapter_audit", "record_chapter_state", "hard_fact_gate", "chapter_repair", "chapter_repair_audit"]);

const EXTRA_TOOL_LABELS: Record<string, string> = {
  chapter_write: "正在写正文",
  list_outline: "查看大纲",
  add_outline_node: "添加大纲节点",
  update_outline_node: "更新大纲节点",
  delete_outline_node: "删除大纲节点",
  list_characters: "查看角色",
  update_character: "更新角色",
  delete_character: "删除角色",
  list_foreshadowing: "查看伏笔",
  create_foreshadowing: "登记伏笔",
  delete_foreshadowing: "删除伏笔",
  list_timeline: "查看时间线",
  update_book_meta: "更新书籍设定",
  create_genre_section: "创建记录集合",
  update_genre_section_schema: "更新记录结构",
  delete_genre_section: "删除记录集合",
  add_genre_section_item: "添加记录条目",
  upsert_genre_section_item: "更新记录条目",
  update_genre_section_item: "更新记录条目",
  delete_genre_section_item: "删除记录条目",
  update_record_collection_schema: "更新记录结构",
  delete_record_collection: "删除记录集合",
  update_record_item: "更新记录条目",
  delete_record_item: "删除记录条目",
};

export function StreamingMessage(props: { state: StreamingState }) {
  const { state } = props;
  const pendingTools = collectPendingTools(state);
  const executionSteps = useConversationStore(s => s.executionSteps);
  const acceptanceReport = useConversationStore(s => s.acceptanceReport);
  const [elapsed, setElapsed] = useState(0);

  // 超时检测:每秒更新已用时间,超过15秒显示提示
  useEffect(() => {
    const timer = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(timer);
  }, [state.id]);

  const showSlowWarning = elapsed > 15 && pendingTools.length > 0;

  // 是否是写作流程(已出现过写作工具)
  const isWriting = state.toolEvents.some(ev => WRITING_TOOLS.has(ev.toolName)) || state.workflowStages.length > 0;

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
        {state.workflowStages.length > 0 && (
          <WorkflowProgress stages={state.workflowStages} />
        )}
        {executionSteps.length > 0 && (
          <div data-testid="execution-steps" style={{ marginTop: 8, marginBottom: 8, fontSize: 12, color: "#445" }}>
            {executionSteps.map(step => (
              <div key={step.id}>
                {step.status === "succeeded" ? "✓" : step.status === "failed" ? "×" : "•"} {step.actionType}
                {step.verification?.detail ? ` · ${step.verification.detail}` : ""}
              </div>
            ))}
          </div>
        )}
        {acceptanceReport && (
          <div data-testid="acceptance-report" style={{ marginTop: 8, marginBottom: 8, fontSize: 12, color: "#445" }}>
            验收: {acceptanceReport.verdict}
          </div>
        )}
        {/* 进度提示 */}
        {pendingTools.map((name, i) => {
          const label = EXTRA_TOOL_LABELS[name] ?? TOOL_LABELS[name] ?? name;
          return (
            <div key={i} data-testid="tool-running" style={{ fontSize: 12, color: "#557", display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ display: "inline-block", width: 12, height: 12, border: "2px solid #cfe3ff", borderTopColor: "var(--ios-blue)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
              {label}...
            </div>
          );
        })}
        {/* 超时提示 */}
        {showSlowWarning && (
          <div style={{ fontSize: 11, color: "#999", marginTop: 4 }}>
            已处理 {elapsed} 秒,仍在进行中...
          </div>
        )}
        {/* 写作流程:不显示正文,只显示字数进度 */}
        {isWriting && state.suppressText && (
          <div style={{ color: "#999", fontSize: 13, marginTop: 6 }}>
            正文生成中,完成后请在右侧编辑器查看
          </div>
        )}
        {isWriting && !state.suppressText && state.text.length > 0 && (
          <div style={{ color: "#999", fontSize: 13 }}>
            正文已生成 {state.text.length} 字
          </div>
        )}
        {/* 非写作流程(纯对话或写作前正文生成):正常显示文字 */}
        {!isWriting && state.text && (
          <>
            {state.text}
            <span data-testid="streaming-cursor" style={{ opacity: 0.6 }}>▌</span>
          </>
        )}
        {/* 等待状态(没文字也没工具) */}
        {!isWriting && pendingTools.length === 0 && !state.text && (
          <span data-testid="streaming-placeholder" style={{ color: "#999" }}>
            {elapsed > 5 ? "AI 正在思考中,请稍候..." : t.conversation.aiThinking}
          </span>
        )}
        {/* 写作流程但没有正文也没有工具(工具间隙) */}
        {isWriting && state.text.length === 0 && pendingTools.length === 0 && (
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
        const mark = stage.status === "done" ? "✓" : stage.status === "active" ? "●" : "○";
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
