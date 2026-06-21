import { z } from "zod";
export const VerdictSchema = z.enum(["ok", "warning", "critical"]);
export const SeveritySchema = z.enum(["ok", "warning", "critical"]);
export const AuditIssueSchema = z.object({
  dimension: z.string(),
  severity: SeveritySchema,
  score: z.number().int().min(0).max(10).optional(),
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

// ===== LLM 输出格式(临时,Task 4.1 新增) =====
// 与落盘格式 ChapterAudit 不同:
// - LLM 输出 dimension 是固定 7 个枚举之一
// - LLM 输出含 score(0-10)
// - LLM 输出包含 summary 子对象(供章末同次调用产出)
// 落盘时由 audit-orchestrator 拆成 ChapterAudit + ChapterSummary 两组持久化数据。

export const AuditDimensionKey = z.enum([
  "setting_consistency",
  "character_behavior",
  "pacing",
  "narrative_coherence",
  "foreshadowing",
  "hook_strength",
  "aesthetic_quality",
]);
export type AuditDimension = z.infer<typeof AuditDimensionKey>;

export const AuditIssueOutputSchema = z.object({
  dimension: AuditDimensionKey,
  severity: SeveritySchema,
  score: z.number().int().min(0).max(10),
  // LLM 常输出 null 表示"无摘录",容错转 undefined
  excerpt: z.string().nullish().transform(v => v ?? undefined),
  note: z.string(),
});

export const HardFactValueOutputSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.object({
    quantity: z.number(),
    unit: z.string().optional(),
    raw: z.string().optional(),
  }),
]);

export const HardFactClaimOutputSchema = z.object({
  entity: z.string(),
  attribute: z.string(),
  value: HardFactValueOutputSchema,
  factType: z.enum([
    "state",
    "quantity",
    "location",
    "ownership",
    "relationship",
    "deadline",
    "cooldown",
    "injury",
    "task",
  ]),
  scope: z.enum(["book", "character", "location", "chapter", "scene"]),
  operation: z
    .enum(["set", "increase", "decrease", "move", "transfer", "resolve", "damage", "heal"])
    .optional(),
  cause: z.string().optional(),
  evidence: z.string(),
});

export const ChapterAuditOutputSchema = z.object({
  verdict: SeveritySchema,
  issues: z.array(AuditIssueOutputSchema),
  summary: z.object({
    oneLiner: z.string().min(1).max(60),
    paragraph: z.string().min(50).max(800),
    keyEvents: z.array(
      z.object({
        event: z.string(),
        characters: z.array(z.string()),
        foreshadowingRefs: z.array(z.string()),
      }),
    ),
  }),
  stateUpdates: z.array(z.unknown()).optional(),
  hardFacts: z.array(HardFactClaimOutputSchema).optional().default([]),
});
export type ChapterAuditOutput = z.infer<typeof ChapterAuditOutputSchema>;
export type HardFactClaimOutput = z.infer<typeof HardFactClaimOutputSchema>;
