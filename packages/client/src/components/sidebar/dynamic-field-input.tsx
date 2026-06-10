import { useState } from "react";

export interface GenreFieldDef {
  name: string;
  type: unknown; // string 字面量 | { kind: "enum", values: string[] }
  required?: boolean;
  values?: string[];
  description?: string;
}

export interface RefOptions {
  characters?: Array<{ id: string; name: string }>;
  sectionItems?: Record<string, Array<{ id: string; label: string }>>; // sectionName → items
}

export interface DynamicFieldInputProps {
  field: GenreFieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
  refOptions?: RefOptions;
}

function typeKind(t: unknown): string {
  if (typeof t === "object" && t !== null && (t as { kind?: string }).kind === "enum") return "enum-object";
  return String(t);
}

export function DynamicFieldInput(props: DynamicFieldInputProps) {
  const { field, value, onChange, refOptions } = props;
  const kind = typeKind(field.type);
  const testId = `field-${field.name}`;

  if (kind === "text") {
    return (
      <textarea
        data-testid={testId}
        value={String(value ?? "")}
        rows={3}
        style={{ width: "100%", padding: 4 }}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  if (kind === "number") {
    return (
      <input
        data-testid={testId}
        type="number"
        value={value == null ? "" : String(value)}
        style={{ width: "100%", padding: 4 }}
        onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
      />
    );
  }

  if (kind === "enum" || kind === "enum-object") {
    const values = kind === "enum-object"
      ? (field.type as { values: string[] }).values
      : field.values ?? [];
    return (
      <select
        data-testid={testId}
        value={String(value ?? "")}
        style={{ width: "100%", padding: 4 }}
        onChange={(e) => onChange(e.target.value || undefined)}
      >
        <option value="">(未选)</option>
        {values.map(v => <option key={v} value={v}>{v}</option>)}
      </select>
    );
  }

  if (kind === "ref:character") {
    return (
      <select
        data-testid={testId}
        value={String(value ?? "")}
        style={{ width: "100%", padding: 4 }}
        onChange={(e) => onChange(e.target.value || undefined)}
      >
        <option value="">(未选)</option>
        {(refOptions?.characters ?? []).map(c => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
    );
  }

  if (kind.startsWith("ref:section:")) {
    const sectionName = kind.slice("ref:section:".length);
    const items = refOptions?.sectionItems?.[sectionName] ?? [];
    return (
      <select
        data-testid={testId}
        value={String(value ?? "")}
        style={{ width: "100%", padding: 4 }}
        onChange={(e) => onChange(e.target.value || undefined)}
      >
        <option value="">(未选)</option>
        {items.map(i => <option key={i.id} value={i.id}>{i.label}</option>)}
      </select>
    );
  }

  if (kind.startsWith("list:")) {
    return <ListInput {...props} innerKind={kind.slice("list:".length)} testId={testId} />;
  }

  // 默认:string
  return (
    <input
      data-testid={testId}
      type="text"
      value={String(value ?? "")}
      style={{ width: "100%", padding: 4 }}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function ListInput(props: DynamicFieldInputProps & { innerKind: string; testId: string }) {
  const list = Array.isArray(props.value) ? props.value as unknown[] : [];
  const [draft, setDraft] = useState("");

  const addItem = () => {
    if (!draft.trim()) return;
    const v = props.innerKind === "number" ? Number(draft) : draft.trim();
    props.onChange([...list, v]);
    setDraft("");
  };

  return (
    <div data-testid={props.testId}>
      {list.map((item, i) => (
        <span
          key={i}
          style={{
            display: "inline-flex", alignItems: "center", gap: 2,
            background: "#eef", borderRadius: 4, padding: "1px 6px",
            marginRight: 4, marginBottom: 4, fontSize: 12,
          }}
        >
          {String(item)}
          <button
            data-testid={`${props.testId}-remove-${i}`}
            style={{ border: "none", background: "transparent", padding: 0, color: "#c00" }}
            onClick={() => props.onChange(list.filter((_, j) => j !== i))}
          >
            ×
          </button>
        </span>
      ))}
      <span style={{ display: "flex", gap: 4 }}>
        <input
          data-testid={`${props.testId}-draft`}
          value={draft}
          style={{ flex: 1, padding: 4 }}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button data-testid={`${props.testId}-add`} onClick={addItem}>+</button>
      </span>
    </div>
  );
}
