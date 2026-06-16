export interface WriteChapterContext {
  chapterNo: number;
  userIntent: string;
  premise?: string;
  rules?: string;
  characters?: string;
  outlineThis?: string;
  planSummary?: string;
}

export const NO_META_OUTPUT_RULE = [
  "正文只能是小说正文。",
  "不要输出聊天记录、执行日志、进度标签、任务总结、事件卡片、调试说明、写作计划或对用户的解释。",
  "不要输出任何场外 XML/标签块，例如 <progress>、<current_event>、<konatan_chat>、<analysis>、<thinking>。",
  "如果世界观中存在系统面板、状态栏或提示音，它们必须作为角色在故事里看见或听见的内容出现，不能作为作者或模型的场外标签出现。",
].join("");

export function buildWriteChapterPrompt(ctx: WriteChapterContext): string {
  return [
    "# 任务",
    `直接输出第 ${ctx.chapterNo} 章正文。不要标题、不要前言。`,
    NO_META_OUTPUT_RULE,
    "",
    ctx.planSummary ? `# 本章计划\n${ctx.planSummary}` : "",
    ctx.premise ? `# 故事前提\n${ctx.premise}` : "",
    ctx.rules ? `# 写作规则(rules.md)\n${ctx.rules}` : "",
    ctx.characters ? `# 涉及角色\n${ctx.characters}` : "",
    ctx.outlineThis ? `# 本章大纲\n${ctx.outlineThis}` : "",
    "",
    "# 用户意图",
    ctx.userIntent || "(未提供，自由发挥承接前文。)",
  ]
    .filter(Boolean)
    .join("\n");
}
