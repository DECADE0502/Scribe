import { useCallback, useEffect, useState } from "react";
import { t } from "../../i18n/zh-CN.js";
import { useToastStore } from "../../stores/toast.js";
import { useConversationStore } from "../../stores/conversation.js";

interface OutlineNode {
  id: string;
  parentId: string | null;
  level: "volume" | "arc" | "chapter";
  title: string;
  summary: string | null;
  status: string;
  sortOrder: number;
}

const LEVEL_LABELS: Record<string, string> = { volume: "卷", arc: "弧", chapter: "章" };
const STATUS_LABELS: Record<string, string> = { planned: "计划中", in_progress: "进行中", done: "已完成" };

export function OutlinePanel(props: { bookId: string }) {
  const { bookId } = props;
  const libraryRefreshTrigger = useConversationStore(s => s.libraryRefreshTrigger);
  const pushToast = useToastStore((s) => s.push);
  const [nodes, setNodes] = useState<OutlineNode[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ title: "", summary: "", level: "chapter" as "volume" | "arc" | "chapter" });

  const reload = useCallback(async () => {
    try {
      const res = await fetch(`/api/books/${encodeURIComponent(bookId)}/outline`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json() as { outline: OutlineNode[] };
      setNodes(j.outline);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [bookId]);

  useEffect(() => { void reload(); }, [reload, libraryRefreshTrigger]);

  const childrenOf = (parentId: string | null) =>
    nodes
      .filter(n => n.parentId === parentId)
      .sort((a, b) => a.sortOrder - b.sortOrder);

  const toggle = (id: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const createNode = async () => {
    if (!draft.title.trim()) return;
    const maxSort = Math.max(0, ...childrenOf(null).map(n => n.sortOrder));
    const res = await fetch(`/api/books/${encodeURIComponent(bookId)}/outline`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: draft.title,
        summary: draft.summary,
        level: draft.level,
        sortOrder: maxSort + 1,
        status: "planned",
      }),
    });
    if (res.ok) {
      setAdding(false);
      setDraft({ title: "", summary: "", level: "chapter" });
      pushToast({ level: "info", text: "大纲节点已添加" });
      void reload();
    }
  };

  const updateNode = async (id: string) => {
    const res = await fetch(`/api/books/${encodeURIComponent(bookId)}/outline/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: draft.title, summary: draft.summary, level: draft.level }),
    });
    if (res.ok) {
      setEditingId(null);
      pushToast({ level: "info", text: "大纲节点已更新" });
      void reload();
    }
  };

  const deleteNode = async (id: string) => {
    const res = await fetch(`/api/books/${encodeURIComponent(bookId)}/outline/${id}`, { method: "DELETE" });
    if (res.ok) {
      pushToast({ level: "info", text: "已删除" });
      void reload();
    }
  };

  const startEdit = (node: OutlineNode) => {
    setEditingId(node.id);
    setDraft({ title: node.title, summary: node.summary ?? "", level: node.level });
  };

  function renderNode(node: OutlineNode, depth: number) {
    const children = childrenOf(node.id);
    const isCollapsed = collapsed.has(node.id);
    const isEditing = editingId === node.id;
    return (
      <div key={node.id} data-testid={`outline-node-${node.id}`} style={{ marginLeft: depth * 14 }}>
        {isEditing ? (
          <div style={{ padding: "4px 0", display: "flex", flexDirection: "column", gap: 4 }}>
            <select
              value={draft.level}
              onChange={(e) => setDraft({ ...draft, level: e.target.value as "volume" | "arc" | "chapter" })}
              className="ios-input"
              style={{ width: "auto" }}
            >
              <option value="volume">卷</option>
              <option value="arc">弧</option>
              <option value="chapter">章</option>
            </select>
            <input
              className="ios-input"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="标题"
            />
            <textarea
              className="ios-input"
              value={draft.summary}
              onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
              placeholder="摘要（可选）"
              style={{ minHeight: 60, resize: "vertical", fontFamily: "inherit" }}
            />
            <div style={{ display: "flex", gap: 4 }}>
              <button className="ios-btn-small" onClick={() => void updateNode(node.id)}>保存</button>
              <button className="ios-btn-small" onClick={() => setEditingId(null)}>取消</button>
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "2px 0" }}>
              {children.length > 0 && (
                <button
                  data-testid={`outline-toggle-${node.id}`}
                  style={{ border: "none", background: "transparent", padding: 0, width: 16 }}
                  onClick={() => toggle(node.id)}
                >
                  {isCollapsed ? "▸" : "▾"}
                </button>
              )}
              <span style={{ fontSize: 12, color: "#888" }}>[{LEVEL_LABELS[node.level] ?? node.level}]</span>
              <span style={{ fontWeight: node.level === "volume" ? 600 : 400 }}>{node.title}</span>
              <span style={{ fontSize: 11, color: "#aaa" }}>{STATUS_LABELS[node.status] ?? ""}</span>
              <button
                data-testid={`outline-edit-${node.id}`}
                className="ios-btn-small"
                style={{ fontSize: 11, padding: "0 4px" }}
                onClick={() => startEdit(node)}
              >
                编辑
              </button>
              <button
                className="ios-btn-small"
                style={{ fontSize: 11, padding: "0 4px", color: "#c00" }}
                onClick={() => void deleteNode(node.id)}
              >
                删
              </button>
            </div>
            {node.summary && !isCollapsed && (
              <p style={{ margin: "0 0 4px 20px", fontSize: 12, color: "#999" }}>{node.summary}</p>
            )}
            {!isCollapsed && children.map(child => renderNode(child, depth + 1))}
          </>
        )}
      </div>
    );
  }

  const roots = childrenOf(null);

  return (
    <div data-testid="outline-panel">
      {error && <p role="alert" style={{ color: "#c00" }}>{error}</p>}
      {roots.length === 0 && !adding && <p data-testid="outline-empty" style={{ color: "#999" }}>{t.common.empty}</p>}
      {roots.map(n => renderNode(n, 0))}

      {adding ? (
        <div style={{ marginTop: 8, padding: 8, borderTop: "1px solid #eee", display: "flex", flexDirection: "column", gap: 4 }}>
          <select
            value={draft.level}
            onChange={(e) => setDraft({ ...draft, level: e.target.value as "volume" | "arc" | "chapter" })}
            className="ios-input"
            style={{ width: "auto" }}
          >
            <option value="volume">卷</option>
            <option value="arc">弧</option>
            <option value="chapter">章</option>
          </select>
          <input
            data-testid="outline-new-title"
            className="ios-input"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="章节标题"
          />
          <textarea
            className="ios-input"
            value={draft.summary}
            onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
            placeholder="本章摘要（写什么、推进什么剧情）"
            style={{ minHeight: 60, resize: "vertical", fontFamily: "inherit" }}
          />
          <div style={{ display: "flex", gap: 4 }}>
            <button data-testid="outline-create" className="ios-btn-small" onClick={() => void createNode()}>添加</button>
            <button className="ios-btn-small" onClick={() => { setAdding(false); setDraft({ title: "", summary: "", level: "chapter" }); }}>取消</button>
          </div>
        </div>
      ) : (
        <button
          data-testid="outline-add"
          className="ios-btn-small"
          style={{ marginTop: 8 }}
          onClick={() => { setAdding(true); setDraft({ title: "", summary: "", level: "chapter" }); }}
        >
          + 添加大纲节点
        </button>
      )}
    </div>
  );
}
