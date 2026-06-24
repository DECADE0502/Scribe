import { describe, expect, it } from "vitest";
import { analyzeIntent } from "../../../../src/ai/orchestrator/main-agent.js";

describe("main-agent", () => {
  it("uses a structured model decision to create a chapter writing contract", async () => {
    const result = await analyzeIntent(
      {
        model: {},
        generateText: async () => ({
          text: JSON.stringify({
            intent: "write_chapter",
            reply: "已规划第 2 章写作。",
            draft: "第二章正文内容，足够长，避免被验证器当成空稿。",
            targetChapterNo: 2,
            chapterTitle: "第二章",
            acceptanceCriteria: ["使用第一人称", "承接第一章"],
          }),
        }),
      },
      {
        message: "写第二章，保持第一人称",
        source: "chat",
        target: { chapterNo: 2, mode: "write" },
      },
    );

    expect(result.reply).toBe("已规划第 2 章写作。");
    expect(result.draft).toContain("第二章正文内容");
    expect(result.taskContract).toMatchObject({
      intent: "write_chapter",
      targetChapterNo: 2,
      chapterTitle: "第二章",
      acceptanceCriteria: ["使用第一人称", "承接第一章"],
    });
  });

  it("does not use keyword or regex matching to trigger chapter writing", async () => {
    const result = await analyzeIntent(
      {
        model: {},
        generateText: async () => ({
          text: JSON.stringify({
            intent: "query_only",
            reply: "这是视角问题讨论，不执行写作。",
          }),
        }),
      },
      "第二章视角错了，改成第一人称应该怎么处理？",
    );

    expect(result.taskContract.intent).toBe("query_only");
    expect(result.taskContract.targetChapterNo).toBeUndefined();
    expect(result.draft).toBeUndefined();
  });

  it("falls back to query_only when the model output is not structured", async () => {
    const result = await analyzeIntent(
      {
        model: {},
        generateText: async () => ({ text: "我直接开写第一章。" }),
      },
      "写第一章",
    );

    expect(result.taskContract.intent).toBe("query_only");
    expect(result.draft).toBeUndefined();
    expect(result.reply).toContain("无法确认执行意图");
  });

  it("passes default chapter length preference to the model prompt", async () => {
    let promptText = "";
    await analyzeIntent(
      {
        model: {},
        generateText: async ({ messages }) => {
          promptText = messages.map((message) => String(message.content)).join("\n");
          return { text: JSON.stringify({ intent: "query_only", reply: "收到。" }) };
        },
      },
      {
        message: "写下一章",
        source: "chat",
        target: { chapterNo: 3, mode: "write", defaultChapterLength: "long" },
      },
    );

    expect(promptText).toContain("defaultChapterLength");
    expect(promptText).toContain("long");
  });
});
