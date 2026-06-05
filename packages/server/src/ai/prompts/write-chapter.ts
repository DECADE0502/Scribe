export interface WriteChapterContext {
  chapterNo: number;
  userIntent: string;
  premise?: string;
  rules?: string;
  characters?: string;
  outlineThis?: string;
  planSummary?: string;
}

export function buildWriteChapterPrompt(ctx: WriteChapterContext): string {
  return [
    `# 任务`,
    `直接输出第 ${ctx.chapterNo} 章正文。不要标题、不要前言。`,
    "",
    ctx.planSummary ? `# 本章计划\n${ctx.planSummary}` : "",
    ctx.premise ? `# 故事前提\n${ctx.premise}` : "",
    ctx.rules ? `# 写作规则(rules.md)\n${ctx.rules}` : "",
    ctx.characters ? `# 涉及角色\n${ctx.characters}` : "",
    ctx.outlineThis ? `# 本章大纲\n${ctx.outlineThis}` : "",
    "",
    `# 用户意图`,
    ctx.userIntent || "(未提供,自由发挥承接前文。)",
  ]
    .filter(Boolean)
    .join("\n");
}
