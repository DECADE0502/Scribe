import { describe, expect, test } from "vitest";
import { sanitizeChapterOutput } from "../../../../src/ai/orchestrator/output-sanitize.js";

describe("sanitizeChapterOutput", () => {
  test("removes non-novel SillyTavern-style meta blocks", () => {
    const text = [
      "正文第一段。",
      "<konatan_chat>不要保存这段聊天</konatan_chat>",
      "<current_event>任务状态</current_event>",
      "<progress>",
      "PG.1",
      "</progress>",
      "正文第二段。",
    ].join("\n");

    const cleaned = sanitizeChapterOutput(text);

    expect(cleaned).toContain("正文第一段。");
    expect(cleaned).toContain("正文第二段。");
    expect(cleaned).not.toContain("konatan_chat");
    expect(cleaned).not.toContain("current_event");
    expect(cleaned).not.toContain("PG.1");
  });

  test("keeps diegetic system panels in prose", () => {
    const text = "他看见系统提示：捕捉成功。\n【状态栏】HP 10/10。";

    expect(sanitizeChapterOutput(text)).toBe(text);
  });
});
