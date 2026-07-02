import { describe, expect, it, vi } from "vitest";
import { dispatchTask } from "../../../../src/ai/tasks/dispatch.js";
import type { TaskDef, TaskContext } from "../../../../src/ai/tasks/types.js";

describe("dispatchTask", () => {
  const baseCtx = {} as TaskContext;

  it("流式 delta → 收集正文 → parse → apply,发 done committed=true", async () => {
    const apply = vi.fn();
    const task: TaskDef<{ text: string }> = {
      name: "t",
      mutates: true,
      stream: async function* () { yield { type: "text_delta", delta: "a" }; yield { type: "text_delta", delta: "b" }; },
      parse: async (_ctx, text) => ({ text }),
      apply,
    };
    const events = [];
    for await (const ev of dispatchTask(task, baseCtx)) events.push(ev);
    expect(events.filter(e => e.type === "text_delta")).toEqual([
      { type: "text_delta", delta: "a" },
      { type: "text_delta", delta: "b" },
    ]);
    expect(apply).toHaveBeenCalledWith(baseCtx, { text: "ab" });
    expect(events.at(-1)).toEqual({ type: "done", committed: true });
  });

  it("mutates=false 的任务(纯对话)→ done committed=false", async () => {
    const task: TaskDef = {
      name: "chat-like",
      mutates: false,
      stream: async function* () { yield { type: "text_delta", delta: "你好" }; },
      parse: async (_ctx, text) => ({ reply: text }),
      apply: () => {},
    };
    const events = [];
    for await (const ev of dispatchTask(task, baseCtx)) events.push(ev);
    expect(events.at(-1)).toEqual({ type: "done", committed: false });
  });

  it("stream 抛错 → 发 error stream_failed,不 parse 不 apply", async () => {
    const apply = vi.fn();
    const task: TaskDef = {
      name: "t",
      mutates: true,
      stream: async function* () { throw new Error("boom"); },
      parse: async () => { throw new Error("must not call parse"); },
      apply,
    };
    const events = [];
    for await (const ev of dispatchTask(task, baseCtx)) events.push(ev);
    expect(events.at(-1)).toMatchObject({ type: "error", errorClass: "stream_failed", message: "boom" });
    expect(apply).not.toHaveBeenCalled();
  });

  it("apply 抛错 → 发 error apply_failed", async () => {
    const task: TaskDef = {
      name: "t",
      mutates: true,
      stream: async function* () { yield { type: "text_delta", delta: "x" }; },
      parse: async (_ctx, text) => ({ text }),
      apply: () => { throw new Error("db fail"); },
    };
    const events = [];
    for await (const ev of dispatchTask(task, baseCtx)) events.push(ev);
    expect(events.at(-1)).toMatchObject({ type: "error", errorClass: "apply_failed", message: "db fail" });
  });

  it("stream 抛非 Error 值(字符串)→ 仍产出 error,不炸", async () => {
    const task: TaskDef = {
      name: "t",
      mutates: true,
      stream: async function* () { throw "just a string"; },
      parse: async () => ({}),
      apply: () => {},
    };
    const events = [];
    for await (const ev of dispatchTask(task, {} as TaskContext)) events.push(ev);
    expect(events.at(-1)).toMatchObject({ type: "error", errorClass: "stream_failed", message: "just a string" });
  });
});
