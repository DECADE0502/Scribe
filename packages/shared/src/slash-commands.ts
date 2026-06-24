export interface SlashSuggestion {
  label: string;
  insertText: string;
}

export const SLASH_SUGGESTIONS = [
  { label: "请帮我写下一章", insertText: "请帮我写下一章，并延续前文语气。" },
  { label: "请连续写三章", insertText: "请连续写三章，并保持章节之间衔接自然。" },
  { label: "请重写当前章节", insertText: "请重写当前章节，并保持设定和前文连贯。" },
  { label: "请改写选中内容", insertText: "请改写我选中的内容，让它更自然。" },
  { label: "请审查当前内容", insertText: "请审查当前内容的剧情、设定和连续性问题。" },
  { label: "请全书检索", insertText: "请在全书中查找相关内容。" },
  { label: "请记录备注", insertText: "请记录这次创作备注。" },
  { label: "请说明现在能做什么", insertText: "请告诉我现在可以怎么做。" },
] as const satisfies readonly SlashSuggestion[];

export function matchSlashSuggestions(input: string): SlashSuggestion[] {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return [];
  const query = trimmed.slice(1).trim().toLowerCase();
  if (!query) return [...SLASH_SUGGESTIONS];
  return SLASH_SUGGESTIONS.filter((suggestion) =>
    `${suggestion.label} ${suggestion.insertText}`.toLowerCase().includes(query),
  );
}
