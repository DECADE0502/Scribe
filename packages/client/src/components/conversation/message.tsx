import { useState } from "react";
import type { ChatMessage } from "../../stores/conversation.js";
import { t } from "../../i18n/zh-CN.js";

/** 工具名 → 中文标签 */
const TOOL_LABELS: Record<string, string> = {
  chapter_audit: "审查",
  chapter_repair: "修复",
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

export function Message(props: { m: ChatMessage }) {
  const { m } = props;
  const [showReasoning, setShowReasoning] = useState(false);
  const isUser = m.role === "user";
  const isSystem = m.role === "system";

  if (isSystem) {
    return (
      <div data-testid={`msg-${m.id}`} data-role="system" className="bubble-system fade-up" style={{ margin: "10px 0" }}>
        {m.content}
      </div>
    );
  }

  // 判断是否是写作流程(有写作工具调用)——写作流程不显示正文
  const isWritingFlow = m.toolEvents?.some(ev => WRITING_TOOLS.has(ev.toolName));

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
                {EXTRA_TOOL_LABELS[ev.toolName] ?? TOOL_LABELS[ev.toolName] ?? ev.toolName}
              </span>
            ))}
          </div>
        )}
        {/* 写作流程不显示正文,只显示"正文已生成,请在右侧编辑器查看" */}
        {isWritingFlow
          ? (
            <div>
              {m.workflowStages && <CompletedWorkflow stages={m.workflowStages} />}
              <span style={{ color: "#999", fontSize: 13 }}>正文已生成,请在右侧编辑器查看</span>
            </div>
          )
          : m.content}
        {!isUser && m.reasoning && m.reasoning.trim() && !isWritingFlow && (
          <div style={{ marginTop: 8 }}>
            <button
              data-testid="toggle-reasoning"
              onClick={() => setShowReasoning(v => !v)}
              style={{
                fontSize: 12, color: "var(--ios-blue)", background: "none",
                border: "none", padding: 0, cursor: "pointer",
              }}
            >
              {showReasoning ? "▾ " : "▸ "}{t.conversation.viewReasoning}
            </button>
            {showReasoning && (
              <div
                data-testid="reasoning-content"
                style={{
                  marginTop: 6, padding: "8px 10px", fontSize: 12.5, lineHeight: 1.6,
                  color: "#666", background: "rgba(0,0,0,0.035)", borderRadius: 8,
                  whiteSpace: "pre-wrap", maxHeight: 280, overflow: "auto",
                }}
              >
                {m.reasoning}
              </div>
            )}
          </div>
        )}
        {m.error && (
          <div role="alert" style={{ color: "var(--ios-red)", fontSize: 12, marginTop: 6 }}>
            {m.error.message}
          </div>
        )}
      </div>
    </div>
  );
}

function CompletedWorkflow(props: { stages: NonNullable<ChatMessage["workflowStages"]> }) {
  return (
    <div data-testid="workflow-progress" style={{ display: "grid", gap: 4, marginBottom: 8 }}>
      {props.stages.map((stage) => (
        <div key={stage.id} style={{ display: "flex", gap: 8, fontSize: 12, color: stage.status === "done" ? "#34c759" : "#999" }}>
          <span>{stage.status === "done" ? "✓" : "○"}</span>
          <span>{stage.label}</span>
        </div>
      ))}
    </div>
  );
}
