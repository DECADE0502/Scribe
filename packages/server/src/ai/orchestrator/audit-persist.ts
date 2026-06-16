import type { AuditResult } from "./audit-chapter.js";
import type { ReaderIssueType } from "@scribe/shared";

/**
 * Audit/Summary 落盘所需的 chapters repo 子集。
 *
 * 故意用结构化类型而非引入 createChaptersRepo 的具体类型,方便测试注入桩对象。
 * 保存格式与 packages/shared/src/types 中的 ChapterAudit / ChapterSummary 对齐。
 */
export interface ChaptersRepoAuditLike {
  saveAudit(a: {
    chapterNo: number;
    verdict: "ok" | "warning" | "critical";
    issues: Array<{
      dimension: string;
      severity: "ok" | "warning" | "critical";
      score?: number;
      excerpt?: string;
      note: string;
    }>;
    auditModel: string;
    auditedAt: number;
  }): void;
  saveSummary(s: {
    chapterNo: number;
    oneLiner: string;
    paragraph: string;
    keyEvents: Array<{
      event: string;
      characters: string[];
      foreshadowingRefs: string[];
    }>;
    generatedAt: number;
    reasoningContent: string | null;
  }): void;
}

export interface ReaderIssuesRepoAuditLike {
  create(input: {
    chapterNo: number;
    type: ReaderIssueType;
    severity: "warning" | "critical";
    note: string;
    evidence?: string | null;
    suggestedAction?: string | null;
    status: "open";
  }): unknown;
}

function readerIssueTypeForDimension(dimension: string): ReaderIssueType {
  switch (dimension) {
    case "setting_consistency":
      return "setting_consistency";
    case "character_behavior":
      return "character_behavior";
    case "foreshadowing":
      return "foreshadowing";
    case "pacing":
    case "hook_strength":
      return "pacing";
    case "narrative_coherence":
      return "narrative_perspective";
    case "aesthetic_quality":
    default:
      return "style_drift";
  }
}

/**
 * 把 audit_chapter 编排器输出的 ChapterAuditOutput 拆成 ChapterAudit + ChapterSummary
 * 两组持久化数据,分别落盘。
 *
 * - LLM 输出含 score 字段,落盘 schema 不存,转换时丢弃
 * - dimension 由 enum 字面值降级为 string(落盘 schema 是 z.string())
 * - reasoningText 当作 summary.reasoningContent 持久化
 * - 同一 chapterNo 的 audit / summary 都是 INSERT OR REPLACE 语义,二次审查会覆盖
 */
export function persistAuditResult(
  repo: ChaptersRepoAuditLike,
  chapterNo: number,
  result: AuditResult,
  auditModel: string,
  readerIssuesRepo?: ReaderIssuesRepoAuditLike,
): void {
  const now = Date.now();
  // 1. 保存 audit(把 LLM output 的 issues 转成 ChapterAudit 的 AuditIssue)
  repo.saveAudit({
    chapterNo,
    verdict: result.output.verdict,
    issues: result.output.issues.map((i) => ({
      dimension: i.dimension,
      severity: i.severity,
      score: i.score,
      excerpt: i.excerpt,
      note: i.note,
    })),
    auditModel,
    auditedAt: now,
  });
  // 2. 保存 summary
  repo.saveSummary({
    chapterNo,
    oneLiner: result.output.summary.oneLiner,
    paragraph: result.output.summary.paragraph,
    keyEvents: result.output.summary.keyEvents,
    generatedAt: now,
    reasoningContent: result.reasoningText ?? null,
  });

  if (readerIssuesRepo) {
    for (const issue of result.output.issues) {
      if (issue.severity === "ok") continue;
      readerIssuesRepo.create({
        chapterNo,
        type: readerIssueTypeForDimension(issue.dimension),
        severity: issue.severity,
        note: issue.note,
        evidence: issue.excerpt ?? null,
        suggestedAction: "Address this before or during the next chapter.",
        status: "open",
      });
    }
  }
}
