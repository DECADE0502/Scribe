export const REPAIR_PROMPT = `你正在修复一段已经写好的章节。
你将收到:
1) 原章节正文
2) 审查报告(列出每个 critical / warning 问题,可能含 excerpt)
3) 上下文(角色 / 伏笔 / rules)

请只输出修复后的完整章节正文(不输出标题、不输出说明)。
修复原则:
- 仅修复 critical / warning 标出的问题,**不要重写整章**
- 保持原作叙述视角与节奏不变
- 涉及伏笔或角色状态时,严格遵循上下文,不要新增设定
- 如果某 issue 是审美质量类(aesthetic_quality),仅替换有问题的局部句子或段落
`;

export interface RepairContext {
  chapterContent: string;
  issues: Array<{
    dimension: string;
    severity: "ok" | "warning" | "critical";
    excerpt?: string;
    note: string;
  }>;
  premise?: string;
  rulesMd?: string;
  characters?: Array<{ name: string; baseData?: unknown }>;
  activeForeshadowing?: Array<{
    label: string;
    description?: string | null;
    status: string;
  }>;
}

export function buildRepairUserPrompt(ctx: RepairContext): string {
  const sections: string[] = [];
  sections.push("## 原章节正文");
  sections.push(ctx.chapterContent);
  sections.push("## 审查报告(待修复问题)");
  for (const i of ctx.issues) {
    if (i.severity === "ok") continue;
    const ex = i.excerpt ? `\n  原文:${i.excerpt}` : "";
    sections.push(`- [${i.severity}] ${i.dimension}:${i.note}${ex}`);
  }
  if (ctx.premise) {
    sections.push("## 故事前提");
    sections.push(ctx.premise);
  }
  if (ctx.rulesMd) {
    sections.push("## 写作规则");
    sections.push(ctx.rulesMd);
  }
  if (ctx.characters?.length) {
    sections.push("## 主要角色");
    for (const c of ctx.characters) {
      const b = c.baseData as Record<string, unknown> | undefined;
      const items: string[] = [];
      if (b && typeof b.background === "string")
        items.push(`背景:${b.background}`);
      if (b && typeof b.motivation === "string")
        items.push(`动机:${b.motivation}`);
      sections.push(
        `${c.name}${items.length ? "(" + items.join(";") + ")" : ""}`,
      );
    }
  }
  if (ctx.activeForeshadowing?.length) {
    sections.push("## 活跃伏笔");
    for (const f of ctx.activeForeshadowing) {
      sections.push(`[${f.label}] ${f.description ?? ""}(状态:${f.status})`);
    }
  }
  return sections.join("\n\n");
}
