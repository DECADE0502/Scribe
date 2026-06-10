import { useCallback, useEffect, useState } from "react";
import { t } from "../../i18n/zh-CN.js";
import { DiffView } from "./diff-view.js";

interface ChapterVersion {
  id: number;
  chapterNo: number;
  versionNo: number;
  source: string;
  contentMd: string;
  createdAt: number;
}

const SOURCE_LABELS: Record<string, string> = {
  ai_write: "AI 写",
  ai_rewrite: "AI 修复",
  user_edit: "用户编辑",
  segment_revise: "段落改写",
};

export interface VersionHistoryProps {
  bookId: string;
  chapterNo: number;
  onRestored?: (content: string) => void;
}

export function VersionHistory(props: VersionHistoryProps) {
  const [versions, setVersions] = useState<ChapterVersion[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/books/${encodeURIComponent(props.bookId)}/chapters/${props.chapterNo}/versions`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json() as { versions: ChapterVersion[] };
      setVersions(j.versions);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [props.bookId, props.chapterNo]);

  useEffect(() => { void reload(); }, [reload]);

  const restore = async (versionNo: number) => {
    if (!window.confirm(`回滚到第 ${versionNo} 版?当前内容会被保留为历史版本。`)) return;
    try {
      const res = await fetch(
        `/api/books/${encodeURIComponent(props.bookId)}/chapters/${props.chapterNo}/restore-version`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ versionNo }),
        },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const target = versions.find(v => v.versionNo === versionNo);
      if (target) props.onRestored?.(target.contentMd);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const wordCount = (s: string) => (s.match(/[一-龥]/g)?.length ?? 0);

  return (
    <div data-testid="version-history">
      <h3 style={{ margin: "0 0 8px", fontSize: 14 }}>{t.editor.history}</h3>
      {error && <p role="alert" style={{ color: "#c00" }}>{error}</p>}
      {versions.length === 0 && <p style={{ color: "#999" }}>{t.common.empty}</p>}
      {versions.map((v, idx) => {
        const prev = versions[idx + 1];
        const delta = prev ? wordCount(v.contentMd) - wordCount(prev.contentMd) : wordCount(v.contentMd);
        return (
          <div
            key={v.id}
            data-testid={`version-row-${v.versionNo}`}
            style={{ border: "1px solid #e5e5e5", borderRadius: 6, padding: 8, marginBottom: 6 }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <button
                style={{ border: "none", background: "transparent", padding: 0, fontWeight: 600 }}
                onClick={() => setExpanded(expanded === v.versionNo ? null : v.versionNo)}
              >
                v{v.versionNo}
                <span style={{ fontWeight: 400, color: "#888", marginLeft: 6, fontSize: 12 }}>
                  {SOURCE_LABELS[v.source] ?? v.source} · {new Date(v.createdAt).toLocaleString("zh-CN")} ·
                  {delta >= 0 ? ` +${delta}` : ` ${delta}`} 字
                </span>
              </button>
              {idx !== 0 && (
                <button
                  data-testid={`version-restore-${v.versionNo}`}
                  style={{ fontSize: 12, padding: "2px 8px" }}
                  onClick={() => void restore(v.versionNo)}
                >
                  回滚
                </button>
              )}
            </div>
            {expanded === v.versionNo && (
              <div style={{ marginTop: 8, maxHeight: 300, overflow: "auto" }}>
                <DiffView a={prev?.contentMd ?? ""} b={v.contentMd} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
