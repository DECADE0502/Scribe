import { describe, expect, it, vi } from "vitest";
import { writeChapterTask } from "../../../../src/ai/tasks/write-chapter.js";
import type { TaskContext } from "../../../../src/ai/tasks/types.js";

function mockHandle() {
  const versions: any[] = [];
  const chars: any[] = [];
  const timeline: any[] = [];
  const foreshadowing: any[] = [];
  const files: any[] = [];
  const summaries: any[] = [];
  return {
    versions, chars, timeline, foreshadowing, files, summaries,
    handle: {
      bookId: "b1",
      workspaceDb: { transaction: (fn: () => void) => () => fn() },
      chaptersRepo: {
        saveVersion: (v: any) => { const rec = { ...v, versionNo: versions.length + 1 }; versions.push(rec); return rec; },
        deleteVersion: (no: number, ver: number) => { const i = versions.findIndex(v => v.chapterNo === no && v.versionNo === ver); if (i >= 0) versions.splice(i, 1); },
        listSummaries: () => [], saveSummary: (s: any) => summaries.push(s), saveAudit: () => {},
      },
      chapterFiles: { save: (f: any) => files.push(f), list: () => [], read: () => undefined },
      charactersRepo: { list: () => chars, create: (c: any) => chars.push({ ...c, id: `c${chars.length}` }), update: (id: string, patch: any) => { const i = chars.findIndex(x => x.id === id); Object.assign(chars[i], patch); } },
      foreshadowingRepo: {
        list: () => foreshadowing,
        create: (f: any) => foreshadowing.push({ ...f, id: `f${foreshadowing.length}` }),
        update: (id: string, patch: any) => { const i = foreshadowing.findIndex(x => x.id === id); if (i >= 0) Object.assign(foreshadowing[i], patch); },
      },
      timelineRepo: { listAll: () => timeline, create: (e: any) => timeline.push({ ...e, id: `t${timeline.length}` }) },
      outlineRepo: { listAll: () => [], findChapterNode: () => undefined },
      genreSectionsRepo: { listSections: () => [], listItems: () => [], addItem: () => {} },
      worldbookRepo: { list: () => [] },
      promptPresetsRepo: { listPresets: () => [], listBlocks: () => [] },
      readerIssuesRepo: { listOpen: () => [], add: () => {} },
      bookMetaRepo: { get: () => undefined },
    } as any,
  };
}

