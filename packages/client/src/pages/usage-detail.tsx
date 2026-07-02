import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { t } from "../i18n/zh-CN.js";

interface UsageSummary {
  totalUsd: number;
  byTaskType: Array<{ taskType: string; costUsd: number }>;
  byModel: Array<{ model: string; costUsd: number; promptTokens: number; completionTokens: number }>;
  byChapter: Array<{ chapterNo: number | null; costUsd: number }>;
}

const TASK_LABELS: Record<string, string> = {
  write: "写作", audit: "审查", chat: "对话",
  extract: "抽取", revise: "改写", onboard: "新书搭建", other: "其它",
};

export function UsageDetailPage() {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [budgetUsd, setBudgetUsd] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!bookId) return;
    void (async () => {
      try {
        const [sumRes, setRes] = await Promise.all([
          fetch(`/api/books/${encodeURIComponent(bookId)}/usage/summary`),
          fetch("/api/settings"),
        ]);
        if (!sumRes.ok) throw new Error(`HTTP ${sumRes.status}`);
        setSummary(await sumRes.json() as UsageSummary);
        if (setRes.ok) {
          const cfg = await setRes.json() as { singleBudgetUsd: number };
          setBudgetUsd(cfg.singleBudgetUsd);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [bookId]);

  if (error) return <main style={{ padding: 24 }}><p role="alert" style={{ color: "#c00" }}>{error}</p></main>;
  if (!summary) return <main style={{ padding: 24 }}><p>{t.app.loading}</p></main>;

  const maxTask = Math.max(...summary.byTaskType.map(x => x.costUsd), 0.000001);

  return (
    <main data-testid="page-usage" style={{ padding: 24, maxWidth: 760, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <button onClick={() => navigate(-1)}>{t.common.back}</button>
        <h1 style={{ margin: 0, fontSize: 20 }}>用量明细</h1>
      </header>

      <section style={{ marginBottom: 20 }}>
        <p data-testid="usage-total" style={{ fontSize: 18, fontWeight: 600 }}>
          总花费 ${summary.totalUsd.toFixed(4)}
        </p>
        {budgetUsd != null && (
          <p style={{ fontSize: 12, color: "#888" }}>单次自动写作预算上限 ${budgetUsd.toFixed(2)}</p>
        )}
      </section>

      <section style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 15 }}>按任务类型</h2>
        {summary.byTaskType.map(item => (
          <div key={item.taskType} data-testid={`usage-task-${item.taskType}`} style={{ marginBottom: 4 }}>
            <span style={{ display: "inline-block", width: 90, fontSize: 13 }}>
              {TASK_LABELS[item.taskType] ?? item.taskType}
            </span>
            <span
              style={{
                display: "inline-block",
                height: 10,
                width: `${Math.max(2, (item.costUsd / maxTask) * 280)}px`,
                background: "#1a73e8",
                borderRadius: 3,
                marginRight: 6,
                verticalAlign: "middle",
              }}
            />
            <span style={{ fontSize: 12, color: "#888" }}>${item.costUsd.toFixed(4)}</span>
          </div>
        ))}
      </section>

      <section style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 15 }}>按章节</h2>
        <table style={{ borderCollapse: "collapse", fontSize: 13 }}>
          <tbody>
            {summary.byChapter.map(item => (
              <tr key={String(item.chapterNo)}>
                <td style={{ padding: "2px 16px 2px 0", color: "#666" }}>
                  {item.chapterNo == null ? "(对话等)" : `第 ${item.chapterNo} 章`}
                </td>
                <td>${item.costUsd.toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 style={{ fontSize: 15 }}>按模型</h2>
        <table style={{ borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ color: "#888" }}>
              <th style={{ textAlign: "left", paddingRight: 16 }}>模型</th>
              <th style={{ textAlign: "right", paddingRight: 16 }}>输入 token</th>
              <th style={{ textAlign: "right", paddingRight: 16 }}>输出 token</th>
              <th style={{ textAlign: "right" }}>花费</th>
            </tr>
          </thead>
          <tbody>
            {summary.byModel.map(item => (
              <tr key={item.model}>
                <td style={{ paddingRight: 16 }}>{item.model}</td>
                <td style={{ textAlign: "right", paddingRight: 16 }}>{item.promptTokens}</td>
                <td style={{ textAlign: "right", paddingRight: 16 }}>{item.completionTokens}</td>
                <td style={{ textAlign: "right" }}>${item.costUsd.toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
