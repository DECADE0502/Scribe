import type { AuditResult } from "./audit-chapter.js";

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
): void {
  const now = Date.now();
  // 1. 保存 audit(把 LLM output 的 issues 转成 ChapterAudit 的 AuditIssue)
  repo.saveAudit({
    chapterNo,
    verdict: result.output.verdict,
    issues: result.output.issues.map((i) => ({
      dimension: i.dimension,
      severity: i.severity,
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
}
