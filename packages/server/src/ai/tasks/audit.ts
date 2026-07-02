import { z } from "zod";
import { generateLlmText } from "../llm-call.js";
import { prependDeepestPrompt } from "../prompts/deepest-prompt.js";
import type { TaskContext, TaskDef, TaskStreamEvent } from "./types.js";

/**
 * 资产审查 task —— 报告 only,不修:AI 读所选资产 + 最近若干章梗概,产出 issues 落
 * `reader_issues` 表。字段与 `readerIssuesRepo.create()` 的 NewReaderIssueInput 对齐
 * (见 packages/server/src/db/repositories/reader-issues.ts):
 *
 *   { chapterNo, type: ReaderIssueType, severity, note, evidence?, suggestedAction?, status? }
 *
 * `type` 用 ReaderIssueTypeSchema 的合法值域(continuity/character_behavior/foreshadowing/
 * setting_consistency/pacing/narrative_perspective/information_density/style_drift),
 * severity 只有 warning|critical(不含 info)—— 计划草稿里的 area/message/source 字段名
 * 与真实仓库不符,这里按真实签名实现,与 write-chapter.ts/onboard.ts 同一"跟真实 repo 走"套路。
 */
const IssueSchema = z.object({
  chapterNo: z.number().int().positive(),
  type: z.enum([
    "continuity",
    "character_behavior",
    "foreshadowing",
    "setting_consistency",
    "pacing",
    "narrative_perspective",
    "information_density",
    "style_drift",
  ]),
  severity: z.enum(["warning", "critical"]),
  note: z.string().min(1),
  evidence: z.string().optional(),
  suggestedAction: z.string().optional(),
});
const AuditResultSchema = z.object({
  issues: z.array(IssueSchema).default([]),
  summary: z.string().default(""),
});
type AuditResult = z.infer<typeof AuditResultSchema>;
/** 抽取步骤的输入形状:字段可省略,由 AuditResultSchema 在 parse() 里补默认值(同 onboard/write-chapter 套路)。 */
type AuditResultInput = z.input<typeof AuditResultSchema>;

export interface AuditParsed extends AuditResult {}

interface AuditDeps {
  runAudit?: (ctx: TaskContext) => Promise<AuditResultInput>;
}

function makeTask(deps: AuditDeps = {}): TaskDef<AuditParsed> & { withDeps: (d: AuditDeps) => TaskDef<AuditParsed> } {
  const runAudit = deps.runAudit ?? defaultRunAudit;
  // 闭包 state —— stream() 里跑 LLM,把结果暂存,parse() 消费。每次 makeTask() 生成独立闭包,
  // 因此不同 withDeps() 实例互不干扰,不会跨调用串味。同一个实例被 dispatchTask 顺序
  // stream→parse→apply 消费属于契约保证;若脚本外部强行两次 parse 同一 stream,会抛
  // audit_result_missing 而非静默返回旧结果。
  const state: { result?: AuditResult } = {};

  const task: TaskDef<AuditParsed> & { withDeps: (d: AuditDeps) => TaskDef<AuditParsed> } = {
    name: "audit",
    // 审查会写 reader_issues 表,是真实落库。
    mutates: true,
    async *stream(ctx): AsyncIterable<TaskStreamEvent> {
      const raw = await runAudit(ctx);
      const parsed = AuditResultSchema.parse(raw);
      state.result = parsed;
      // 没有独立的"读者问题"UI 面板,聊天回复就是审查报告的唯一用户可见出口 ——
      // 摘要 + 逐条问题都要流出去;issues 同时落 reader_issues 表反哺写作上下文。
      const lines: string[] = [];
      if (parsed.summary) lines.push(parsed.summary);
      for (const issue of parsed.issues) {
        const severity = issue.severity === "critical" ? "严重" : "警告";
        lines.push(`- [${severity}] 第 ${issue.chapterNo} 章 · ${issue.type}:${issue.note}`);
      }
      if (lines.length) yield { type: "text_delta", delta: lines.join("\n") };
    },
    async parse(_ctx, _text) {
      const r = state.result;
      if (!r) throw new Error("audit_result_missing");
      state.result = undefined;
      return r;
    },
    apply(ctx, parsed) {
      const { handle } = ctx;
      // dispatch.ts 把 parsed 当 unknown 传递,apply() 可能被裸对象直接调用(测试即如此),
      // 对 issues 做 nullish 兜底,与 write-chapter.ts / onboard.ts 套路一致。
      const issues = parsed.issues ?? [];
      const runDb = handle.workspaceDb.transaction(() => {
        for (const issue of issues) {
          handle.readerIssuesRepo.create({
            chapterNo: issue.chapterNo,
            type: issue.type,
            severity: issue.severity,
            note: issue.note,
            evidence: issue.evidence ?? null,
            suggestedAction: issue.suggestedAction ?? null,
            status: "open",
          });
        }
      });
      runDb();
    },
    withDeps: (d) => makeTask(d),
  };
  return task;
}

