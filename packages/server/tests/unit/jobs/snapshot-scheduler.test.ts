import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSnapshotScheduler } from "../../../src/jobs/snapshot-scheduler.js";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("snapshot scheduler", () => {
  it("每 intervalMs 触发一次", () => {
    const calls: string[] = [];
    const sch = createSnapshotScheduler({
      intervalMs: 1000,
      doSnapshot: async (id) => {
        calls.push(id);
      },
    });
    sch.start(() => ["b1", "b2"]);
    vi.advanceTimersByTime(1000);
    expect(calls).toEqual(["b1", "b2"]);
    vi.advanceTimersByTime(1000);
    expect(calls).toEqual(["b1", "b2", "b1", "b2"]);
    sch.stop();
  });

  it("onChapterCommitted 每 5 次触发一次,counter 重置", async () => {
    const calls: string[] = [];
    const sch = createSnapshotScheduler({
      chaptersThreshold: 5,
      doSnapshot: async (id) => {
        calls.push(id);
      },
    });
    for (let i = 0; i < 5; i++) sch.onChapterCommitted("b1");
    await Promise.resolve();
    expect(calls).toEqual(["b1"]);
    sch.onChapterCommitted("b1");
    await Promise.resolve();
    expect(calls).toEqual(["b1"]);
    for (let i = 0; i < 4; i++) sch.onChapterCommitted("b1");
    await Promise.resolve();
    expect(calls).toEqual(["b1", "b1"]);
  });

  it("不同 bookId 计数器独立", () => {
    const calls: string[] = [];
    const sch = createSnapshotScheduler({
      chaptersThreshold: 2,
      doSnapshot: async (id) => {
        calls.push(id);
      },
    });
    sch.onChapterCommitted("b1");
    sch.onChapterCommitted("b2");
    sch.onChapterCommitted("b1");
    expect(calls).toEqual(["b1"]);
    sch.onChapterCommitted("b2");
    expect(calls).toEqual(["b1", "b2"]);
  });
});
