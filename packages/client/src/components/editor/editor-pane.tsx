import { useCallback, useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import { t } from "../../i18n/zh-CN.js";
import { ChapterEditor } from "./chapter-editor.js";
import { SelectionToolbar, actionToInstruction, type ReviseAction } from "./selection-toolbar.js";
import { RevisePreview } from "./revise-preview.js";
import { VersionHistory } from "./version-history.js";
import { useToastStore } from "../../stores/toast.js";

interface ChapterMeta {
  chapterNo: number;
  title: string;
  content: string;
  wordCount: number;
}

export function EditorPane(props: { bookId: string }) {
  const { bookId } = props;
  const pushToast = useToastStore(s => s.push);
  const [chapters, setChapters] = useState<ChapterMeta[]>([]);
  const [currentNo, setCurrentNo] = useState<number | null>(null);
  const [current, setCurrent] = useState<ChapterMeta | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [revise, setRevise] = useState<{ segmentText: string; instruction: string } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [loading, setLoading] = useState(true);

  const reloadList = useCallback(async () => {
    try {
      const res = await fetch(`/api/books/${encodeURIComponent(bookId)}/chapters`);
      if (!res.ok) return;
      const j = await res.json() as { chapters: ChapterMeta[] };
      setChapters(j.chapters);
      if (j.chapters.length > 0 && currentNo == null) {
        setCurrentNo(j.chapters[j.chapters.length - 1]!.chapterNo);
      }
    } finally {
      setLoading(false);
    }
  }, [bookId, currentNo]);

  useEffect(() => { void reloadList(); }, [reloadList]);

  // 加载当前章节内容
  useEffect(() => {
    if (currentNo == null) { setCurrent(null); return; }
    void (async () => {
      const res = await fetch(`/api/books/${encodeURIComponent(bookId)}/chapters/${currentNo}`);
      if (res.ok) setCurrent(await res.json() as ChapterMeta);
    })();
  }, [bookId, currentNo]);

  const save = useCallback(async (md: string) => {
    if (currentNo == null) return;
    const res = await fetch(`/api/books/${encodeURIComponent(bookId)}/chapters/${currentNo}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: md }),
    });
    if (!res.ok) pushToast({ level: "error", text: t.errors.saveFailed });
  }, [bookId, currentNo, pushToast]);

  const newChapter = useCallback(async () => {
    const next = chapters.length ? Math.max(...chapters.map(c => c.chapterNo)) + 1 : 1;
    const res = await fetch(`/api/books/${encodeURIComponent(bookId)}/chapters/${next}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: `第 ${next} 章正文从这里开始…`, title: `第${next}章` }),
    });
    if (res.ok) {
      await reloadList();
      setCurrentNo(next);
    }
  }, [bookId, chapters, reloadList]);

  const onRevise = useCallback((action: ReviseAction, selectedText: string) => {
    let instruction = actionToInstruction(action);
    if (action === "custom") {
      const typed = window.prompt("输入改写指令(如:更克制、删掉心理描写):");
      if (!typed?.trim()) return;
      instruction = typed.trim();
    }
    setRevise({ segmentText: selectedText, instruction });
  }, []);

  const exportBook = useCallback(async (format: "md" | "txt", chapterOnly: boolean) => {
    const body: Record<string, unknown> = { format };
    if (chapterOnly && currentNo != null) body.chapter = currentNo;
    const res = await fetch(`/api/books/${encodeURIComponent(bookId)}/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({})) as { error?: string };
      pushToast({ level: "error", text: j.error ?? t.errors.unknown });
      return;
    }
    const { filename } = await res.json() as { filename: string };
    window.open(`/api/books/${encodeURIComponent(bookId)}/exports/${encodeURIComponent(filename)}`, "_blank");
  }, [bookId, currentNo, pushToast]);

  if (loading) {
    return <div className="pane-center muted" data-testid="editor-loading">{t.app.loading}</div>;
  }

  return (
    <div data-testid="editor-pane" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* 章节条 */}
      <div className="chapter-strip" data-testid="chapter-strip">
        {chapters.map(ch => (
          <button
            key={ch.chapterNo}
            data-testid={`chapter-tab-${ch.chapterNo}`}
            className={`chapter-chip${ch.chapterNo === currentNo ? " active" : ""}`}
            onClick={() => setCurrentNo(ch.chapterNo)}
          >
            第{ch.chapterNo}章
          </button>
        ))}
        <button className="chapter-chip add" data-testid="chapter-new" onClick={() => void newChapter()}>
          +
        </button>
        <span style={{ flex: 1 }} />
        {currentNo != null && (
          <>
            <button className="ios-btn-small" data-testid="btn-history" onClick={() => setShowHistory(v => !v)}>
              {t.editor.history}
            </button>
            <button className="ios-btn-small" onClick={() => void exportBook("md", true)}>
              {t.editor.exportMd}
            </button>
            <button className="ios-btn-small" onClick={() => void exportBook("txt", false)}>
              全书 txt
            </button>
          </>
        )}
      </div>

      {/* 主体 */}
      {currentNo == null ? (
        <div className="pane-center" data-testid="editor-empty">
          <div style={{ textAlign: "center", maxWidth: 320 }}>
            <p style={{ fontSize: 40, margin: 0 }}>✍️</p>
            <p className="muted" style={{ lineHeight: 1.8 }}>
              还没有章节。<br />
              点上方 <strong>+</strong> 手动新建,<br />
              或在左侧对话框输入 <code>/write</code> 让 AI 写第一章。
            </p>
          </div>
        </div>
      ) : showHistory ? (
        <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
          <VersionHistory
            bookId={bookId}
            chapterNo={currentNo}
            onRestored={() => {
              setShowHistory(false);
              setCurrentNo(null);
              setTimeout(() => setCurrentNo(currentNo), 0); // 强制重载
            }}
          />
        </div>
      ) : current ? (
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
            <ChapterEditor
              key={`${current.chapterNo}-${current.content.length}`}
              chapter={current}
              onSave={(md) => void save(md)}
              onEditorReady={setEditor}
            />
          </div>
          <SelectionToolbar editor={editor} onRevise={onRevise} />
          {revise && (
            <RevisePreview
              bookId={bookId}
              chapterNo={current.chapterNo}
              segmentText={revise.segmentText}
              instruction={revise.instruction}
              onAccepted={(newContent) => {
                setRevise(null);
                setCurrent({ ...current, content: newContent });
              }}
              onDismiss={() => setRevise(null)}
            />
          )}
        </div>
      ) : (
        <div className="pane-center muted">{t.app.loading}</div>
      )}
    </div>
  );
}
