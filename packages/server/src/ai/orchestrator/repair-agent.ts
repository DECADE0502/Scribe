import type { ValidationReport } from "@scribe/shared";
import type { ExecutionPlan } from "./executor-agent.js";

export interface RepairResult {
  repairedPlan: ExecutionPlan;
  summary: string;
}

export async function runRepair(
  report: ValidationReport,
  plan: ExecutionPlan,
  approvedIssueIndices: string[],
): Promise<RepairResult> {
  const indices = new Set(approvedIssueIndices.map(Number));
  const repairable = report.issues
    .filter((_, i) => indices.has(i))
    .filter((issue) => issue.suggestedAction === "repair");

  if (repairable.length === 0) {
    return { repairedPlan: plan, summary: "无需修复，没有选中的 repair 条目" };
  }

  const issueMsgs = repairable.map((i) => i.message).join("; ");
  return {
    repairedPlan: { ...plan, summary: `修复: ${issueMsgs}` },
    summary: `修复了 ${repairable.length} 个问题: ${issueMsgs}`,
  };
}
