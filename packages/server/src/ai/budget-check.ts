import type { ModelInfo } from "@scribe/shared";

export interface UsageStatsLike {
  /** 最近 N 条 write 任务的平均 token(prompt + completion);无记录返回 undefined */
  recentWriteAverage(): { promptTokens: number; completionTokens: number } | undefined;
}

export interface CostEstimate {
  estimatedUsd: number;
  perChapterUsd: number;
  basis: "history" | "default";
}

/** 无历史时的兜底估算:写 ≈ 6750 prompt + 4500 completion;audit ≈ 2000 + 800 */
const DEFAULT_WRITE = { promptTokens: 6750, completionTokens: 4500 };
const DEFAULT_AUDIT = { promptTokens: 2000, completionTokens: 800 };

export function estimateAutoModeCost(
  n: number,
  writeModel: ModelInfo,
  auditModel: ModelInfo,
  usageStats?: UsageStatsLike,
): CostEstimate {
  const history = usageStats?.recentWriteAverage();
  const write = history ?? DEFAULT_WRITE;
  const writeCost = tokenCost(write.promptTokens, write.completionTokens, writeModel);
  const auditCost = tokenCost(DEFAULT_AUDIT.promptTokens, DEFAULT_AUDIT.completionTokens, auditModel);
  const perChapterUsd = writeCost + auditCost;
  return {
    estimatedUsd: perChapterUsd * n,
    perChapterUsd,
    basis: history ? "history" : "default",
  };
}

function tokenCost(promptTokens: number, completionTokens: number, model: ModelInfo): number {
  const p = model.pricing;
  if (!p) return 0;
  return (promptTokens / 1e6) * p.input + (completionTokens / 1e6) * p.output;
}

export interface BudgetCheckResult {
  ok: boolean;
  estimate: CostEstimate;
  limitUsd: number;
}

export function checkAutoModeBudget(
  n: number,
  limitUsd: number,
  writeModel: ModelInfo,
  auditModel: ModelInfo,
  usageStats?: UsageStatsLike,
): BudgetCheckResult {
  const estimate = estimateAutoModeCost(n, writeModel, auditModel, usageStats);
  return { ok: estimate.estimatedUsd <= limitUsd, estimate, limitUsd };
}