describe("writeChapterTask", () => {
  it("stream 流式吐 delta,parse 用 auditModel 抽取角色/伏笔/时间线", async () => {
    const { handle } = mockHandle();
    const ctx: TaskContext = {
      handle,
      request: { message: "写第 5 章", source: "editor", target: { chapterNo: 5 } },
      writeModel: {} as any,
      auditModel: {} as any,
    };

    // 注入:stream 用假的 streamLlm 直接产 delta;parse 内部调用 extractStructured (mock)
    // 第三段填充到 >= MIN_DRAFT_CHARS(500),否则会被 draft_too_short 拦下(见下方独立测试)。
    const padding = "江湖夜雨十年灯。".repeat(70);
    const task = writeChapterTask.withDeps?.({
      streamProse: async function* () { yield "我推开门。"; yield "冷风扑面。"; yield padding; },
      extractStructured: async () => ({
        characters: [{ name: "林尘", currentState: { location: "山顶" } }],
        foreshadowing: [{ label: "黑剑", plantedChapter: 5, status: "planted", relatedCharacters: ["林尘"] }],
        timeline: [{ chapterNo: 5, storyTime: "第七日午后", event: "登山遇剑", participants: ["林尘"] }],
      }),
    }) ?? writeChapterTask;

    const deltas: string[] = [];
    for await (const ev of task.stream(ctx)) if (ev.type === "text_delta") deltas.push(ev.delta);
    expect(deltas.join("")).toBe("我推开门。冷风扑面。" + padding);

    const parsed = await task.parse(ctx, deltas.join(""));
    expect(parsed).toMatchObject({
      chapterNo: 5,
      content: expect.stringContaining("推开门"),
      characters: [expect.objectContaining({ name: "林尘" })],
      foreshadowing: [expect.objectContaining({ label: "黑剑" })],
      timeline: [expect.objectContaining({ chapterNo: 5 })],
    });
  });

  it("apply 写章 + 追加角色状态 + 伏笔 + 时间线,事务内", () => {
    const rig = mockHandle();
    const ctx = { handle: rig.handle, request: { message: "写第 5 章", source: "editor", target: { chapterNo: 5 } } } as any;

    writeChapterTask.apply(ctx, {
      chapterNo: 5, title: "第 5 章", content: "我推开门。".repeat(100),
      characters: [{ name: "林尘", role: "protagonist", baseData: {}, currentState: { location: "山顶" } }],
      foreshadowing: [{ label: "黑剑", plantedChapter: 5, status: "planted", relatedCharacters: ["林尘"] }],
      timeline: [{ chapterNo: 5, storyTime: "第七日午后", event: "登山遇剑", participants: ["林尘"] }],
    } as any);

    expect(rig.versions).toHaveLength(1);
    expect(rig.files).toHaveLength(1);
    expect(rig.chars).toEqual([expect.objectContaining({ name: "林尘" })]);
    expect(rig.foreshadowing).toEqual([expect.objectContaining({ label: "黑剑" })]);
    expect(rig.timeline).toEqual([expect.objectContaining({ event: "登山遇剑" })]);
  });

  it("apply 时 chapterFiles.save 失败 → 反向删掉刚建的版本", () => {
    const rig = mockHandle();
    rig.handle.chapterFiles.save = () => { throw new Error("disk full"); };
    const ctx = { handle: rig.handle, request: { source: "editor", target: { chapterNo: 5 } } } as any;

    expect(() => writeChapterTask.apply(ctx, {
      chapterNo: 5, title: "第 5 章", content: "x".repeat(500),
      characters: [], foreshadowing: [], timeline: [],
    } as any)).toThrow(/disk full/);

    expect(rig.versions).toHaveLength(0);   // 已删掉
  });

  it("parse:extractStructured 抛错时,错误向上传递(dispatch 会捕获)", async () => {
    const { handle } = mockHandle();
    const ctx = { handle, request: { source: "editor", target: { chapterNo: 5 } } } as any;
    const task = writeChapterTask.withDeps?.({
      streamProse: async function* () { yield "长长的正文。".repeat(100); },
      extractStructured: async () => { throw new Error("model quota exceeded"); },
    }) ?? writeChapterTask;
    await expect(task.parse(ctx, "长长的正文。".repeat(100))).rejects.toThrow(/model quota exceeded/);
  });

  it("parse:内容不足 500 字抛 draft_too_short", async () => {
    const { handle } = mockHandle();
    const ctx = { handle, request: { source: "editor", target: { chapterNo: 5 } } } as any;
    const task = writeChapterTask.withDeps?.({
      streamProse: async function* () { yield "太短。"; },
      extractStructured: async () => ({ characters: [], foreshadowing: [], timeline: [] }),
    }) ?? writeChapterTask;
    await expect(task.parse(ctx, "太短。")).rejects.toThrow(/draft_too_short/);
  });

  it("apply:抽取带 summary 时写入 chapter_summaries(中程记忆数据源)", () => {
    const rig = mockHandle();
    const ctx = { handle: rig.handle, request: { source: "editor", target: { chapterNo: 5 } } } as any;

    writeChapterTask.apply(ctx, {
      chapterNo: 5, title: "第 5 章", content: "x".repeat(500),
      characters: [], foreshadowing: [], timeline: [],
      summary: {
        oneLiner: "林尘登山得剑",
        paragraph: "林尘在暮色中登上山脊,于崖壁裂缝里发现一柄黑剑,决意带回村中查证来历。",
        keyEvents: [
          { event: "登山", characters: ["林尘"], foreshadowingRefs: [] },
          { event: "  ", characters: [], foreshadowingRefs: [] },   // 空事件应被过滤
        ],
      },
    } as any);

    expect(rig.summaries).toHaveLength(1);
    expect(rig.summaries[0]).toMatchObject({
      chapterNo: 5,
      oneLiner: "林尘登山得剑",
      reasoningContent: null,
    });
    expect(rig.summaries[0].keyEvents).toHaveLength(1);
    expect(rig.summaries[0].generatedAt).toBeGreaterThan(0);
  });

  it("apply:summary 为空时不写 chapter_summaries", () => {
    const rig = mockHandle();
    const ctx = { handle: rig.handle, request: { source: "editor", target: { chapterNo: 5 } } } as any;
    writeChapterTask.apply(ctx, {
      chapterNo: 5, title: "第 5 章", content: "x".repeat(500),
      characters: [], foreshadowing: [], timeline: [],
      summary: { oneLiner: "", paragraph: "", keyEvents: [] },
    } as any);
    expect(rig.summaries).toEqual([]);
  });

  it("apply:空名角色/空标签伏笔/空事件时间线全部跳过(抽取噪音不落库)", () => {
    const rig = mockHandle();
    const ctx = { handle: rig.handle, request: { source: "editor", target: { chapterNo: 5 } } } as any;

    writeChapterTask.apply(ctx, {
      chapterNo: 5, title: "第 5 章", content: "x".repeat(500),
      characters: [{ name: "   ", role: "supporting", baseData: {}, currentState: {} }],
      foreshadowing: [{ label: "", description: "有描述但没标签", status: "planted", relatedCharacters: [] }],
      timeline: [{ storyTime: "夜", event: "  ", participants: [] }],
    } as any);

    expect(rig.chars).toEqual([]);
    expect(rig.foreshadowing).toEqual([]);
    expect(rig.timeline).toEqual([]);
    expect(rig.versions).toHaveLength(1); // 章节本身照常落库
  });
});
