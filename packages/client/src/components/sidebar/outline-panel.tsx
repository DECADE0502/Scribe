import { useEffect, useState } from "react";
import { t } from "../../i18n/zh-CN.js";

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
  const [nodes, setNodes] = useState<OutlineNode[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/books/${encodeURIComponent(props.bookId)}/outline`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = await res.json() as { outline: OutlineNode[] };
        setNodes(j.outline);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [props.bookId]);

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

  function renderNode(node: OutlineNode, depth: number) {
    const children = childrenOf(node.id);
    const isCollapsed = collapsed.has(node.id);
    return (
      <div key={node.id} data-testid={`outline-node-${node.id}`} style={{ marginLeft: depth * 14 }}>
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
        </div>
        {node.summary && !isCollapsed && (
          <p style={{ margin: "0 0 4px 20px", fontSize: 12, color: "#999" }}>{node.summary}</p>
        )}
        {!isCollapsed && children.map(child => renderNode(child, depth + 1))}
      </div>
    );
  }

  const roots = childrenOf(null);

  return (
    <div data-testid="outline-panel">
      {error && <p role="alert" style={{ color: "#c00" }}>{error}</p>}
      {roots.length === 0 && <p data-testid="outline-empty" style={{ color: "#999" }}>{t.common.empty}</p>}
      {roots.map(n => renderNode(n, 0))}
    </div>
  );
}
