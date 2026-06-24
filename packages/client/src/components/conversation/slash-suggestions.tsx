import { useEffect, useState } from "react";
import { matchSlashSuggestions, SLASH_SUGGESTIONS } from "@scribe/shared";

export interface SlashSuggestionsProps {
  input: string;
  visible: boolean;
  onPick: (insertText: string) => void;
  onClose: () => void;
}

export function SlashSuggestions(props: SlashSuggestionsProps) {
  const matches = props.visible ? matchSlashSuggestions(props.input) : [];
  const [index, setIndex] = useState(0);

  useEffect(() => { setIndex(0); }, [props.input]);

  useEffect(() => {
    if (!props.visible || matches.length === 0) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setIndex(i => (i + 1) % matches.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setIndex(i => (i - 1 + matches.length) % matches.length);
      } else if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        const cmd = matches[index];
        if (cmd) props.onPick(cmd.insertText);
      } else if (e.key === "Escape") {
        props.onClose();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.visible, matches.length, index]);

  if (!props.visible || matches.length === 0) return null;

  return (
    <div
      data-testid="slash-suggestions"
      style={{
        position: "absolute",
        bottom: "100%",
        left: 12,
        right: 12,
        marginBottom: 4,
        background: "#fff",
        border: "1px solid #ccc",
        borderRadius: 6,
        boxShadow: "0 -2px 8px rgba(0,0,0,.08)",
        maxHeight: 220,
        overflow: "auto",
        zIndex: 40,
      }}
    >
      {matches.map((cmd, i) => {
        const optionId = `option-${i}`;
        return (
          <button
            key={cmd.label}
            data-testid={`slash-${optionId}`}
            onClick={() => props.onPick(cmd.insertText)}
            style={{
              display: "flex",
              width: "100%",
              justifyContent: "space-between",
              border: "none",
              borderRadius: 0,
              background: i === index ? "#eef4ff" : "transparent",
              padding: "6px 10px",
              textAlign: "left",
            }}
          >
            <span>{cmd.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export { SLASH_SUGGESTIONS };
