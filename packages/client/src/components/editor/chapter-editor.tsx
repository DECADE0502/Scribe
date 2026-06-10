import { useEffect, useMemo, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import CharacterCount from "@tiptap/extension-character-count";
import { t } from "../../i18n/zh-CN.js";
import { mdToHtml, htmlToMd } from "./markdown-bridge.js";

export interface ChapterData {
  chapterNo: number;
  title: string;
  content: string; // markdown
}

export interface ChapterEditorProps {
  chapter: ChapterData;
  onSave: (md: string) => void;
  /** 节流毫秒,默认 1500;测试可调小 */
  throttleMs?: number;
  /** 测试钩子:拿到 editor 实例 */
  onEditorReady?: (editor: NonNullable<ReturnType<typeof useEditor>>) => void;
}

export function ChapterEditor(props: ChapterEditorProps) {
  const throttleMs = props.throttleMs ?? 1500;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestHtmlRef = useRef<string | null>(null);
  const onSaveRef = useRef(props.onSave);
  onSaveRef.current = props.onSave;

  const initialHtml = useMemo(() => mdToHtml(props.chapter.content), [props.chapter.chapterNo]);

  const editor = useEditor({
    extensions: [StarterKit, CharacterCount],
    content: initialHtml,
    onUpdate({ editor }) {
      latestHtmlRef.current = editor.getHTML();
      if (timerRef.current) return; // 节流:窗口内只触发一次
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        if (latestHtmlRef.current != null) {
          onSaveRef.current(htmlToMd(latestHtmlRef.current));
        }
      }, throttleMs);
    },
  });

  // 卸载时清理定时器并落最后一次保存
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
        if (latestHtmlRef.current != null) {
          onSaveRef.current(htmlToMd(latestHtmlRef.current));
        }
      }
    };
  }, []);

  // 测试钩子
  const onReadyRef = useRef(props.onEditorReady);
  onReadyRef.current = props.onEditorReady;
  useEffect(() => {
    if (editor) onReadyRef.current?.(editor);
  }, [editor]);

  const charCount: number = editor?.storage.characterCount.characters() ?? 0;

  return (
    <div data-testid="chapter-editor" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 16px",
          borderBottom: "1px solid #eee",
        }}
      >
        <h2 style={{ margin: 0, fontSize: 16 }} data-testid="chapter-title">
          {props.chapter.title}
        </h2>
        <span data-testid="char-count" style={{ color: "#999", fontSize: 12 }}>
          {charCount} 字
        </span>
      </header>
      <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
        {editor
          ? <EditorContent editor={editor} data-testid="editor-content" />
          : <p style={{ color: "#999" }}>{t.app.loading}</p>}
      </div>
    </div>
  );
}
