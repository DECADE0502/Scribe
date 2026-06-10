/** 斜杠命令注册表(client 补全 UI 与 server 解析共用) */
export const SLASH_COMMANDS = [
  { id: "write", aliases: ["/write", "/续写", "/写下一章"], help: "开始下一章" },
  { id: "auto", aliases: ["/auto", "/自动"], help: "自动写 N 章(示例:/auto 5)" },
  { id: "rewrite", aliases: ["/rewrite", "/重写"], help: "重写当前章" },
  { id: "revise", aliases: ["/revise", "/改写"], help: "改写选中段(需在编辑器选中)" },
  { id: "audit", aliases: ["/audit", "/审查"], help: "对当前章立即审查" },
  { id: "recall", aliases: ["/recall", "/查找"], help: "全书检索(示例:/recall 林尘)" },
  { id: "note", aliases: ["/note", "/便签"], help: "给 AI 留便签(只进对话)" },
  { id: "help", aliases: ["/help", "/帮助"], help: "列出所有命令" },
] as const;

export type SlashCommandId = (typeof SLASH_COMMANDS)[number]["id"];

export type SlashParseResult =
  | { kind: "command"; id: SlashCommandId; args: string }
  | { kind: "text" };

/** 解析用户输入是否为斜杠命令(精确匹配 alias 头部) */
export function parseSlashCommand(text: string): SlashParseResult {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return { kind: "text" };
  const space = trimmed.indexOf(" ");
  const head = space < 0 ? trimmed : trimmed.slice(0, space);
  const args = space < 0 ? "" : trimmed.slice(space + 1).trim();
  for (const cmd of SLASH_COMMANDS) {
    if ((cmd.aliases as readonly string[]).includes(head)) {
      return { kind: "command", id: cmd.id, args };
    }
  }
  return { kind: "text" };
}

/** 模糊匹配(给补全 UI 用):按输入前缀过滤 alias */
export function matchSlashCommands(input: string): Array<(typeof SLASH_COMMANDS)[number]> {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return [];
  const head = trimmed.split(" ")[0]!.toLowerCase();
  if (head === "/") return [...SLASH_COMMANDS];
  return SLASH_COMMANDS.filter(cmd =>
    cmd.aliases.some(a => a.toLowerCase().startsWith(head)),
  );
}
