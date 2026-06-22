import { describe, it, expect } from "vitest";
import {
  isOnboardComplete,
  formatCompletenessHint,
} from "../../../../src/ai/orchestrator/onboard-completeness.js";
import type { BookSnapshot } from "../../../../src/ai/context-builder/snapshot.js";

function makeSnap(overrides: Partial<BookSnapshot>): BookSnapshot {
  return {
    bookId: "b1",
    meta: { title: "x", premise: "" },
    rulesMd: "",
    characters: [],
    outline: [],
    activeForeshadowing: [],
    paidForeshadowing: [],
    recentSummaries: [],
    allSummaries: [],
    genreSections: [],
    worldbookEntries: [],
    promptPresets: [],
    promptBlocks: [],
    readerIssues: [],
    ...overrides,
  };
}

describe("isOnboardComplete", () => {
  it("全空:missing 含 4 项", () => {
    const r = isOnboardComplete(makeSnap({}));
    expect(r.ok).toBe(false);
    expect(r.missing).toContain("题材");
    expect(r.missing).toContain("主角");
    expect(r.missing).toContain("章级大纲");
    expect(r.missing).toContain("调性或前提(至少一项)");
  });

  it("齐全(genre + protagonist + chapter outline + 2 项 extras):ok=true", () => {
    const r = isOnboardComplete(
      makeSnap({
        meta: {
          title: "x",
          premise: "前提",
          tone: "清冷",
          genre: "仙侠",
        },
        characters: [
          {
            id: "c1",
            name: "林尘",
            role: "protagonist",
            baseData: {},
            currentState: {},
            appearances: [],
            updatedAt: 1,
          },
        ],
        outline: [
          {
            id: "o1",
            parentId: null,
            level: "chapter",
            title: "第1章 雨夜来信",
            summary: "本章写主角收到信并决定出发",
            status: "planned",
            sortOrder: 0,
            metadata: null,
          },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    expect(r.missing).toHaveLength(0);
  });

  it("缺主角:ok=false 且 missing 含'主角'", () => {
    const r = isOnboardComplete(
      makeSnap({
        meta: {
          title: "x",
          premise: "前提",
          tone: "清冷",
          genre: "仙侠",
        },
        outline: [
          {
            id: "o1",
            parentId: null,
            level: "chapter",
            title: "第1章 雨夜来信",
            summary: "本章写主角收到信并决定出发",
            status: "planned",
            sortOrder: 0,
            metadata: null,
          },
        ],
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(["主角"]);
  });

  it("只有 premise(1 项 extras):ok=true（至少一项即可）", () => {
    const r = isOnboardComplete(
      makeSnap({
        meta: { title: "x", premise: "前提", genre: "仙侠" },
        characters: [
          {
            id: "c1",
            name: "林尘",
            role: "protagonist",
            baseData: {},
            currentState: {},
            appearances: [],
            updatedAt: 1,
          },
        ],
        outline: [
          {
            id: "o1",
            parentId: null,
            level: "chapter",
            title: "第1章 雨夜来信",
            summary: "本章写主角收到信并决定出发",
            status: "planned",
            sortOrder: 0,
            metadata: null,
          },
        ],
      }),
    );
    expect(r.ok).toBe(true);
  });

  it("arc alone is not enough because onboarding requires a precise chapter outline", () => {
    const r = isOnboardComplete(
      makeSnap({
        meta: { title: "x", premise: "p", tone: "t", genre: "仙侠" },
        characters: [
          {
            id: "c1",
            name: "x",
            role: "protagonist",
            baseData: {},
            currentState: {},
            appearances: [],
            updatedAt: 1,
          },
        ],
        outline: [
          {
            id: "o1",
            parentId: null,
            level: "arc",
            title: "弧 1",
            summary: null,
            status: "planned",
            sortOrder: 0,
            metadata: null,
          },
        ],
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.missing).toContain("章级大纲");
  });

  it("chapter outline satisfies the outline requirement", () => {
    const r = isOnboardComplete(
      makeSnap({
        meta: { title: "x", premise: "p", tone: "t", genre: "仙侠" },
        characters: [
          {
            id: "c1",
            name: "x",
            role: "protagonist",
            baseData: {},
            currentState: {},
            appearances: [],
            updatedAt: 1,
          },
        ],
        outline: [
          {
            id: "o1",
            parentId: null,
            level: "chapter",
            title: "第 1 章",
            summary: null,
            status: "planned",
            sortOrder: 0,
            metadata: null,
          },
        ],
      }),
    );
    expect(r.ok).toBe(true);
  });

  it("配角不算主角", () => {
    const r = isOnboardComplete(
      makeSnap({
        meta: { title: "x", premise: "p", tone: "t", genre: "仙侠" },
        characters: [
          {
            id: "c1",
            name: "x",
            role: "supporting",
            baseData: {},
            currentState: {},
            appearances: [],
            updatedAt: 1,
          },
        ],
        outline: [
          {
            id: "o1",
            parentId: null,
            level: "chapter",
            title: "第1章 雨夜来信",
            summary: "本章写主角收到信并决定出发",
            status: "planned",
            sortOrder: 0,
            metadata: null,
          },
        ],
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.missing).toContain("主角");
  });
});

describe("formatCompletenessHint", () => {
  it("ok=true:返回收尾提示", () => {
    expect(formatCompletenessHint({ ok: true, missing: [] })).toContain(
      "已完整",
    );
  });

  it("ok=false:列出缺项", () => {
    expect(
      formatCompletenessHint({ ok: false, missing: ["题材", "主角"] }),
    ).toContain("题材、主角");
  });
});
