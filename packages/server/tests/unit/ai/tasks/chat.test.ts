import { describe, expect, it, vi } from "vitest";
import { chatTask } from "../../../../src/ai/tasks/chat.js";

describe("chatTask", () => {
  it("流式吐 reply,apply 空跑,不改任何 repo", async () => {
    const write = vi.fn();
    const ctx = {
      handle: {
        workspaceDb: { transaction: (fn: () => void) => () => fn() },
        charactersRepo: { list: () => [], create: write, update: write },
      } as any,
      writeModel: {} as any, auditModel: {} as any,
      request: { message: "你好", source: "chat" as const },
    } as any;
    const task = chatTask.withDeps?.({ streamReply: async function* () { yield "你好啊。"; } }) ?? chatTask;
    const deltas: string[] = [];
    for await (const ev of task.stream(ctx)) if (ev.type === "text_delta") deltas.push(ev.delta);
    const parsed = await task.parse(ctx, deltas.join(""));
    task.apply(ctx, parsed);
    expect(parsed.reply).toBe("你好啊。");
    expect(write).not.toHaveBeenCalled();
  });

  it("stream 未收到任何输出 → parse 仍返回 empty reply(不抛错)", async () => {
    const ctx = {
      handle: {} as any,
      writeModel: {} as any, auditModel: {} as any,
      request: { message: "你好", source: "chat" as const },
    } as any;
    const task = chatTask.withDeps?.({ streamReply: async function* () { /* nothing */ } }) ?? chatTask;
    const deltas: string[] = [];
    for await (const ev of task.stream(ctx)) if (ev.type === "text_delta") deltas.push(ev.delta);
    const parsed = await task.parse(ctx, deltas.join(""));
    expect(parsed.reply).toBe("");
  });

  it("apply 不调 workspaceDb.transaction(明确证明零副作用)", () => {
    const txFn = vi.fn();
    const ctx = {
      handle: {
        workspaceDb: { transaction: txFn },
        charactersRepo: { list: () => [], create: vi.fn(), update: vi.fn() },
      } as any,
      request: { message: "x", source: "chat" as const },
    } as any;
    chatTask.apply(ctx, { reply: "x" });
    expect(txFn).not.toHaveBeenCalled();
  });
});
