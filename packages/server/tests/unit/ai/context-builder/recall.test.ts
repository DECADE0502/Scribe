import { describe, it, expect } from "vitest";
import { recallChapters } from "../../../../src/ai/context-builder/recall.js";
import type { ChapterSummary } from "@scribe/shared";

function sum(no: number, characters: string[], fos: string[]): ChapterSummary {
  return {
    chapterNo: no,
    oneLiner: `第${no}章`,
    paragraph: "x".repeat(100),
    keyEvents: [{ event: "事", characters, foreshadowingRefs: fos }],
    generatedAt: no * 1000,
    reasoningContent: null,
  };
}

describe("recallChapters", () => {
  it("评分按公式 5*角色 + 10*伏笔", () => {
    const summaries = [
      sum(1, ["林尘"], ["黑剑之谜"]),
      sum(2, ["林尘", "师妹"], []),
      sum(3, [], ["黑剑之谜"]),
    ];
    const top = recallChapters({
      allSummaries: summaries,
      currentChapterNo: 10,
      intentCharacters: ["林尘"],
      intentForeshadowing: ["黑剑之谜"],
      topK: 3,
    });
    expect(top.map((s) => s.chapterNo)).toEqual([1, 3, 2]); // 15 / 10 / 5
  });

  it("排除最近 3 章 (currentChapterNo - 3 之内)", () => {
    const summaries = [
      sum(8, ["林"], []),
      sum(7, ["林"], []),
      sum(6, ["林"], []),
      sum(5, ["林"], []),
    ];
    const top = recallChapters({
      allSummaries: summaries,
      currentChapterNo: 10,
      intentCharacters: ["林"],
      intentForeshadowing: [],
      topK: 5,
    });
    // cutoff = 7, 只保留 chapterNo < 7 的: 6 / 5
    expect(top.map((s) => s.chapterNo).sort()).toEqual([5, 6]);
  });

  it("score=0 的章节被过滤", () => {
    const summaries = [sum(1, ["A"], []), sum(2, ["B"], [])];
    const top = recallChapters({
      allSummaries: summaries,
      currentChapterNo: 10,
      intentCharacters: ["A"],
      intentForeshadowing: [],
      topK: 5,
    });
    expect(top).toHaveLength(1);
    expect(top[0]!.chapterNo).toBe(1);
  });

  it("topK 默认 5, 不足时返回所有命中", () => {
    const summaries = [sum(1, ["A"], []), sum(2, ["A"], [])];
    const top = recallChapters({
      allSummaries: summaries,
      currentChapterNo: 10,
      intentCharacters: ["A"],
      intentForeshadowing: [],
    });
    expect(top).toHaveLength(2);
  });

  it("性能: 200 章 1000 次召回 < 1 秒", () => {
    const summaries: ChapterSummary[] = [];
    for (let i = 1; i <= 200; i++) {
      summaries.push(
        sum(i, ["林尘", `配角${i % 7}`], i % 5 === 0 ? ["黑剑"] : [])
      );
    }
    const start = performance.now();
    for (let k = 0; k < 1000; k++) {
      recallChapters({
        allSummaries: summaries,
        currentChapterNo: 250,
        intentCharacters: ["林尘"],
        intentForeshadowing: ["黑剑"],
        topK: 5,
      });
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(1000);
  });
});
