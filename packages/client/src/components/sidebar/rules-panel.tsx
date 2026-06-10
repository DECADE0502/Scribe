import { useCallback, useEffect, useState } from "react";
import { t } from "../../i18n/zh-CN.js";

export function RulesPanel(props: { bookId: string }) {
  const [content, setContent] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [savedTip, setSavedTip] = useState(false);

  const reload = useCallback(async () => {
    try {
      const res = await fetch(`/api/books/${encodeURIComponent(props.bookId)}/rules`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json() as { content: string };
      setContent(j.content);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [props.bookId]);

  useEffect(() => { void reload(); }, [reload]);

  const save = async () => {
    try {
      const res = await fetch(`/api/books/${encodeURIComponent(props.bookId)}/rules`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: draft }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setContent(draft);
      setEditing(false);
      setSavedTip(true);
      setTimeout(() => setSavedTip(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div data-testid="rules-panel">
      {error && <p role="alert" style={{ color: "#c00" }}>{error}</p>}
      {savedTip && <p data-testid="rules-saved-tip" style={{ color: "#080" }}>{t.settings.savedTip}</p>}
      {editing ? (
        <>
          <textarea
            data-testid="rules-textarea"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={16}
            style={{ width: "100%", padding: 8, fontFamily: "inherit" }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <button data-testid="rules-save" onClick={() => void save()}>{t.common.save}</button>
            <button onClick={() => setEditing(false)}>{t.common.cancel}</button>
          </div>
        </>
      ) : (
        <>
          <button
            data-testid="rules-edit"
            style={{ marginBottom: 8 }}
            onClick={() => { setDraft(content); setEditing(true); }}
          >
            {t.common.edit}
          </button>
          {content
            ? <pre data-testid="rules-content" style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13 }}>{content}</pre>
            : <p data-testid="rules-empty" style={{ color: "#999" }}>{t.common.empty}</p>}
        </>
      )}
    </div>
  );
}
