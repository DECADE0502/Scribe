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
      <StyleReferenceSelector bookId={props.bookId} />
      <DeepestPromptOverride bookId={props.bookId} />
    </div>
  );
}

interface StyleReference {
  id: string;
  name: string;
  content: string;
}

function StyleReferenceSelector(props: { bookId: string }) {
  const [references, setReferences] = useState<StyleReference[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [tip, setTip] = useState(false);

  const reload = useCallback(async () => {
    try {
      const res = await fetch(`/api/books/${encodeURIComponent(props.bookId)}/style-reference`);
      if (!res.ok) return;
      const j = await res.json() as { selectedId: string; references: StyleReference[]; enabled?: boolean };
      setSelectedId(j.selectedId ?? "");
      setEnabled(j.enabled !== false);
      setReferences(Array.isArray(j.references) ? j.references : []);
    } catch { /* ignore */ }
  }, [props.bookId]);

  useEffect(() => { void reload(); }, [reload]);

  const save = async (nextEnabled = enabled) => {
    const res = await fetch(`/api/books/${encodeURIComponent(props.bookId)}/style-reference`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selectedId, enabled: nextEnabled }),
    });
    if (res.ok) {
      setTip(true);
      setTimeout(() => setTip(false), 2000);
    }
  };

  const current = references.find(ref => ref.id === selectedId);
  return (
    <div data-testid="style-reference-selector" style={{ marginTop: 20, paddingTop: 14, borderTop: "1px solid #e5e5e5" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>本书文风参考</span>
        <label style={{ fontSize: 12, color: "#555", display: "inline-flex", alignItems: "center", gap: 4 }}>
          <input
            data-testid="style-reference-enabled"
            type="checkbox"
            checked={enabled}
            onChange={(e) => { setEnabled(e.target.checked); void save(e.target.checked); }}
          /> 启用
        </label>
      </div>
      <p style={{ color: "#999", fontSize: 12, margin: "0 0 8px" }}>
        从全局设置页的文风参考中选择一组,写作 Agent 会按它规范正文风格。关掉则本书不注入文风(保留选择)。
      </p>
      {tip && <p data-testid="style-reference-saved-tip" style={{ color: "#080", fontSize: 12 }}>已保存</p>}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <select
          data-testid="style-reference-select"
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          style={{ flex: 1, padding: 7 }}
        >
          <option value="">不使用文风参考</option>
          {references.map(ref => <option key={ref.id} value={ref.id}>{ref.name}</option>)}
        </select>
        <button data-testid="style-reference-save" onClick={() => void save()}>保存</button>
      </div>
      {current && (
        <pre data-testid="style-reference-preview" style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 12.5, background: "rgba(0,0,0,0.03)", padding: 8, borderRadius: 6, marginTop: 8 }}>
          {current.content}
        </pre>
      )}
    </div>
  );
}

/**
 * 本书「最深处提示词」覆盖。空=用设置页的全局值;填了=本书优先。
 * 与 rules.md 区别:rules.md 是世界观/写作规则(注入在内置提示之后);
 * 最深处提示词原文拼在所有内置提示**最前端**,优先级最高。
 */
function DeepestPromptOverride(props: { bookId: string }) {
  const [perBook, setPerBook] = useState("");
  const [global, setGlobal] = useState("");
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [tip, setTip] = useState(false);

  const reload = useCallback(async () => {
    try {
      const res = await fetch(`/api/books/${encodeURIComponent(props.bookId)}/master-prompt`);
      if (!res.ok) return;
      const j = await res.json() as { perBook: string; global: string; enabled?: boolean };
      setPerBook(j.perBook ?? "");
      setGlobal(j.global ?? "");
      setEnabled(j.enabled !== false);
    } catch { /* 静默 */ }
  }, [props.bookId]);

  useEffect(() => { void reload(); }, [reload]);

  const save = async (opts?: { enabled?: boolean; perBook?: string }) => {
    const body: Record<string, unknown> = {};
    if (opts?.perBook !== undefined) body.perBook = opts.perBook;
    if (opts?.enabled !== undefined) body.enabled = opts.enabled;
    const res = await fetch(`/api/books/${encodeURIComponent(props.bookId)}/master-prompt`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      if (opts?.perBook !== undefined) { setPerBook(opts.perBook); setEditing(false); }
      setTip(true);
      setTimeout(() => setTip(false), 2000);
    }
  };

  const effective = enabled && (perBook.trim() || global.trim());
  return (
    <div data-testid="deepest-prompt-override" style={{ marginTop: 20, paddingTop: 14, borderTop: "1px solid #e5e5e5" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>本书最深处提示词</span>
        <label style={{ fontSize: 12, color: "#555", display: "inline-flex", alignItems: "center", gap: 4 }}>
          <input
            data-testid="deepest-enabled"
            type="checkbox"
            checked={enabled}
            onChange={(e) => { setEnabled(e.target.checked); void save({ enabled: e.target.checked }); }}
          /> 启用
        </label>
      </div>
      <p style={{ color: "#999", fontSize: 12, margin: "0 0 8px" }}>
        最高优先级指令,原文拼到所有内置提示最前端。留空则用全局设置;关掉则本书完全不注入(含全局)。
      </p>
      {tip && <p data-testid="deepest-saved-tip" style={{ color: "#080", fontSize: 12 }}>已保存</p>}
      {editing ? (
        <>
          <textarea
            data-testid="deepest-textarea"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={6}
            placeholder={global ? `留空将使用全局:\n${global.slice(0, 80)}${global.length > 80 ? "…" : ""}` : "例:全程第一人称、冷硬克制、每章留钩子……"}
            style={{ width: "100%", padding: 8, fontFamily: "inherit", fontSize: 13, lineHeight: 1.6 }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <button data-testid="deepest-save" onClick={() => void save({ perBook: draft })}>保存</button>
            <button onClick={() => setEditing(false)}>取消</button>
          </div>
        </>
      ) : (
        <>
          <button data-testid="deepest-edit" style={{ marginBottom: 6 }} onClick={() => { setDraft(perBook); setEditing(true); }}>
            编辑
          </button>
          {perBook.trim()
            ? <pre data-testid="deepest-content" style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 12.5, background: "rgba(0,0,0,0.03)", padding: 8, borderRadius: 6 }}>{perBook}</pre>
            : <p style={{ color: "#999", fontSize: 12 }}>
                {global.trim() ? "(未覆盖,当前使用全局设置)" : "(全局与本书都未设置)"}
              </p>}
          {!effective && null}
        </>
      )}
    </div>
  );
}
