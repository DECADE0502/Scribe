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
});
