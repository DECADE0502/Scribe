import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { t } from "../../i18n/zh-CN.js";
import { ChapterEditor } from "./chapter-editor.js";
import { SelectionToolbar, actionToInstruction, type ReviseAction } from "./selection-toolbar.js";
import { RevisePreview } from "./revise-preview.js";
import { VersionHistory } from "./version-history.js";
import { useToastStore } from "../../stores/toast.js";
import { useConversationStore } from "../../stores/conversation.js";

interface ChapterMeta {
  chapterNo: number;
  title: string;
  content: string;
  wordCount: number;
}

export function EditorPane(props: { bookId: string }) {
  const { bookId } = props;
  const pushToast = useToastStore(s => s.push);
  const chapterRefreshTrigger = useConversationStore(s => s.chapterRefreshTrigger);
  const [chapters, setChapters] = useState<ChapterMeta[]>([]);
  const [currentNo, setCurrentNo] = useState<number | null>(null);
  const [current, setCurrent] = useState<ChapterMeta | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [revise, setRevise] = useState<{ segmentText: string; instruction: string } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [loading, setLoading] = useState(true);
  const [writingDraft, setWritingDraft] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [hasAudit, setHasAudit] = useState(false);

  // 用 ref 拿 currentNo，避免 reloadList 依赖 currentNo 导致 stale closure 和 effect 重跑
  const currentNoRef = useRef<number | null>(null);
  useEffect(() => { currentNoRef.current = currentNo; }, [currentNo]);

  const reloadList = useCallback(async (switchToLatest = false) => {
    try {
      const res = await fetch(`/api/books/${encodeURIComponent(bookId)}/chapters`);
      if (!res.ok) return;
      const j = await res.json() as { chapters: ChapterMeta[] };
      setChapters(j.chapters);
      const cur = currentNoRef.current;
      if (j.chapters.length > 0) {
        if (switchToLatest || cur == null) {
          setCurrentNo(j.chapters[j.chapters.length - 1]!.chapterNo);
        } else if (!j.chapters.some(c => c.chapterNo === cur)) {
          // 当前章已被删除，切到最新章
          setCurrentNo(j.chapters[j.chapters.length - 1]!.chapterNo);
        }
      } else {
        setCurrentNo(null);
      }
    } finally {
      setLoading(false);
    }
  }, [bookId]);

  useEffect(() => { void reloadList(); }, [reloadList]);

  // 监听对话流程的章节刷新通知:对话写完一章后自动刷新编辑器并跳到最新章
  // 用 ref 记录上次处理过的 trigger 值，只在 trigger 真正递增时才刷
  const lastRefreshTrigger = useRef(0);
  useEffect(() => {
    if (chapterRefreshTrigger > lastRefreshTrigger.current) {
      lastRefreshTrigger.current = chapterRefreshTrigger;
      void reloadList(true);
    }
  }, [chapterRefreshTrigger, reloadList]);

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

  const runDraft = useCallback(async (targetNo: number, mode: "next" | "rewrite") => {
    const userIntent = window.prompt("写什么？(一句话描述本章意图)") ?? "";
    if (!userIntent.trim()) return;
    setWritingDraft(true);
    try {
      const res = await fetch(`/api/books/${encodeURIComponent(bookId)}/chapters/${targetNo}/write-draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userIntent: mode === "rewrite" ? `重写第 ${targetNo} 章。${userIntent}` : userIntent,
        }),
      });
      if (!res.ok || !res.body) { pushToast({ level: "error", text: "写作失败" }); return; }
      // 读取 SSE 流
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
      }
      await reloadList();
      setCurrentNo(targetNo);
      setHasAudit(false);
      pushToast({ level: "info", text: "正文已生成,确认后点击「确认本章」" });
    } finally {
      setWritingDraft(false);
    }
  }, [bookId, reloadList, pushToast]);

  const writeDraft = useCallback(async () => {
    const next = chapters.length ? Math.max(...chapters.map(c => c.chapterNo)) + 1 : 1;
    await runDraft(next, "next");
  }, [chapters, runDraft]);

  const rewriteCurrent = useCallback(async () => {
    if (currentNo == null) return;
    await runDraft(currentNo, "rewrite");
  }, [currentNo, runDraft]);

  const finalizeChapter = useCallback(async () => {
    if (currentNo == null) return;
    const userIntent = window.prompt("本章意图(用于审计上下文,可留空)") ?? "";
    setFinalizing(true);
    try {
      const res = await fetch(`/api/books/${encodeURIComponent(bookId)}/chapters/${currentNo}/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIntent }),
      });
      if (!res.ok || !res.body) { pushToast({ level: "error", text: "确认失败" }); return; }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
      setHasAudit(true);
      pushToast({ level: "info", text: "本章已确认:审计+状态记录完成" });
    } finally {
      setFinalizing(false);
    }
  }, [bookId, currentNo, pushToast]);

  const deleteCurrentAndAfter = useCallback(async () => {
    if (currentNo == null) return;
    const tail = chapters.filter(c => c.chapterNo >= currentNo);
    const confirmMsg = tail.length === 1
      ? `确认删除第 ${currentNo} 章？\n该章及其所有派生记录（摘要/审查/时间线/伏笔/角色出场）都会被清除。`
      : `确认删除第 ${currentNo} 章及之后的 ${tail.length} 章？\n这些章及所有派生记录（摘要/审查/时间线/伏笔/角色出场）都会被清除。`;
    if (!window.confirm(confirmMsg)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/books/${encodeURIComponent(bookId)}/chapters/${currentNo}`, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string };
        pushToast({ level: "error", text: j.error ?? "删除失败" });
        return;
      }
      const { result } = await res.json() as { result: { affectedCharacterNames: string[] } };
      await reloadList();
      pushToast({ level: "info", text: `已删除第 ${currentNo} 章及之后所有章` });
      if (result.affectedCharacterNames.length > 0) {
        pushToast({ level: "warning", text: `${result.affectedCharacterNames.join("、")} 的状态是累积写入的，请到侧栏手动核对` });
      }
    } finally {
      setDeleting(false);
    }
  }, [bookId, currentNo, chapters, reloadList, pushToast]);

  const deleteAll = useCallback(async () => {
    if (chapters.length === 0) return;
    if (!window.confirm(`确认删除全部 ${chapters.length} 章？\n所有章及派生记录都会被清除，相当于回到书初状态。`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/books/${encodeURIComponent(bookId)}/chapters`, { method: "DELETE" });
      if (!res.ok) { pushToast({ level: "error", text: "删除失败" }); return; }
      await reloadList();
      pushToast({ level: "info", text: "已删除所有章节" });
    } finally {
      setDeleting(false);
    }
  }, [bookId, chapters, reloadList, pushToast]);

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
        <button
          className="ios-btn-small"
          data-testid="btn-write-draft"
          onClick={() => void writeDraft()}
          disabled={writingDraft}
          style={{ fontWeight: 600 }}
        >
          {writingDraft ? "写作中..." : "AI 写下一章"}
        </button>
        {currentNo != null && (
          <button
            className="ios-btn-small"
            data-testid="btn-rewrite-current"
            onClick={() => void rewriteCurrent()}
            disabled={writingDraft}
            style={{ fontWeight: 600 }}
          >
            {writingDraft ? "写作中..." : `重新写第${currentNo}章`}
          </button>
        )}
        {currentNo != null && !hasAudit && (
          <button
            className="ios-btn-small"
            data-testid="btn-finalize"
            onClick={() => void finalizeChapter()}
            disabled={finalizing}
            style={{ fontWeight: 600, color: "#007aff" }}
          >
            {finalizing ? "确认中..." : "确认本章"}
          </button>
        )}
        {currentNo != null && hasAudit && (
          <span style={{ fontSize: 11, color: "#34c759", alignSelf: "center" }}>已确认</span>
        )}
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
            <button
              className="ios-btn-small"
              data-testid="btn-delete-chapter"
              onClick={() => void deleteCurrentAndAfter()}
              disabled={deleting}
              style={{ color: "#ff3b30", fontWeight: 600 }}
              title={`删除第 ${currentNo} 章及之后所有章`}
            >
              {deleting ? "删除中..." : `删除第${currentNo}章起`}
            </button>
            {chapters.length > 0 && (
              <button
                className="ios-btn-small"
                data-testid="btn-delete-all"
                onClick={() => void deleteAll()}
                disabled={deleting}
                style={{ color: "#ff3b30" }}
                title="删除所有章节"
              >
                全删
              </button>
            )}
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
