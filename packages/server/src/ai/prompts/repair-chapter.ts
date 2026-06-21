import { SERIAL_CHAPTER_ENDING_RULE } from "./serialized-chapter-ending.js";

export const REPAIR_PROMPT = `${SERIAL_CHAPTER_ENDING_RULE}
如果审查问题指向章末收束,只修复结尾局部:删除空泛感慨、意犹未尽、待续式旁白、抽象总结或假钩子,改成具体动作、对话、场景状态、事件后果或角色正在做出/回避的具体选择。不要新增解释性后记,不要重写整章。

你正在修复一段已经写好的章节。
你将收到:
1) 原章节正文
2) 审查报告(列出每个 critical / warning 问题,可能含 excerpt)
3) 上下文(角色 / 伏笔 / rules)

请只输出修复后的完整章节正文(不输出标题、不输出说明)。
修复原则:
- 仅修复 critical / warning 标出的问题,不要重写整章
- 保持原作叙述视角与节奏不变
- 涉及伏笔或角色状态时,严格遵循上下文,不要新增设定
- 如果某 issue 是审美质量类(aesthetic_quality),仅替换有问题的局部句子或段落
- 修复时必须删除所有非小说正文的元文本，包括聊天记录、进度标签、事件卡片、任务总结、模型说明、调试说明，以及 <progress>、<current_event>、<konatan_chat>、<analysis>、<thinking> 等场外 XML/标签块。保留角色在剧情中看到的系统面板或状态栏，但要把它写成故事内的呈现。
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
  for (const issue of ctx.issues) {
    if (issue.severity === "ok") continue;
    const excerpt = issue.excerpt ? `\n  原文:${issue.excerpt}` : "";
    sections.push(`- [${issue.severity}] ${issue.dimension}:${issue.note}${excerpt}`);
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
    for (const character of ctx.characters) {
      const baseData = character.baseData as Record<string, unknown> | undefined;
      const items: string[] = [];
      if (baseData && typeof baseData.background === "string") {
        items.push(`背景:${baseData.background}`);
      }
      if (baseData && typeof baseData.motivation === "string") {
        items.push(`动机:${baseData.motivation}`);
      }
      sections.push(
        `${character.name}${items.length ? `(${items.join(";")})` : ""}`,
      );
    }
  }
  if (ctx.activeForeshadowing?.length) {
    sections.push("## 活跃伏笔");
    for (const item of ctx.activeForeshadowing) {
      sections.push(`[${item.label}] ${item.description ?? ""}(状态:${item.status})`);
    }
  }
  return sections.join("\n\n");
}
