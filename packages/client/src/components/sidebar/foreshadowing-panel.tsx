import { useCallback, useEffect, useState } from "react";
import { t } from "../../i18n/zh-CN.js";

interface Foreshadowing {
  id: string;
  label: string;
  description: string | null;
  plantedChapter: number | null;
  paidChapter: number | null;
  status: "active" | "paid" | "dropped";
  relatedCharacters: string[];
}

export function ForeshadowingPanel(props: { bookId: string }) {
  const [items, setItems] = useState<Foreshadowing[]>([]);
  const [showPaid, setShowPaid] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch(`/api/books/${encodeURIComponent(props.bookId)}/foreshadowing`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json() as { foreshadowing: Foreshadowing[] };
      setItems(j.foreshadowing);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [props.bookId]);

  useEffect(() => { void reload(); }, [reload]);

  const add = async () => {
    if (!newLabel.trim()) return;
    try {
      const res = await fetch(`/api/books/${encodeURIComponent(props.bookId)}/foreshadowing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: newLabel.trim(), description: newDesc.trim() || null }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setNewLabel("");
      setNewDesc("");
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const remove = async (f: Foreshadowing) => {
    if (!window.confirm(`删除伏笔「${f.label}」?`)) return;
    try {
      const res = await fetch(`/api/books/${encodeURIComponent(props.bookId)}/foreshadowing/${f.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const active = items.filter(f => f.status === "active");
  const paid = items.filter(f => f.status === "paid");

  const renderItem = (f: Foreshadowing) => (
    <div
      key={f.id}
      data-testid={`foreshadowing-${f.id}`}
      style={{ border: "1px solid #e5e5e5", borderRadius: 6, padding: 6, marginBottom: 6, fontSize: 13 }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong>[{f.label}]</strong>
        <button
          data-testid={`foreshadowing-delete-${f.id}`}
          style={{ fontSize: 11, padding: "1px 6px", color: "#c00" }}
          onClick={() => void remove(f)}
        >
          {t.common.delete}
        </button>
      </div>
      {f.description && <p style={{ margin: "4px 0 0", color: "#666" }}>{f.description}</p>}
      <p style={{ margin: "4px 0 0", fontSize: 11, color: "#999" }}>
        {f.plantedChapter != null ? `埋于第 ${f.plantedChapter} 章` : "未记录埋点"}
        {f.paidChapter != null ? ` · 回收于第 ${f.paidChapter} 章` : ""}
        {f.relatedCharacters.length > 0 ? ` · ${f.relatedCharacters.join("、")}` : ""}
      </p>
    </div>
  );

  return (
    <div data-testid="foreshadowing-panel">
      {error && <p role="alert" style={{ color: "#c00" }}>{error}</p>}

      <p style={{ margin: "0 0 6px", fontWeight: 600 }}>活跃({active.length})</p>
      {active.length === 0 && <p data-testid="foreshadowing-empty" style={{ color: "#999" }}>{t.common.empty}</p>}
      {active.map(renderItem)}

      <button
        data-testid="toggle-paid"
        style={{ fontSize: 12, margin: "8px 0" }}
        onClick={() => setShowPaid(v => !v)}
      >
        {showPaid ? "收起" : "展开"}已回收({paid.length})
      </button>
      {showPaid && paid.map(renderItem)}

      <div style={{ borderTop: "1px solid #eee", paddingTop: 8, marginTop: 8 }}>
        <p style={{ margin: "0 0 4px", fontSize: 12, color: "#888" }}>{t.sidebar.addForeshadowing}</p>
        <input
          data-testid="new-foreshadowing-label"
          placeholder="标签(如:黑剑之谜)"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          style={{ width: "100%", marginBottom: 4, padding: 4 }}
        />
        <input
          data-testid="new-foreshadowing-desc"
          placeholder="描述(可选)"
          value={newDesc}
          onChange={(e) => setNewDesc(e.target.value)}
          style={{ width: "100%", marginBottom: 4, padding: 4 }}
        />
        <button data-testid="add-foreshadowing" onClick={() => void add()} disabled={!newLabel.trim()}>
          {t.common.save}
        </button>
      </div>
    </div>
  );
}
