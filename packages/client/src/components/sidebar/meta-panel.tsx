import { useCallback, useEffect, useState } from "react";
import { useToastStore } from "../../stores/toast.js";

interface BookMeta {
  title: string;
  premise: string;
  tone: string;
  genre: string;
  goalForm: string;
  goalTargetChapters: string;
  goalEnding: string;
  goalSequel: string;
}

const EMPTY_META: BookMeta = {
  title: "", premise: "", tone: "", genre: "",
  goalForm: "", goalTargetChapters: "", goalEnding: "", goalSequel: "",
};

export function MetaPanel(props: { bookId: string }) {
  const { bookId } = props;
  const pushToast = useToastStore((s) => s.push);
  const [meta, setMeta] = useState<BookMeta>(EMPTY_META);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/books/${encodeURIComponent(bookId)}/meta`);
        if (!res.ok) return;
        setMeta({ ...EMPTY_META, ...(await res.json() as Partial<BookMeta>) });
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
      <div style={{ borderTop: "1px solid var(--ios-sep, #e5e5e5)", margin: "4px 0", paddingTop: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#666", marginBottom: 8 }}>📌 创作目标(影响 AI 的篇幅与节奏把控)</div>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: "block", fontSize: 13, marginBottom: 4, color: "#888" }}>篇幅形态</label>
            <select
              data-testid="meta-goal-form"
              className="ios-input"
              style={{ width: "100%", boxSizing: "border-box" }}
              value={meta.goalForm}
              onChange={(e) => setMeta({ ...meta, goalForm: e.target.value })}
            >
              <option value="">未定</option>
              <option value="短篇">短篇</option>
              <option value="中篇">中篇</option>
              <option value="长篇">长篇</option>
              <option value="长篇连载">长篇连载</option>
            </select>
          </div>
          <div style={{ width: 120 }}>
            <label style={{ display: "block", fontSize: 13, marginBottom: 4, color: "#888" }}>目标章数</label>
            <input
              data-testid="meta-goal-chapters"
              type="number"
              min="1"
              className="ios-input"
              style={{ width: "100%", boxSizing: "border-box" }}
              value={meta.goalTargetChapters}
              onChange={(e) => setMeta({ ...meta, goalTargetChapters: e.target.value })}
              placeholder="如 100"
            />
          </div>
        </div>
      </div>
      <div>
        <label style={{ display: "block", fontSize: 13, marginBottom: 4, color: "#888" }}>最终目标 / 结局走向</label>
        <textarea
          data-testid="meta-goal-ending"
          className="ios-input"
          style={{ width: "100%", boxSizing: "border-box", minHeight: 70, resize: "vertical", fontFamily: "inherit" }}
          value={meta.goalEnding}
          onChange={(e) => setMeta({ ...meta, goalEnding: e.target.value })}
          placeholder="主角最终要达成或走向什么、全书要收束到哪里..."
        />
      </div>
      <div>
        <label style={{ display: "block", fontSize: 13, marginBottom: 4, color: "#888" }}>续集考虑</label>
        <input
          data-testid="meta-goal-sequel"
          className="ios-input"
          style={{ width: "100%", boxSizing: "border-box" }}
          value={meta.goalSequel}
          onChange={(e) => setMeta({ ...meta, goalSequel: e.target.value })}
          placeholder="如：不考虑 / 预留续集钩子 / 三部曲第一部"
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
