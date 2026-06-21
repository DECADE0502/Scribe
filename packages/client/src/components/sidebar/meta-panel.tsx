import { useCallback, useEffect, useState } from "react";
import { useToastStore } from "../../stores/toast.js";

interface BookMeta {
  title: string;
  premise: string;
  tone: string;
  genre: string;
}

export function MetaPanel(props: { bookId: string }) {
  const { bookId } = props;
  const pushToast = useToastStore((s) => s.push);
  const [meta, setMeta] = useState<BookMeta>({ title: "", premise: "", tone: "", genre: "" });
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/books/${encodeURIComponent(bookId)}/meta`);
        if (!res.ok) return;
        setMeta(await res.json() as BookMeta);
      } catch {
        // ignore
      } finally {
        setLoaded(true);
      }
    })();
  }, [bookId]);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/books/${encodeURIComponent(bookId)}/meta`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(meta),
      });
      if (res.ok) {
        pushToast({ level: "info", text: "设定已保存" });
      } else {
        pushToast({ level: "error", text: "保存失败" });
      }
    } finally {
      setSaving(false);
    }
  }, [bookId, meta, pushToast]);

  if (!loaded) return <div className="muted" style={{ padding: 12 }}>加载中...</div>;

  return (
    <div data-testid="meta-panel" style={{ display: "flex", flexDirection: "column", gap: 12, padding: 4 }}>
      <div>
        <label style={{ display: "block", fontSize: 13, marginBottom: 4, color: "#888" }}>标题</label>
        <input
          data-testid="meta-title"
          className="ios-input"
          style={{ width: "100%", boxSizing: "border-box" }}
          value={meta.title}
          onChange={(e) => setMeta({ ...meta, title: e.target.value })}
        />
      </div>
      <div>
        <label style={{ display: "block", fontSize: 13, marginBottom: 4, color: "#888" }}>题材</label>
        <input
          data-testid="meta-genre"
          className="ios-input"
          style={{ width: "100%", boxSizing: "border-box" }}
          value={meta.genre}
          onChange={(e) => setMeta({ ...meta, genre: e.target.value })}
          placeholder="如：都市悬疑、仙侠、科幻..."
        />
      </div>
      <div>
        <label style={{ display: "block", fontSize: 13, marginBottom: 4, color: "#888" }}>调性</label>
        <input
          data-testid="meta-tone"
          className="ios-input"
          style={{ width: "100%", boxSizing: "border-box" }}
          value={meta.tone}
          onChange={(e) => setMeta({ ...meta, tone: e.target.value })}
          placeholder="如：冷硬派推理、氛围压抑、节奏紧凑..."
        />
      </div>
      <div>
        <label style={{ display: "block", fontSize: 13, marginBottom: 4, color: "#888" }}>故事前提</label>
        <textarea
          data-testid="meta-premise"
          className="ios-input"
          style={{ width: "100%", boxSizing: "border-box", minHeight: 120, resize: "vertical", fontFamily: "inherit" }}
          value={meta.premise}
          onChange={(e) => setMeta({ ...meta, premise: e.target.value })}
          placeholder="一句话或一段话描述故事的核心设定和主角动机..."
        />
      </div>
      <button
        data-testid="meta-save"
        className="ios-btn"
        onClick={() => void save()}
        disabled={saving}
        style={{ alignSelf: "flex-start" }}
      >
        {saving ? "保存中..." : "保存设定"}
      </button>
    </div>
  );
}
