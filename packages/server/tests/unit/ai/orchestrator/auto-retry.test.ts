import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { runMigrations } from "../../../../src/db/migrations/runner.js";
import { createChaptersRepo } from "../../../../src/db/repositories/chapters.js";
import { createChapterFiles } from "../../../../src/fs/chapter-files.js";
import { runAutoMode } from "../../../../src/ai/orchestrator/auto-mode.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const okAudit = JSON.stringify({
  verdict: "ok",
  issues: Array.from({ length: 7 }, (_, i) => ({
    dimension: ["setting_consistency","character_behavior","pacing","narrative_coherence","foreshadowing","hook_strength","aesthetic_quality"][i],
    severity: "ok", score: 8, note: "ok",
  })),
  summary: { oneLiner: "一句话", paragraph: "段落".repeat(30), keyEvents: [] },
});

/** 前 failTimes 次 doStream 中途抛 terminated,之后正常产出正文 */
function makeFlakyWriteModel(failTimes: number) {
  let calls = 0;
  return {
    specificationVersion: "v1" as const, provider: "stub", modelId: "stub-write",
    async doGenerate() { throw new Error("not used"); },
    async doStream() {
      const n = ++calls;
      return {
        stream: new ReadableStream({
          start(ctrl) {
            if (n <= failTimes) {
              ctrl.enqueue({ type: "text-delta", textDelta: "半截" });
              ctrl.error(new Error("terminated")); // 模拟 provider 断流
              return;
            }
            ctrl.enqueue({ type: "text-delta", textDelta: "完整正文。" });
            ctrl.enqueue({ type: "finish", finishReason: "stop", usage: { promptTokens: 10, completionTokens: 5 } });
            ctrl.close();
          },
        }),
        rawCall: { rawPrompt: null, rawSettings: {} },
      };
    },
  };
}

function makeAuditModel() {
  return {
    specificationVersion: "v1" as const, provider: "stub", modelId: "stub-audit",
    async doGenerate() {
      return { text: okAudit, finishReason: "stop", usage: { promptTokens: 10, completionTokens: 5 }, rawCall: { rawPrompt: null, rawSettings: {} } };
    },
    async doStream() { throw new Error("not used"); },
  };
}

function makeFailingAuditModel() {
  return {
    specificationVersion: "v1" as const, provider: "stub", modelId: "stub-audit",
    async doGenerate() {
      throw new Error("audit boom");
    },
    async doStream() { throw new Error("not used"); },
  };
}

let db: any, tmpDir: string, chaptersRepo: any, chapterFiles: any;

beforeEach(() => {
  db = new Database(":memory:");
  const initSql = fs.readFileSync(path.join(__dirname, "../../../../src/db/migrations/workspace/001_init.sql"), "utf-8");
  runMigrations(db, [{ name: "001_init.sql", sql: initSql }]);
  chaptersRepo = createChaptersRepo(db);
  tmpDir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "auto-retry-"));
  chapterFiles = createChapterFiles(tmpDir);
});
afterEach(() => { try { db.close(); } catch {} fs.rmSync(tmpDir, { recursive: true, force: true }); });

async function collect(it: AsyncIterable<any>): Promise<any[]> {
  const out: any[] = []; for await (const e of it) out.push(e); return out;
}

const info = { id: "m", pricing: { input: 1, output: 1 } };

describe("runAutoMode 写作瞬时断流重试", () => {
  it("写流断一次后自动重试并成功落盘,不终结整轮", async () => {
    const write = makeFlakyWriteModel(1); // 第 1 次断流,第 2 次成功
    const evs = await collect(runAutoMode(
      {
        model: write as never, auditModel: makeAuditModel() as never, auditModelId: "m",
        chaptersRepo, chapterFiles,
        maxChapterNo: () => chaptersRepo.maxChapterNo(),
        getVerdict: (no: number) => chaptersRepo.getAudit(no)?.verdict,
        budgetLimitUsd: 50, writeModelInfo: info, auditModelInfo: info,
      },
      { n: 1 },
    ));
    const final = evs.filter(e => e.type === "auto_status").at(-1);
    expect(final.state).toBe("done");
    expect(chaptersRepo.maxChapterNo()).toBe(1);
    expect(chapterFiles.read(1)?.content).toContain("完整正文");
    // 不应有 error 事件冒泡
    expect(evs.some(e => e.type === "error")).toBe(false);
  });

  it("连续断流超过重试上限 → 终结为 error", async () => {
    const write = makeFlakyWriteModel(5); // 一直断流
    const evs = await collect(runAutoMode(
      {
        model: write as never, auditModel: makeAuditModel() as never, auditModelId: "m",
        chaptersRepo, chapterFiles,
        maxChapterNo: () => chaptersRepo.maxChapterNo(),
        getVerdict: (no: number) => chaptersRepo.getAudit(no)?.verdict,
        budgetLimitUsd: 50, writeModelInfo: info, auditModelInfo: info,
      },
      { n: 1 },
    ));
    const final = evs.filter(e => e.type === "auto_status").at(-1);
    expect(final.state).toBe("error");
    expect(chaptersRepo.maxChapterNo()).toBe(0);
    expect(evs.some(e => e.type === "error")).toBe(true);
  });

  it("正文已落盘但审查失败时不应把章节计入完成或继续下一章", async () => {
    const write = makeFlakyWriteModel(0);
    const evs = await collect(runAutoMode(
      {
        model: write as never, auditModel: makeFailingAuditModel() as never, auditModelId: "m",
        chaptersRepo, chapterFiles,
        maxChapterNo: () => chaptersRepo.maxChapterNo(),
        getVerdict: (no: number) => chaptersRepo.getAudit(no)?.verdict,
        budgetLimitUsd: 50, writeModelInfo: info, auditModelInfo: info,
      },
      { n: 2 },
    ));

    const final = evs.filter(e => e.type === "auto_status").at(-1);
    expect(final.state).toBe("error");
    expect(final.doneChapters).toEqual([]);
    expect(chaptersRepo.maxChapterNo()).toBe(1);
    expect(chaptersRepo.getAudit(1)).toBeUndefined();
    expect(chapterFiles.read(2)).toBeUndefined();
    expect(evs.some(e => e.type === "error" && e.errorClass === "audit_failed")).toBe(true);
  });

  it("章节记录失败时不应静默继续下一章", async () => {
    const write = makeFlakyWriteModel(0);
    const evs = await collect(runAutoMode(
      {
        model: write as never, auditModel: makeAuditModel() as never, auditModelId: "m",
        chaptersRepo, chapterFiles,
        maxChapterNo: () => chaptersRepo.maxChapterNo(),
        getVerdict: (no: number) => chaptersRepo.getAudit(no)?.verdict,
        budgetLimitUsd: 50, writeModelInfo: info, auditModelInfo: info,
        recordState: async function* () {
          yield { type: "error", errorClass: "record_failed", message: "record boom" };
        },
      },
      { n: 2 },
    ));

    const final = evs.filter(e => e.type === "auto_status").at(-1);
    expect(final.state).toBe("error");
    expect(final.doneChapters).toEqual([]);
    expect(chaptersRepo.maxChapterNo()).toBe(1);
    expect(chapterFiles.read(2)).toBeUndefined();
    expect(
      evs.some(e =>
        e.type === "tool_call_end" &&
        e.toolName === "record_chapter_state" &&
        (e.result as any).success === false,
      ),
    ).toBe(true);
  });
});
