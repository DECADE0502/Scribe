import { z } from "zod";
export const VerdictSchema = z.enum(["ok", "warning", "critical"]);
export const SeveritySchema = z.enum(["ok", "warning", "critical"]);
export const AuditIssueSchema = z.object({
  dimension: z.string(),
  severity: SeveritySchema,
  excerpt: z.string().optional(),
  note: z.string(),
});
export const ChapterAuditSchema = z.object({
  chapterNo: z.number().int(),
  verdict: VerdictSchema,
  issues: z.array(AuditIssueSchema),
  auditModel: z.string(),
  auditedAt: z.number().int(),
});
export type Verdict = z.infer<typeof VerdictSchema>;
export type Severity = z.infer<typeof SeveritySchema>;
export type AuditIssue = z.infer<typeof AuditIssueSchema>;
export type ChapterAudit = z.infer<typeof ChapterAuditSchema>;
