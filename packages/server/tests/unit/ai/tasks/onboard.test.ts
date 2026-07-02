import { describe, expect, it } from "vitest";
import { onboardTask } from "../../../../src/ai/tasks/onboard.js";

function rig() {
  const chars: any[] = [];
  const outline: any[] = [];
  const wb: any[] = [];
  // 真实 bookMetaRepo 是 get(key)/set(key,value) 的 KV store，没有 upsert()
  // （见 packages/server/src/db/repositories/book-meta.ts）。计划草稿假设的
  // `{ get: () => ({title,premise}), upsert: () => {} }` 形状与真实仓库不符，这里改用真实签名。
  const meta: Record<string, string> = {};
  return {
    chars, outline, wb, meta,
    handle: {
      workspaceDb: { transaction: (fn: () => void) => () => fn() },
      charactersRepo: { list: () => chars, create: (c: any) => chars.push({ ...c, id: `c${chars.length}` }) },
      outlineRepo: { listAll: () => outline, create: (o: any) => outline.push({ ...o, id: `o${outline.length}` }) },
      worldbookRepo: { list: () => wb, create: (w: any) => wb.push({ ...w, id: `w${wb.length}` }) },
      bookMetaRepo: { get: (k: string) => meta[k], set: (k: string, v: string) => { meta[k] = v; } },
    } as any,
  };
}

describe("onboardTask", () => {
  it("parse 抽出主角 + 大纲首卷 + 世界书条目,apply 全落库", async () => {
    const r = rig();
    const ctx = {
      handle: r.handle, writeModel: {} as any, auditModel: {} as any,
      request: { message: "废土世界,主角林尘,寻找失落的黑剑", source: "onboard" as const },
    } as any;
    const task = onboardTask.withDeps?.({
      streamReply: async function* () { yield "好的,已初始化设定草案。"; },
      extractStructured: async () => ({
        title: "废土黑剑",
        premise: "废土年代,林尘寻剑之旅",
        characters: [{ name: "林尘", role: "protagonist", baseData: { age: 22 }, currentState: {} }],
        outline: [{ title: "第一卷:出走", level: "volume", summary: "林尘离开小镇" }],
        worldbook: [{ title: "废土", content: "核战后 200 年的废土大陆", keys: ["废土", "大陆"] }],
      }),
    }) ?? onboardTask;

    const deltas: string[] = [];
    for await (const ev of task.stream(ctx)) if (ev.type === "text_delta") deltas.push(ev.delta);
    expect(deltas.join("")).toContain("已初始化");

    const parsed = await task.parse(ctx, deltas.join(""));
    task.apply(ctx, parsed);

    expect(r.chars).toEqual([expect.objectContaining({ name: "林尘", role: "protagonist" })]);
    expect(r.outline[0]).toMatchObject({ title: "第一卷:出走", level: "volume" });
    expect(r.wb[0]).toMatchObject({ title: "废土", keys: ["废土", "大陆"] });
    expect(r.meta.title).toBe("废土黑剑");
    expect(r.meta.premise).toBe("废土年代,林尘寻剑之旅");
  });

  it("抽取结果没内容 → apply 空跑不抛错", () => {
    const r = rig();
    const ctx = { handle: r.handle, request: { message: "x", source: "onboard" } } as any;
    onboardTask.apply(ctx, { reply: "空", characters: [], outline: [], worldbook: [] } as any);
    expect(r.chars).toEqual([]);
    expect(r.outline).toEqual([]);
    expect(r.wb).toEqual([]);
  });

  it("apply:重复 onboard 已存在角色/世界书不新建", () => {
    const r = rig();
    // 预置已有角色和世界书
    r.chars.push({ id: "c0", name: "林尘", role: "protagonist" });
    r.wb.push({ id: "w0", title: "废土", content: "旧内容", keys: ["废土"] });
    const ctx = { handle: r.handle, request: { message: "x", source: "onboard" } } as any;
    onboardTask.apply(ctx, {
      reply: "x", title: "", premise: "",
      characters: [{ name: "林尘", role: "protagonist", baseData: {}, currentState: {} }],
      outline: [],
      worldbook: [{ title: "废土", content: "新内容(不应覆盖)", keys: ["废土"] }],
    } as any);
    expect(r.chars).toHaveLength(1);   // 仍是 1 个
    expect(r.wb).toHaveLength(1);      // 仍是 1 个
    expect(r.wb[0].content).toBe("旧内容");   // 未被覆盖
  });

  it("apply:outline sortOrder 追加到已有节点之后", () => {
    const r = rig();
    r.outline.push({ id: "o0", title: "旧卷", level: "volume", sortOrder: 0 });
    r.outline.push({ id: "o1", title: "旧弧", level: "arc", sortOrder: 1 });
    const ctx = { handle: r.handle, request: { message: "x", source: "onboard" } } as any;
    onboardTask.apply(ctx, {
      reply: "x", title: "", premise: "",
      characters: [],
      outline: [
        { title: "新卷 A", level: "volume", summary: "", parentId: null },
        { title: "新卷 B", level: "volume", summary: "", parentId: null },
      ],
      worldbook: [],
    } as any);
    const newOnes = r.outline.slice(2);
    expect(newOnes[0].sortOrder).toBeGreaterThanOrEqual(2);
    expect(newOnes[1].sortOrder).toBeGreaterThan(newOnes[0].sortOrder);
  });

  it("apply:parsed.title/premise 为空时不覆盖已有 meta", () => {
    const r = rig();
    const setCalls: any[] = [];
    r.handle.bookMetaRepo.set = (key: string, value: string) => setCalls.push({ key, value });
    const ctx = { handle: r.handle, request: { message: "x", source: "onboard" } } as any;
    onboardTask.apply(ctx, {
      reply: "x", title: "", premise: "",
      characters: [], outline: [], worldbook: [],
    } as any);
    expect(setCalls).toEqual([]);  // 一次 set 也没调
  });
});
