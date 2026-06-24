import { describe, expect, it } from "vitest";
import { runExecutor } from "../../../../src/ai/orchestrator/executor-agent.js";

describe("executor-agent", () => {
  const deps = {
    model: {},
    handle: {
      bookId: "book-1",
      charactersRepo: { list: () => [] },
      outlineRepo: { listAll: () => [] },
    },
  };

  it("stages a chapter version for a write_chapter contract", async () => {
    const plan = await runExecutor(deps, {
      intent: "write_chapter",
      userInstruction: "写第二章",
      affectedEntities: [],
      targetChapterNo: 2,
      chapterTitle: "第二章",
      draft: "这是第二章正文，内容来自主 Agent 的隐藏正文。",
    });

    expect(plan.summary).toContain("章节");
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]).toMatchObject({
      type: "chapter_version",
      payload: {
        chapterNo: 2,
        title: "第二章",
        content: "这是第二章正文，内容来自主 Agent 的隐藏正文。",
      },
    });
  });

  it("does not stage a chapter write without hidden draft content", async () => {
    const plan = await runExecutor(deps, {
      intent: "write_chapter",
      userInstruction: "写第二章",
      affectedEntities: [],
      targetChapterNo: 2,
    });

    expect(plan.steps).toEqual([]);
    expect(plan.summary).toContain("缺少正文草稿");
  });

  it("stages outline changes for update_outline instead of silently no-oping", async () => {
    const plan = await runExecutor(deps, {
      intent: "update_outline",
      userInstruction: "把前三章大纲整理清楚",
      affectedEntities: ["第一章", "第二章"],
    });

    expect(plan.summary).toContain("大纲");
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0]).toMatchObject({
      type: "outline_upsert",
      payload: {
        level: "chapter",
        title: "第一章",
      },
    });
  });

  it("stages worldbook changes for update_worldbook", async () => {
    const plan = await runExecutor(deps, {
      intent: "update_worldbook",
      userInstruction: "把灵力规则写进世界书",
      affectedEntities: ["灵力规则"],
    });

    expect(plan.summary).toContain("世界书");
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]).toMatchObject({
      type: "worldbook_upsert",
      payload: {
        title: "灵力规则",
        enabled: true,
      },
    });
  });

  it("stages audit records for asset_audit so active review has visible work", async () => {
    const plan = await runExecutor(deps, {
      intent: "asset_audit",
      userInstruction: "全量审查角色和设定",
      affectedEntities: [],
      target: { auditScope: { assets: ["characters", "worldbook"], mode: "report_only" } },
    });

    expect(plan.summary).toContain("审查");
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]).toMatchObject({
      type: "chapter_audit",
      payload: {
        chapterNo: 0,
        verdict: "ok",
      },
    });
  });

  it("uses structured asset changes so model-provided content is not dropped", async () => {
    const plan = await runExecutor(deps, {
      intent: "update_worldbook",
      userInstruction: "把灵力规则写进世界书",
      affectedEntities: [],
      assetChanges: [
        {
          type: "worldbook",
          title: "灵力规则",
          content: "灵力来自地脉，不能凭空恢复，透支后会留下三天虚弱期。",
          keys: ["灵力", "地脉"],
        },
      ],
    });

    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]).toMatchObject({
      type: "worldbook_upsert",
      payload: {
        title: "灵力规则",
        content: "灵力来自地脉，不能凭空恢复，透支后会留下三天虚弱期。",
        keys: ["灵力", "地脉"],
      },
    });
  });

  it("uses structured outline changes instead of reducing chapters to bare titles", async () => {
    const plan = await runExecutor(deps, {
      intent: "update_outline",
      userInstruction: "整理前两章大纲",
      affectedEntities: [],
      assetChanges: [
        {
          type: "outline",
          title: "第一章 雨夜归家",
          level: "chapter",
          summary: "主角以第一人称回到旧宅，发现书桌上的信被人动过。",
          sortOrder: 1,
        },
      ],
    });

    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]).toMatchObject({
      type: "outline_upsert",
      payload: {
        level: "chapter",
        title: "第一章 雨夜归家",
        summary: "主角以第一人称回到旧宅，发现书桌上的信被人动过。",
        sortOrder: 1,
      },
    });
  });
});
