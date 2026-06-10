import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

export function UsageMeter(props: { bookId: string }) {
  const [totalUsd, setTotalUsd] = useState<number | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/books/${encodeURIComponent(props.bookId)}/usage/summary`);
        if (!res.ok) return;
        const j = await res.json() as { totalUsd: number };
        setTotalUsd(j.totalUsd);
      } catch { /* 静默 */ }
    })();
  }, [props.bookId]);

  if (totalUsd == null) return null;

  return (
    <span data-testid="usage-meter" style={{ fontSize: 12, color: "#888", display: "inline-flex", gap: 6, alignItems: "center" }}>
      已花费 ${totalUsd.toFixed(4)}
      <button
        data-testid="usage-detail-link"
        style={{ fontSize: 11, padding: "1px 6px" }}
        onClick={() => navigate(`/books/${props.bookId}/usage`)}
      >
        详情
      </button>
    </span>
  );
}
