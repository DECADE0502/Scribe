import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  type WorldbookEntry,
  type WorldbookPreviewResult,
} from "../../api/client.js";

interface Draft {
  id?: string;
  title: string;
  content: string;
  enabled: boolean;
  activation: "constant" | "triggered";
  keys: string;
  secondaryKeys: string;
  priority: number;
  insertionDepth: number;
  recursive: boolean;
  recursionLimit: number;
  tokenBudget: string;
  category: string;
  metadata: Record<string, unknown>;
  stSelective: boolean;
  stProbability: number;
  stUseProbability: boolean;
  stScanDepth: number;
}

const emptyDraft: Draft = {
  title: "",
  content: "",
  enabled: true,
  activation: "constant",
  keys: "",
  secondaryKeys: "",
  priority: 0,
  insertionDepth: 0,
  recursive: false,
  recursionLimit: 0,
  tokenBudget: "",
  category: "",
  metadata: {},
  stSelective: false,
  stProbability: 100,
  stUseProbability: true,
  stScanDepth: 10,
};

function joinKeys(keys: string[]): string {
  return keys.join(", ");
}

function splitKeys(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function draftFromEntry(entry: WorldbookEntry): Draft {
  const st = sillytavernMetadata(entry.metadata);
  return {
    id: entry.id,
    title: entry.title,
    content: entry.content,
    enabled: entry.enabled,
    activation: entry.activation,
    keys: joinKeys(entry.keys),
    secondaryKeys: joinKeys(entry.secondaryKeys),
    priority: entry.priority,
    insertionDepth: entry.insertionDepth,
    recursive: entry.recursive,
    recursionLimit: entry.recursionLimit,
    tokenBudget: entry.tokenBudget == null ? "" : String(entry.tokenBudget),
    category: entry.category ?? "",
    metadata: entry.metadata ?? {},
    stSelective: st.selective === true,
    stProbability: typeof st.probability === "number" ? st.probability : 100,
    stUseProbability: st.useProbability !== false,
    stScanDepth: typeof st.scanDepth === "number" ? st.scanDepth : 10,
  };
}

function toPayload(draft: Draft) {
  const activation = draft.activation;
  const st = sillytavernMetadata(draft.metadata);
  return {
    title: draft.title.trim(),
    content: draft.content.trim(),
    enabled: draft.enabled,
    activation,
    constant: activation === "constant",
    keys: splitKeys(draft.keys),
    secondaryKeys: splitKeys(draft.secondaryKeys),
    priority: Number(draft.priority) || 0,
    insertionDepth: Number(draft.insertionDepth) || 0,
    recursive: draft.recursive,
    recursionLimit: Number(draft.recursionLimit) || 0,
    tokenBudget: draft.tokenBudget.trim() ? Number(draft.tokenBudget) : null,
    category: draft.category.trim() || null,
    metadata: {
      ...draft.metadata,
      sillytavern: {
        ...st,
        selective: draft.stSelective,
        probability: Number(draft.stProbability) || 0,
        useProbability: draft.stUseProbability,
        scanDepth: Number(draft.stScanDepth) || 0,
      },
    },
  };
}

function sillytavernMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  const value = metadata?.sillytavern;
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function WorldbookPanel(props: { bookId: string }) {
  const [entries, setEntries] = useState<WorldbookEntry[]>([]);
  const [editing, setEditing] = useState<"new" | string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [error, setError] = useState<string | null>(null);
  const [previewQuery, setPreviewQuery] = useState("");
  const [preview, setPreview] = useState<WorldbookPreviewResult | null>(null);

  const reload = useCallback(async () => {
    try {
      setEntries(await api.listWorldbook(props.bookId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [props.bookId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const sorted = useMemo(
    () => [...entries].sort((a, b) => b.priority - a.priority),
    [entries],
  );

  const submit = async () => {
    setError(null);
    try {
      const payload = toPayload(draft);
      if (!payload.title || !payload.content) {
        setError("title and content are required");
        return;
      }
      if (editing === "new") {
        await api.createWorldbookEntry(props.bookId, payload);
      } else if (draft.id) {
        await api.updateWorldbookEntry(props.bookId, draft.id, payload);
      }
      setEditing(null);
      setDraft(emptyDraft);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const remove = async (id: string) => {
    await api.deleteWorldbookEntry(props.bookId, id);
    await reload();
  };

  const runPreview = async () => {
    setError(null);
    try {
      setPreview(await api.previewWorldbook(props.bookId, { query: previewQuery }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const form = (
    <div
      data-testid="worldbook-form"
      style={{ border: "1px solid #ddd", borderRadius: 6, padding: 10, marginBottom: 10 }}
    >
      <label style={{ display: "block", fontSize: 12 }}>
        Title
        <input
          data-testid="worldbook-title"
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          style={{ width: "100%" }}
        />
      </label>
      <label style={{ display: "block", fontSize: 12, marginTop: 8 }}>
        Content
        <textarea
          data-testid="worldbook-content"
          value={draft.content}
          onChange={(e) => setDraft({ ...draft, content: e.target.value })}
          rows={5}
          style={{ width: "100%", resize: "vertical" }}
        />
      </label>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
        <label style={{ fontSize: 12 }}>
          Mode
          <select
            data-testid="worldbook-activation"
            value={draft.activation}
            onChange={(e) =>
              setDraft({
                ...draft,
                activation: e.target.value as Draft["activation"],
              })
            }
            style={{ width: "100%" }}
          >
            <option value="constant">Constant</option>
            <option value="triggered">Triggered</option>
          </select>
        </label>
        <label style={{ fontSize: 12 }}>
          Category
          <input
            value={draft.category}
            onChange={(e) => setDraft({ ...draft, category: e.target.value })}
            style={{ width: "100%" }}
          />
        </label>
        <label style={{ fontSize: 12 }}>
          Priority
          <input
            type="number"
            value={draft.priority}
            onChange={(e) => setDraft({ ...draft, priority: Number(e.target.value) })}
            style={{ width: "100%" }}
          />
        </label>
        <label style={{ fontSize: 12 }}>
          Depth
          <input
            type="number"
            min={0}
            value={draft.insertionDepth}
            onChange={(e) => setDraft({ ...draft, insertionDepth: Number(e.target.value) })}
            style={{ width: "100%" }}
          />
        </label>
      </div>
      <label style={{ display: "block", fontSize: 12, marginTop: 8 }}>
        Keys
        <input
          data-testid="worldbook-keys"
          value={draft.keys}
          onChange={(e) => setDraft({ ...draft, keys: e.target.value })}
          style={{ width: "100%" }}
        />
      </label>
      <label style={{ display: "block", fontSize: 12, marginTop: 8 }}>
        Secondary Keys
        <input
          value={draft.secondaryKeys}
          onChange={(e) => setDraft({ ...draft, secondaryKeys: e.target.value })}
          style={{ width: "100%" }}
        />
      </label>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 8 }}>
        <label style={{ fontSize: 12 }}>
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
          /> Enabled
        </label>
        <label style={{ fontSize: 12 }}>
          <input
            data-testid="worldbook-recursive"
            type="checkbox"
            checked={draft.recursive}
            onChange={(e) => setDraft({ ...draft, recursive: e.target.checked })}
          /> Recursive
        </label>
        <label style={{ fontSize: 12 }}>
          Limit
          <input
            type="number"
            min={0}
            value={draft.recursionLimit}
            onChange={(e) => setDraft({ ...draft, recursionLimit: Number(e.target.value) })}
            style={{ width: 64, marginLeft: 4 }}
          />
        </label>
      </div>
      <div style={{ borderTop: "1px solid #eee", marginTop: 10, paddingTop: 8 }}>
        <strong style={{ fontSize: 12 }}>SillyTavern</strong>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 6 }}>
          <label style={{ fontSize: 12 }}>
            <input
              data-testid="worldbook-st-selective"
              type="checkbox"
              checked={draft.stSelective}
              onChange={(e) => setDraft({ ...draft, stSelective: e.target.checked })}
            /> Selective
          </label>
          <label style={{ fontSize: 12 }}>
            <input
              type="checkbox"
              checked={draft.stUseProbability}
              onChange={(e) => setDraft({ ...draft, stUseProbability: e.target.checked })}
            /> Probability
          </label>
          <label style={{ fontSize: 12 }}>
            Probability %
            <input
              data-testid="worldbook-st-probability"
              type="number"
              min={0}
              max={100}
              value={draft.stProbability}
              onChange={(e) => setDraft({ ...draft, stProbability: Number(e.target.value) })}
              style={{ width: "100%" }}
            />
          </label>
          <label style={{ fontSize: 12 }}>
            Scan Depth
            <input
              data-testid="worldbook-st-scan-depth"
              type="number"
              min={0}
              value={draft.stScanDepth}
              onChange={(e) => setDraft({ ...draft, stScanDepth: Number(e.target.value) })}
              style={{ width: "100%" }}
            />
          </label>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button data-testid="worldbook-submit" onClick={() => void submit()}>
          Save
        </button>
        <button onClick={() => { setEditing(null); setDraft(emptyDraft); }}>
          Cancel
        </button>
      </div>
    </div>
  );

  return (
    <div data-testid="worldbook-panel">
      {error && <p role="alert" style={{ color: "#c00" }}>{error}</p>}
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <strong>Worldbook</strong>
        <button
          data-testid="worldbook-new"
          onClick={() => { setEditing("new"); setDraft(emptyDraft); }}
        >
          New
        </button>
      </div>
      <div style={{ border: "1px solid #eee", borderRadius: 6, padding: 8, marginBottom: 8 }}>
        <label style={{ display: "block", fontSize: 12 }}>
          Preview
          <input
            data-testid="worldbook-preview-query"
            value={previewQuery}
            onChange={(e) => setPreviewQuery(e.target.value)}
            style={{ width: "100%" }}
          />
        </label>
        <button
          data-testid="worldbook-preview-run"
          onClick={() => void runPreview()}
          style={{ marginTop: 6 }}
        >
          Run Preview
        </button>
        {preview?.diagnostics?.map((item) => (
          <p key={`${item.entryId}-${item.reason}`} style={{ margin: "4px 0", fontSize: 12 }}>
            {item.title}: {item.reason} / {item.matchedKeys.join(", ")}
          </p>
        ))}
      </div>
      {editing && form}
      {sorted.length === 0 && !editing && (
        <p data-testid="worldbook-empty" style={{ color: "#888" }}>No entries</p>
      )}
      {sorted.map((entry) => (
        <div
          key={entry.id}
          data-testid={`worldbook-entry-${entry.id}`}
          style={{ border: "1px solid #e5e5e5", borderRadius: 6, padding: 8, marginBottom: 8 }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <strong>{entry.title}</strong>
            <span style={{ display: "flex", gap: 4 }}>
              <button
                onClick={() => { setEditing(entry.id); setDraft(draftFromEntry(entry)); }}
              >
                Edit
              </button>
              <button onClick={() => void remove(entry.id)}>Delete</button>
            </span>
          </div>
          <p style={{ margin: "4px 0", whiteSpace: "pre-wrap" }}>{entry.content}</p>
          <p style={{ margin: 0, color: "#666", fontSize: 12 }}>
            {entry.activation} / priority {entry.priority}
            {entry.keys.length ? ` / ${entry.keys.join(", ")}` : ""}
          </p>
        </div>
      ))}
    </div>
  );
}
