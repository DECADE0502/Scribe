import { describe, expect, it, vi } from "vitest";
import { reviseTask } from "../../../../src/ai/tasks/revise.js";

function rig() {
  const versions: any[] = [];
  const files: any[] = [];
  return {
    versions, files,
    handle: {
      bookId: "b1",
      workspaceDb: { transaction: (fn: () => void) => () => fn() },
      chaptersRepo: {
        saveVersion: (v: any) => { const r = { ...v, versionNo: versions.length + 1 }; versions.push(r); return r; },
        deleteVersion: (no: number, ver: number) => { const i = versions.findIndex(v => v.chapterNo === no && v.versionNo === ver); if (i >= 0) versions.splice(i, 1); },
      },
      chapterFiles: {
        read: (no: number) => ({ content: `原第 ${no} 章:开头。要改的段落。结尾。` }),
        save: (f: any) => files.push(f),
      },
    } as any,
  };
}

describe("reviseTask", () => {
  it("parse 拿到新段落,apply 用新段落替换选中原文,拼回整章", async () => {
    const r = rig();
    const ctx = {
      handle: r.handle, writeModel: {} as any, auditModel: {} as any,
      request: {
        message: "把这段改得更紧张", source: "revision",
        target: { revisionRange: { chapterNo: 3, selectedText: "要改的段落。" } },
      },
    } as any;
    const task = reviseTask.withDeps?.({
      streamRevised: async function* () { yield "全新的、更紧张的段落。"; },
    }) ?? reviseTask;

    const deltas: string[] = [];
    for await (const ev of task.stream(ctx)) if (ev.type === "text_delta") deltas.push(ev.delta);
    const parsed = await task.parse(ctx, deltas.join(""));
    expect(parsed.mergedContent).toBe("原第 3 章:开头。全新的、更紧张的段落。结尾。");
    task.apply(ctx, parsed);
    expect(r.versions[0]).toMatchObject({ chapterNo: 3, contentMd: expect.stringContaining("全新的") });
    expect(r.files[0]).toMatchObject({ chapterNo: 3, content: expect.stringContaining("全新的") });
  });

  it("selectedText 在原章找不到 → parse 抛 selection_missing", async () => {
    const r = rig();
    const ctx = {
      handle: r.handle,
      request: { message: "改", source: "revision", target: { revisionRange: { chapterNo: 3, selectedText: "根本不存在的文本" } } },
    } as any;
    const task = reviseTask.withDeps?.({ streamRevised: async function* () { yield "新段落"; } }) ?? reviseTask;
    await expect(task.parse(ctx, "新段落")).rejects.toThrow(/selection_missing/);
  });
});
