import { useCallback, useEffect, useState } from "react";
import { t } from "../../i18n/zh-CN.js";
import { useConversationStore } from "../../stores/conversation.js";

interface Character {
  id: string;
  name: string;
  role: string | null;
  baseData: Record<string, unknown>;
  currentState: Record<string, unknown>;
  appearances: Array<{ chapterNo: number; brief: string }>;
}

const ROLE_LABELS: Record<string, string> = {
  protagonist: "主角",
  antagonist: "反派",
  supporting: "配角",
};

export function CharactersPanel(props: { bookId: string }) {
  const libraryRefreshTrigger = useConversationStore(s => s.libraryRefreshTrigger);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch(`/api/books/${encodeURIComponent(props.bookId)}/characters`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json() as { characters: Character[] };
      setCharacters(j.characters);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [props.bookId]);

  useEffect(() => { void reload(); }, [reload, libraryRefreshTrigger]);

  const saveName = async (c: Character) => {
    try {
      const res = await fetch(`/api/books/${encodeURIComponent(props.bookId)}/characters/${c.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setEditing(null);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div data-testid="characters-panel">
      {error && <p role="alert" style={{ color: "#c00" }}>{error}</p>}
      {characters.length === 0 && <p data-testid="characters-empty" style={{ color: "#999" }}>{t.common.empty}</p>}
      {characters.map(c => (
        <div
          key={c.id}
          data-testid={`character-card-${c.id}`}
          style={{ border: "1px solid #e5e5e5", borderRadius: 6, padding: 8, marginBottom: 8 }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            {editing === c.id ? (
              <span style={{ display: "flex", gap: 4 }}>
                <input
                  data-testid={`character-name-input-${c.id}`}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  style={{ width: 120 }}
                />
                <button data-testid={`character-save-${c.id}`} onClick={() => void saveName(c)}>
                  {t.common.save}
                </button>
                <button onClick={() => setEditing(null)}>{t.common.cancel}</button>
              </span>
            ) : (
              <button
                style={{ border: "none", background: "transparent", padding: 0, fontWeight: 600 }}
                onClick={() => setExpanded(expanded === c.id ? null : c.id)}
              >
                {c.name}
                <span style={{ fontWeight: 400, color: "#888", marginLeft: 6, fontSize: 12 }}>
                  {c.role ? ROLE_LABELS[c.role] ?? c.role : ""}
                </span>
              </button>
            )}
            {editing !== c.id && (
              <button
                data-testid={`character-edit-${c.id}`}
                style={{ fontSize: 12, padding: "2px 6px" }}
                onClick={() => { setEditing(c.id); setEditName(c.name); }}
              >
                {t.common.edit}
              </button>
            )}
          </div>
          {expanded === c.id && (
            <div data-testid={`character-detail-${c.id}`} style={{ marginTop: 8, fontSize: 13 }}>
              {Object.entries(c.baseData).map(([k, v]) => (
                <p key={k} style={{ margin: "2px 0" }}>
                  <span style={{ color: "#888" }}>{k}:</span>{String(v)}
                </p>
              ))}
              {Object.keys(c.currentState).length > 0 && (
                <>
                  <p style={{ margin: "6px 0 2px", color: "#888" }}>当前状态:</p>
                  {Object.entries(c.currentState).map(([k, v]) => (
                    <p key={k} style={{ margin: "2px 0" }}>
                      <span style={{ color: "#888" }}>{k}:</span>{String(v)}
                    </p>
                  ))}
                </>
              )}
              {c.appearances.length > 0 && (
                <p style={{ margin: "6px 0 0", color: "#888", fontSize: 12 }}>
                  出场:{c.appearances.map(a => `第${a.chapterNo}章`).join("、")}
                </p>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
