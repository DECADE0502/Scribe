import { useCallback, useEffect, useState } from "react";
import { t } from "../../i18n/zh-CN.js";
import { DynamicFieldInput, type GenreFieldDef, type RefOptions } from "./dynamic-field-input.js";

interface GenreSection {
  id: string;
  name: string;
  schema: GenreFieldDef[];
}

interface GenreSectionItem {
  id: string;
  sectionId: string;
  data: Record<string, unknown>;
}

interface SectionWithItems {
  section: GenreSection;
  items: GenreSectionItem[];
}

export function GenreSectionPanel(props: { bookId: string; sectionId: string }) {
  const [sections, setSections] = useState<SectionWithItems[]>([]);
  const [characters, setCharacters] = useState<Array<{ id: string; name: string }>>([]);
  const [editingItem, setEditingItem] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [secRes, charRes] = await Promise.all([
        fetch(`/api/books/${encodeURIComponent(props.bookId)}/genre-sections`),
        fetch(`/api/books/${encodeURIComponent(props.bookId)}/characters`),
      ]);
      if (!secRes.ok) throw new Error(`HTTP ${secRes.status}`);
      const secJ = await secRes.json() as { sections: SectionWithItems[] };
      setSections(secJ.sections);
      if (charRes.ok) {
        const charJ = await charRes.json() as { characters: Array<{ id: string; name: string }> };
        setCharacters(charJ.characters);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [props.bookId]);

  useEffect(() => { void reload(); }, [reload]);

  const current = sections.find(s => s.section.id === props.sectionId);
  if (!current) {
    return <p data-testid="genre-section-missing" style={{ color: "#999" }}>{t.common.empty}</p>;
  }
  const { section, items } = current;

  const refOptions: RefOptions = {
    characters,
    sectionItems: Object.fromEntries(
      sections.map(s => [
        s.section.name,
        s.items.map(i => ({
          id: i.id,
          label: String(i.data.name ?? i.data.label ?? i.id),
        })),
      ]),
    ),
  };

  const submit = async () => {
    setError(null);
    try {
      const isNew = editingItem === "new";
      const url = isNew
        ? `/api/books/${encodeURIComponent(props.bookId)}/genre-sections/${section.id}/items`
        : `/api/books/${encodeURIComponent(props.bookId)}/genre-sections/items/${editingItem}`;
      const res = await fetch(url, {
        method: isNew ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: draft }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      setEditingItem(null);
      setDraft({});
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const removeItem = async (itemId: string) => {
    if (!window.confirm("删除该条目?")) return;
    try {
      const res = await fetch(`/api/books/${encodeURIComponent(props.bookId)}/genre-sections/items/${itemId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const deleteSection = async () => {
    const typed = window.prompt(`输入板块名「${section.name}」以确认删除(含全部条目):`);
    if (typed !== section.name) return;
    try {
      const res = await fetch(`/api/books/${encodeURIComponent(props.bookId)}/genre-sections/${section.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const renderForm = () => (
    <div data-testid="genre-item-form" style={{ border: "1px dashed #aac", borderRadius: 6, padding: 8, marginBottom: 8 }}>
      {section.schema.map(field => (
        <div key={field.name} style={{ marginBottom: 6 }}>
          <label style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 2 }}>
            {field.name}{field.required ? " *" : ""}
          </label>
          <DynamicFieldInput
            field={field}
            value={draft[field.name]}
            onChange={(v) => setDraft(prev => ({ ...prev, [field.name]: v }))}
            refOptions={refOptions}
          />
        </div>
      ))}
      <div style={{ display: "flex", gap: 8 }}>
        <button data-testid="genre-item-submit" onClick={() => void submit()}>{t.common.save}</button>
        <button onClick={() => { setEditingItem(null); setDraft({}); }}>{t.common.cancel}</button>
      </div>
    </div>
  );

  return (
    <div data-testid={`genre-section-panel-${section.id}`}>
      {error && <p role="alert" style={{ color: "#c00" }}>{error}</p>}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <strong>{section.name}</strong>
        <span style={{ display: "flex", gap: 4 }}>
          <button
            data-testid="genre-item-new"
            style={{ fontSize: 12 }}
            onClick={() => { setEditingItem("new"); setDraft({}); }}
          >
            {t.sidebar.addItem}
          </button>
          <button
            data-testid="genre-section-delete"
            style={{ fontSize: 12, color: "#c00" }}
            onClick={() => void deleteSection()}
          >
            {t.sidebar.deleteSection}
          </button>
        </span>
      </div>

      {editingItem === "new" && renderForm()}

      {items.length === 0 && editingItem !== "new" && (
        <p data-testid="genre-items-empty" style={{ color: "#999" }}>{t.common.empty}</p>
      )}
      {items.map(item => (
        <div
          key={item.id}
          data-testid={`genre-item-${item.id}`}
          style={{ border: "1px solid #e5e5e5", borderRadius: 6, padding: 6, marginBottom: 6, fontSize: 13 }}
        >
          {editingItem === item.id ? renderForm() : (
            <>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <strong>{String(item.data.name ?? item.data.label ?? "(未命名)")}</strong>
                <span style={{ display: "flex", gap: 4 }}>
                  <button
                    data-testid={`genre-item-edit-${item.id}`}
                    style={{ fontSize: 11, padding: "1px 6px" }}
                    onClick={() => { setEditingItem(item.id); setDraft({ ...item.data }); }}
                  >
                    {t.common.edit}
                  </button>
                  <button
                    data-testid={`genre-item-delete-${item.id}`}
                    style={{ fontSize: 11, padding: "1px 6px", color: "#c00" }}
                    onClick={() => void removeItem(item.id)}
                  >
                    {t.common.delete}
                  </button>
                </span>
              </div>
              {section.schema
                .filter(f => f.name !== "name" && item.data[f.name] !== undefined && item.data[f.name] !== null)
                .map(f => (
                  <p key={f.name} style={{ margin: "2px 0", color: "#666" }}>
                    <span style={{ color: "#999" }}>{f.name}:</span>
                    {Array.isArray(item.data[f.name])
                      ? (item.data[f.name] as unknown[]).map(String).join("、")
                      : String(item.data[f.name])}
                  </p>
                ))}
            </>
          )}
        </div>
      ))}
    </div>
  );
}
