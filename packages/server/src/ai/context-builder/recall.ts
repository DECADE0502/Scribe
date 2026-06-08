import type { ChapterSummary } from "@scribe/shared";

export interface RecallInput {
  allSummaries: ChapterSummary[];
  currentChapterNo: number;
  intentCharacters: string[];
  intentForeshadowing: string[];
  topK?: number;
}

export function recallChapters(input: RecallInput): ChapterSummary[] {
  const cs = new Set(input.intentCharacters);
  const fs = new Set(input.intentForeshadowing);
  const cutoff = input.currentChapterNo - 3;
  const scored = input.allSummaries
    .filter((s) => s.chapterNo < cutoff)
    .map((s) => {
      let cScore = 0;
      let fScore = 0;
      for (const ev of s.keyEvents) {
        for (const c of ev.characters) if (cs.has(c)) cScore += 1;
        for (const f of ev.foreshadowingRefs) if (fs.has(f)) fScore += 1;
      }
      return { s, score: 5 * cScore + 10 * fScore };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, input.topK ?? 5);
  return scored.map((x) => x.s);
}