async function defaultRunAudit(ctx: TaskContext): Promise<AuditResultInput> {
  const scope = ctx.request.target?.auditScope?.assets ?? ["all"];
  const includeAll = scope.includes("all");
  const wants = (name: string) => includeAll || (scope as string[]).includes(name);

  const parts: string[] = [];
  if (wants("characters")) parts.push(`# Characters\n${JSON.stringify(ctx.handle.charactersRepo.list(), null, 2)}`);
  if (wants("outline")) parts.push(`# Outline\n${JSON.stringify(ctx.handle.outlineRepo.listAll(), null, 2)}`);
  if (wants("worldbook")) parts.push(`# Worldbook\n${JSON.stringify(ctx.handle.worldbookRepo.list(), null, 2)}`);
  // 前端"元素/设定/伏笔"审查范围会带 foreshadowing / timeline —— 漏了这两个的话,
  // 选中它们等于给 LLM 送空内容。
  if (wants("foreshadowing")) parts.push(`# Foreshadowing\n${JSON.stringify(ctx.handle.foreshadowingRepo.list(), null, 2)}`);
  if (wants("timeline")) parts.push(`# Timeline\n${JSON.stringify(ctx.handle.timelineRepo.listAll(), null, 2)}`);
  if (wants("chapters")) {
    // 与 chat.ts 一致:ChapterSummary 用 oneLiner + paragraph(schema 里没有 `summary` 字段),
    // 取最近 5 条上下文喂 LLM。
    const summaries = (ctx.handle.chaptersRepo.listSummaries() ?? []).slice(-5);
    parts.push(
      `# Recent chapters\n${summaries.map((s: any) => `- 第${s.chapterNo}章:${s.oneLiner ?? s.paragraph ?? ""}`).join("\n")}`,
    );
  }
  if (parts.length === 0) {
    // 范围值不认识(schema 外的值)时不要拿空内容去问 LLM —— 那只会产出幻觉 issue。
    return { issues: [], summary: "审查范围为空,没有可检查的资产。" };
  }

  const prompt = [
    "你是小说资产审查员。找出所选资产内的:角色前后矛盾、大纲断层、世界书内部冲突、伏笔未回收(如果范围包含)。",
    "输出严格 JSON,无 markdown:",
    '{ issues:[{chapterNo,type,severity,note,evidence?,suggestedAction?}], summary:"一句话结论" }',
    "type ∈ continuity | character_behavior | foreshadowing | setting_consistency | pacing | narrative_perspective | information_density | style_drift",
    "severity ∈ warning | critical (仅这两种,不要写 info)。chapterNo 必须 ≥ 1 的整数,无法定位到具体章节时填 1。",
    "只报告确凿的问题;不确定的不要写。",
  ].join("\n");
  const { text, usage } = await generateLlmText({
    model: ctx.auditModel,
    messages: prependDeepestPrompt([
      { role: "system", content: prompt },
      { role: "user", content: parts.join("\n\n") },
    ], ctx.deepestPrompt),
    abortSignal: ctx.abortSignal,
  });
  ctx.onUsage?.({ ...usage, modelRole: "audit" });
  const trimmed = text.trim().replace(/^```json\s*|\s*```$/g, "");
  const parsed = AuditResultSchema.safeParse(JSON.parse(trimmed));
  if (!parsed.success) throw new Error(`audit_parse_failed: ${parsed.error.message}`);
  return parsed.data;
}

export const auditTask = makeTask();
