import { describe, expect, it } from "vitest";
import { validateStagedChanges } from "../../../../src/ai/orchestrator/validator-agent.js";
import type { StagedChange } from "../../../../src/ai/orchestrator/workflow-staging.js";

describe("validator-agent", () => {
  const deps = {
    model: {},
    handle: {
      bookId: "book-1",
      charactersRepo: { list: () => [] },
    },
  };

  it("fails chapter writes that do not match the requested target chapter", async () => {
    const report = await validateStagedChanges(
      deps,
      [change("chapter_version", { chapterNo: 2, title: "第二章", content: "正文".repeat(80) })],
      "写第一章",
    );

    expect(report.verdict).toBe("fail");
    expect(report.commitAllowed).toBe(false);
    expect(report.issues.some((issue) => issue.message.includes("目标章节"))).toBe(true);
  });

  it("rejects incomplete outline and worldbook mutations instead of allowing silent junk writes", async () => {
    const report = await validateStagedChanges(
      deps,
      [
        change("outline_upsert", { title: "", level: "chapter" }),
        change("worldbook_upsert", { title: "灵力规则", content: "" }),
      ],
      "整理大纲和世界书",
    );

    expect(report.verdict).toBe("fail");
    expect(report.commitAllowed).toBe(false);
    expect(report.issues.map((issue) => issue.area)).toEqual(["outline", "worldbook"]);
  });

  it("passes structurally valid non-chapter mutations", async () => {
    const report = await validateStagedChanges(
      deps,
      [
        change("outline_upsert", {
          parentId: null,
          level: "chapter",
          title: "第一章",
          summary: "第一章写主角入场",
          status: "planned",
          sortOrder: 0,
          metadata: null,
        }),
        change("worldbook_upsert", {
          title: "灵力规则",
          content: "灵力规则用于约束战斗、修炼和角色能力边界。",
          keys: ["灵力规则"],
          enabled: true,
        }),
      ],
      "整理大纲和世界书",
    );

    expect(report.verdict).toBe("pass");
    expect(report.commitAllowed).toBe(true);
  });

  it("blocks chapter drafts that ignore an explicit first-person requirement", async () => {
    const report = await validateStagedChanges(
      deps,
      [change("chapter_version", {
        chapterNo: 2,
        title: "第二章",
        content: "林舟推开门，看见雨水沿着屋檐往下落。她没有说话，只是把伞收好，站在门口等他回头。".repeat(8),
        acceptanceCriteria: ["使用第一人称叙述"],
      })],
      "第一章改成第一人称来写",
    );

    expect(report.verdict).toBe("fail");
    expect(report.commitAllowed).toBe(false);
    expect(report.issues).toContainEqual(expect.objectContaining({
      area: "chapter",
      severity: "critical",
      suggestedAction: "reroll",
    }));
  });

  it("blocks serial-novel filler endings that say the chapter will continue later", async () => {
    const report = await validateStagedChanges(
      deps,
      [change("chapter_version", {
        chapterNo: 1,
        title: "第一章",
        content: `${"我把伞靠在门边，听着雨声一点点落进屋里。".repeat(15)}\n\n未完待续。`,
      })],
      "写第一章",
    );

    expect(report.verdict).toBe("fail");
    expect(report.commitAllowed).toBe(false);
    expect(report.issues).toContainEqual(expect.objectContaining({
      message: expect.stringContaining("待续"),
      suggestedAction: "reroll",
    }));
  });

  it("requires every declared acceptance criterion to be represented in the chapter payload", async () => {
    const report = await validateStagedChanges(
      deps,
      [change("chapter_version", {
        chapterNo: 1,
        title: "第一章",
        content: "我推开窗，看见街灯在雨里发亮，屋里的旧木桌还留着昨晚写到一半的纸页。".repeat(12),
        acceptanceCriteria: ["承接第一章视角", ""],
      })],
      "写第二章，必须承接第一章视角",
    );

    expect(report.verdict).toBe("fail");
    expect(report.issues).toContainEqual(expect.objectContaining({
      area: "chapter",
      message: expect.stringContaining("验收标准"),
    }));
  });
});

function change(type: StagedChange["type"], payload: unknown): StagedChange {
  return { id: `${type}-1`, type, payload };
}
