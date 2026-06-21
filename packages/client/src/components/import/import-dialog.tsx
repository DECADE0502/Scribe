import { useState } from "react";
import { api, type ImportPreview } from "../../api/client.js";

function readFileText(file: File): Promise<string> {
  if (typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("读取文件失败"));
    reader.readAsText(file);
  });
}

export function ImportDialog(props: { bookId: string; onImported: () => void }) {
  const [filename, setFilename] = useState("");
  const [json, setJson] = useState<unknown>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File | undefined) {
    setError(null);
    setPreview(null);
    if (!file) return;
    try {
      const parsed = JSON.parse(await readFileText(file));
      setFilename(file.name);
      setJson(parsed);
      setPreview(await api.previewImport(props.bookId, {
        filename: file.name,
        json: parsed,
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function confirm() {
    if (!filename) return;
    await api.importJson(props.bookId, { filename, json });
    props.onImported();
  }

  return (
    <section data-testid="import-dialog" style={{ display: "grid", gap: 8 }}>
      <strong>导入</strong>
      {error && <p role="alert" style={{ color: "#c00" }}>{error}</p>}
      <input
        data-testid="import-file"
        type="file"
        accept="application/json,.json"
        onChange={(event) => void onFile(event.target.files?.[0])}
      />
      {preview && (
        <div style={{ border: "1px solid #e5e5e5", borderRadius: 6, padding: 8 }}>
          <strong>{preview.sourceType}</strong>
          <p style={{ margin: "4px 0" }}>{preview.sourceName}</p>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>
            {JSON.stringify(preview.stats, null, 2)}
          </pre>
          {preview.warnings.map((warning) => (
            <p key={`${warning.code}-${warning.path ?? ""}`} style={{ color: "#8a5a00" }}>
              {warning.code}: {warning.message}
            </p>
          ))}
          <button data-testid="import-confirm" onClick={() => void confirm()}>
            确认导入
          </button>
        </div>
      )}
    </section>
  );
}
