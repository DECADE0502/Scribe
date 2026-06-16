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
  it("子串命中 + keyEvents 标注加成,角色权重高于伏笔", () => {
    const summaries = [
      sum(1, ["林尘"], ["黑剑之谜"]), // 角色5+伏笔3 + 标注2+4 = 14
      sum(2, ["林尘", "师妹"], []),    // 角色5 + 标注2 = 7
      sum(3, [], ["黑剑之谜"]),        // 伏笔3 + 标注4 = 7
    ];
    const top = recallChapters({
      allSummaries: summaries,
      currentChapterNo: 10,
      intentCharacters: ["林尘"],
      intentForeshadowing: ["黑剑之谜"],
      topK: 3,
    });
    expect(top[0]!.chapterNo).toBe(1); // 双命中最高
    expect(top.map((s) => s.chapterNo).sort()).toEqual([1, 2, 3]);
  });

  it("正文/摘要子串命中即可召回,即使 keyEvents 未标注该实体", () => {
    // 模拟真实情况:keyEvents 标注里没有"方同",但段落正文提到了
    const s: ChapterSummary = {
      chapterNo: 1,
      oneLiner: "陈默得知方同的秘密",
      paragraph: "本章中,陈默从档案里看到方同(代号溯流)的过往……",
      keyEvents: [{ event: "查看档案", characters: ["陈默"], foreshadowingRefs: [] }],
      generatedAt: 1000,
      reasoningContent: null,
    };
    const top = recallChapters({
      allSummaries: [s],
      currentChapterNo: 10,
      intentCharacters: ["方同"], // 仅在 prose 出现,不在 keyEvents 标注
      intentForeshadowing: [],
      topK: 5,
    });
    expect(top.map((x) => x.chapterNo)).toEqual([1]); // 子串命中成功召回
  });

  it("通用记录实体命中即可召回,不依赖角色或伏笔", () => {
    const s: ChapterSummary = {
      chapterNo: 1,
      oneLiner: "A-1 首次出现",
      paragraph: "这里记录了 A-1 的早期线索。",
      keyEvents: [{ event: "A-1 出现", characters: [], foreshadowingRefs: [] }],
      generatedAt: 1000,
      reasoningContent: null,
    };

    const top = recallChapters({
      allSummaries: [s],
      currentChapterNo: 10,
      intentCharacters: [],
      intentForeshadowing: [],
      intentRecords: ["A-1"],
      topK: 5,
    });

    expect(top.map((x) => x.chapterNo)).toEqual([1]);
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
