import { describe, expect, test } from "vitest";
import { buildWriteChapterPrompt } from "../../../../src/ai/prompts/write-chapter.js";

describe("buildWriteChapterPrompt", () => {
  test("adds a hard rule against non-novel meta output", () => {
    const prompt = buildWriteChapterPrompt({
      chapterNo: 1,
      userIntent: "继续正文",
    });

    expect(prompt).toContain("正文只能是小说正文");
    expect(prompt).toContain("不要输出聊天记录");
    expect(prompt).toContain("进度标签");
    expect(prompt).toContain("事件卡片");
    expect(prompt).toContain("<progress>");
    expect(prompt).toContain("<konatan_chat>");
    expect(prompt).toContain("故事里看见");
  });

  test("adds a hard rule against vague serialized-novel endings", () => {
    const prompt = buildWriteChapterPrompt({
      chapterNo: 2,
      userIntent: "continue",
    });

    expect(prompt).toContain("SERIAL_CHAPTER_ENDING_RULE");
    expect(prompt).toContain("连续小说");
    expect(prompt).toContain("待续式");
    expect(prompt).toContain("具体动作");
    expect(prompt).toContain("对话");
    expect(prompt).toContain("场景状态");
    expect(prompt).toContain("事件后果");
  });

  test("injects a selected style reference into the writing prompt", () => {
    const prompt = buildWriteChapterPrompt({
      chapterNo: 3,
      userIntent: "continue",
      styleReference: "名称: 柔和散文\n句子舒缓,少用口号式总结。",
    });

    expect(prompt).toContain("# 文风参考");
    expect(prompt).toContain("柔和散文");
    expect(prompt).toContain("句子舒缓");
  });
});
