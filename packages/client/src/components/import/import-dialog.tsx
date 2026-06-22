import { useEffect, useState } from "react";
import { api, type ImportPreview, type SampleImport } from "../../api/client.js";

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
  const [samples, setSamples] = useState<SampleImport[]>([]);
  const [importingSample, setImportingSample] = useState<string | null>(null);
  const [sampleDone, setSampleDone] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try { setSamples(await api.listSampleImports()); } catch { /* 忽略 */ }
    })();
  }, []);

  async function importSample(id: string) {
    setError(null);
    setSampleDone(null);
    setImportingSample(id);
    try {
      const r = await api.importSample(props.bookId, id);
      setSampleDone(`已导入:预设 ${r.imported.promptPresets} / 提示块 ${r.imported.promptBlocks} / 世界书 ${r.imported.worldbookEntries}`);
      props.onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImportingSample(null);
    }
  }

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

      {samples.length > 0 && (
        <div data-testid="sample-imports" style={{ border: "1px solid #e5e5e5", borderRadius: 6, padding: 8, display: "grid", gap: 8 }}>
          <strong style={{ fontSize: 13 }}>内置示例(一键导入)</strong>
          {sampleDone && <p style={{ color: "#080", fontSize: 12, margin: 0 }}>{sampleDone}</p>}
          {samples.map((s) => (
            <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{s.name} <span style={{ color: "#999", fontWeight: 400 }}>· {s.sourceType}</span></div>
                <div style={{ fontSize: 12, color: "#888" }}>{s.description}</div>
              </div>
              <button
                data-testid={`sample-import-${s.id}`}
                disabled={importingSample !== null}
                onClick={() => void importSample(s.id)}
              >
                {importingSample === s.id ? "导入中…" : "导入"}
              </button>
            </div>
          ))}
        </div>
      )}

      <p style={{ fontSize: 12, color: "#999", margin: "4px 0 0" }}>或从文件导入 SillyTavern 预设/世界书 JSON:</p>
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
