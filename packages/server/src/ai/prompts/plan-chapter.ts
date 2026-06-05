export interface PlanChapterContext {
  premise?: string;
  recentSummaries?: string;
  userIntent: string;
  chapterNo: number;
}

export function buildPlanChapterPrompt(ctx: PlanChapterContext): string {
  return [
    `# 任务`,
    `先为第 ${ctx.chapterNo} 章写一段不超过 200 字的写作计划。`,
    `格式:`,
    `- 开场情境:...`,
    `- 核心冲突:...`,
    `- 章末钩子:...`,
    "",
    `# 用户意图`,
    ctx.userIntent || "(未提供,自由发挥但承接前文。)",
    "",
    ctx.premise ? `# 故事前提\n${ctx.premise}` : "",
    ctx.recentSummaries ? `# 最近章节摘要\n${ctx.recentSummaries}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
