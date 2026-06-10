import { useEffect, useState } from "react";
import { matchSlashCommands, SLASH_COMMANDS } from "@scribe/shared";

export interface SlashSuggestionsProps {
  input: string;
  visible: boolean;
  onPick: (alias: string) => void;
  onClose: () => void;
}

export function SlashSuggestions(props: SlashSuggestionsProps) {
  const matches = props.visible ? matchSlashCommands(props.input) : [];
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
        if (cmd) props.onPick(cmd.aliases[0]);
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
      {matches.map((cmd, i) => (
        <button
          key={cmd.id}
          data-testid={`slash-option-${cmd.id}`}
          onClick={() => props.onPick(cmd.aliases[0])}
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
          <span style={{ fontFamily: "monospace" }}>{cmd.aliases.join(" ")}</span>
          <span style={{ color: "#888", fontSize: 12 }}>{cmd.help}</span>
        </button>
      ))}
    </div>
  );
}

export { SLASH_COMMANDS };
