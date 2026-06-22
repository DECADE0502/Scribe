import type { ChapterSummary } from "@scribe/shared";

export interface RecallInput {
  allSummaries: ChapterSummary[];
  currentChapterNo: number;
  intentCharacters: string[];
  intentForeshadowing: string[];
  intentRecords?: string[];
  topK?: number;
  /**
   * 是否把最近 3 章也纳入打分。默认 false:写作上下文构建时,最近章是单独以"近章摘要"
   * 注入的,这里要排除以免重复。但用户主动 /recall 检索全书时应置 true,否则永远搜不到最近章
   * (短篇里更是直接一片空白)。
   */
  includeRecent?: boolean;
}

/** 一章摘要的全部可检索文本(一句话 + 段落 + 事件文本 + 标注)。 */
function summaryText(s: ChapterSummary): string {
  const parts: string[] = [s.oneLiner, s.paragraph];
  for (const ev of s.keyEvents) {
    parts.push(ev.event);
    parts.push(...ev.characters, ...ev.foreshadowingRefs);
  }
  return parts.join("\n");
}

/**
 * 召回相关历史章节(spec §6.1.1)。
 *
 * 打分用"实体出现"而非 keyEvents 标注的精确集合匹配 —— 因为:
 * - 角色名在正文/摘要里稳定出现,但 keyEvents.characters 标注稀疏
 * - 伏笔标签在"伏笔表"与"摘要 foreshadowingRefs"两处用词不一致(几乎不重叠),
 *   只有靠实体名在 prose 里的子串命中才捞得回相关章
 *
 * 因此:把意图里的角色名/伏笔词,对每章摘要的"全文"做子串包含计分。
 * 角色名权重高(信号可靠、对齐角色档案),伏笔词权重略低(可能含噪声)。
 * keyEvents 精确标注命中再加成(强信号)。
 */
export function recallChapters(input: RecallInput): ChapterSummary[] {
  const cs = input.intentCharacters.filter((c) => c && c.trim());
  const fs = input.intentForeshadowing.filter((f) => f && f.trim());
  const rs = (input.intentRecords ?? []).filter((r) => r && r.trim());
  const csSet = new Set(cs);
  const fsSet = new Set(fs);
  const cutoff = input.includeRecent ? input.currentChapterNo : input.currentChapterNo - 3;

  const scored = input.allSummaries
    .filter((s) => s.chapterNo < cutoff)
    .map((s) => {
      const text = summaryText(s);
      let score = 0;
      // 子串命中(主信号):每个意图角色/伏笔词在本章全文出现即计分
      for (const c of cs) if (text.includes(c)) score += 5;
      for (const f of fs) if (text.includes(f)) score += 3;
      for (const r of rs) if (text.includes(r)) score += 4;
      // keyEvents 精确标注命中(加成):标注本就是结构化强信号
      for (const ev of s.keyEvents) {
        for (const c of ev.characters) if (csSet.has(c)) score += 2;
        for (const f of ev.foreshadowingRefs) if (fsSet.has(f)) score += 4;
      }
      return { s, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, input.topK ?? 5);
  return scored.map((x) => x.s);
}
