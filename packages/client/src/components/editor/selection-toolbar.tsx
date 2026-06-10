import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import { t } from "../../i18n/zh-CN.js";

export type ReviseAction = "rewrite" | "simplify" | "intensify" | "custom";

export interface SelectionToolbarProps {
  editor: Editor | null;
  onRevise: (action: ReviseAction, selectedText: string) => void;
}

const ACTION_LABELS: Record<Exclude<ReviseAction, "custom">, string> = {
  rewrite: "改写",
  simplify: "简化",
  intensify: "增强情绪",
};

export function SelectionToolbar(props: SelectionToolbarProps) {
  const { editor } = props;
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [selectedText, setSelectedText] = useState("");

  useEffect(() => {
    if (!editor) return;
    const handler = () => {
      const sel = editor.state.selection;
      if (sel.empty) {
        setShow(false);
        return;
      }
      const text = editor.state.doc.textBetween(sel.from, sel.to, "\n");
      if (!text.trim()) {
        setShow(false);
        return;
      }
      setSelectedText(text);
      try {
        const coords = editor.view.coordsAtPos(sel.from);
        setPos({ x: coords.left, y: Math.max(0, coords.top - 40) });
      } catch {
        setPos({ x: 0, y: 0 }); // jsdom 下 coordsAtPos 可能不可用
      }
      setShow(true);
    };
    editor.on("selectionUpdate", handler);
    return () => { editor.off("selectionUpdate", handler); };
  }, [editor]);

  if (!show) return null;

  return (
    <div
      data-testid="selection-toolbar"
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        zIndex: 50,
        display: "flex",
        gap: 4,
        background: "#fff",
        border: "1px solid #ccc",
        borderRadius: 6,
        padding: 4,
        boxShadow: "0 2px 8px rgba(0,0,0,.12)",
      }}
    >
      {(Object.keys(ACTION_LABELS) as Array<keyof typeof ACTION_LABELS>).map(action => (
        <button
          key={action}
          data-testid={`revise-${action}`}
          style={{ padding: "2px 8px", fontSize: 12 }}
          onClick={() => props.onRevise(action, selectedText)}
        >
          {ACTION_LABELS[action]}
        </button>
      ))}
      <button
        data-testid="revise-custom"
        style={{ padding: "2px 8px", fontSize: 12 }}
        onClick={() => props.onRevise("custom", selectedText)}
      >
        自定义指令
      </button>
    </div>
  );
}

/** 预设动作 → 中文指令 */
export function actionToInstruction(action: ReviseAction, custom?: string): string {
  switch (action) {
    case "rewrite": return "改写这一段,保持文意但提升表达质量。";
    case "simplify": return "简化这一段,删去冗余,句子更短。";
    case "intensify": return "增强这一段的情绪张力,用身体感知和动作替代直白的情绪词。";
    case "custom": return custom ?? "";
  }
}

export { t };
