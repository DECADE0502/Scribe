export const REVISE_PROMPT = `你正在改写章节中的一段。你将收到:
1) 完整章节正文(标记 <SEG>...</SEG> 包裹的为待改段落)
2) 用户指令(如"重写,要更克制")
3) 当前的角色卡 / 活跃伏笔(供参考,若有)

只输出新段落原文,不输出说明,不输出包裹标记。
改写原则:
- 只改 <SEG> 内的文字,保持与前后文的衔接自然
- 保持原作叙述视角与时态
- 不引入上下文中不存在的新设定`;

export interface ReviseContext {
  chapterContent: string;
  segmentText: string;
  instruction: string;
  charactersBrief?: string;
  foreshadowingBrief?: string;
}

export function buildReviseUserPrompt(ctx: ReviseContext): string {
  const marked = ctx.chapterContent.replace(
    ctx.segmentText,
    `<SEG>${ctx.segmentText}</SEG>`,
  );
  const parts: string[] = [];
  parts.push("## 章节正文(含待改标记)");
  parts.push(marked);
  parts.push("## 用户指令");
  parts.push(ctx.instruction || "改写这一段,保持文意但提升表达质量。");
  if (ctx.charactersBrief) {
    parts.push("## 主要角色");
    parts.push(ctx.charactersBrief);
  }
  if (ctx.foreshadowingBrief) {
    parts.push("## 活跃伏笔");
    parts.push(ctx.foreshadowingBrief);
  }
  return parts.join("\n\n");
}
