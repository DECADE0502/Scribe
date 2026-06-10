import { diffLines } from "diff";

export function DiffView(props: { a: string; b: string }) {
  const parts = diffLines(props.a, props.b);
  return (
    <pre
      data-testid="diff-view"
      style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13, margin: 0 }}
    >
      {parts.map((part, i) => (
        <span
          key={i}
          data-diff={part.added ? "added" : part.removed ? "removed" : "same"}
          style={{
            display: "block",
            background: part.added ? "#e6ffec" : part.removed ? "#ffebe9" : "transparent",
            color: part.added ? "#1a7f37" : part.removed ? "#cf222e" : "#444",
            textDecoration: part.removed ? "line-through" : "none",
          }}
        >
          {part.value}
        </span>
      ))}
    </pre>
  );
}
