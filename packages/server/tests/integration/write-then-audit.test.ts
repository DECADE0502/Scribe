import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations/runner.js";
import { createChaptersRepo } from "../../src/db/repositories/chapters.js";
import { createChapterFiles } from "../../src/fs/chapter-files.js";
import { writeWithAudit } from "../../src/ai/orchestrator/write-with-audit.js";
import { makeStubLanguageModel } from "../fixtures/mock-llm.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const okAudit = {
  verdict: "ok",
  issues: Array.from({ length: 7 }, (_, i) => ({
    dimension: [
      "setting_consistency",
      "character_behavior",
      "pacing",
      "narrative_coherence",
      "foreshadowing",
      "hook_strength",
      "aesthetic_quality",
    ][i],
    severity: "ok",
    score: 8,
    note: "ok",
  })),
  summary: {
    oneLiner: "测试章节",
    paragraph: "测试段落".repeat(20),
    keyEvents: [
      { event: "事件A", characters: ["主角"], foreshadowingRefs: [] },
    ],
  },
};

const criticalAudit = {
  ...okAudit,
  verdict: "critical",
  issues: [
    {
      dimension: "character_behavior",
      severity: "critical",
      score: 3,
      note: "OOC",
      excerpt: "突然爆发",
    },
    ...okAudit.issues.slice(1),
  ],
};

function makeAuditModel(text: string): any {
  return {
    specificationVersion: "v1",
    provider: "stub",
    modelId: "stub-audit",
    async doGenerate() {
      return {
        text,
        finishReason: "stop",
        usage: { promptTokens: 100, completionTokens: 200 },
        rawCall: { rawPrompt: null, rawSettings: {} },
      };
    },
    async doStream() {
      throw new Error("not used");
    },
  };
}

function makeSequencedAuditModel(texts: string[]): any {
  let i = 0;
  return {
    specificationVersion: "v1",
    provider: "stub",
    modelId: "stub-audit",
    async doGenerate() {
      const t = texts[Math.min(i, texts.length - 1)];
      i++;
      return {
        text: t,
        finishReason: "stop",
        usage: { promptTokens: 100, completionTokens: 200 },
        rawCall: { rawPrompt: null, rawSettings: {} },
      };
    },
    async doStream() {
      throw new Error("not used");
    },
  };
}

let tmp: string;
let db: any;
let chaptersRepo: any;
let chapterFiles: any;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scribe-wta-"));
  db = new Database(":memory:");
  const initSql = fs.readFileSync(
    path.join(__dirname, "../../src/db/migrations/workspace/001_init.sql"),
    "utf-8",
  );
  runMigrations(db, [{ name: "001_init.sql", sql: initSql }]);
  chaptersRepo = createChaptersRepo(db);
  chapterFiles = createChapterFiles(path.join(tmp, "chapters"));
});

afterEach(() => {
  try {
    db.close();
  } catch {
    /* ignore */
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function consume<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of iter) out.push(v);
  return out;
}

describe("writeWithAudit", () => {
  it("verdict=ok:写一章 → 审 → 落盘 1 version + audit + summary", async () => {
    const start = performance.now();
    const evs = await consume(
      writeWithAudit(
        {
          model: makeStubLanguageModel({ chunks: ["黎明", "时,雾气"] }),
          chaptersRepo,
          chapterFiles,
          auditModel: makeAuditModel(JSON.stringify(okAudit)),
          auditModelId: "deepseek-v4-flash",
        },
        { chapterNo: 1, userIntent: "测试" },
      ),
    );
    const elapsed = performance.now() - start;
    // 软性能断言:全流程应在 2s 内完成(纯桩 LLM,无网络)
    expect(elapsed).toBeLessThan(2000);

    expect(evs.find((e: any) => e.type === "done")).toBeDefined();
    const audit = evs.find(
      (e: any) => e.type === "tool_call_end" && e.toolName === "chapter_audit",
    );
    expect(audit).toBeDefined();
    expect((audit as any).result.verdict).toBe("ok");

    expect(fs.existsSync(path.join(tmp, "chapters", "0001.md"))).toBe(true);
    expect(chaptersRepo.listVersions(1)).toHaveLength(1);
    const dbAudit = chaptersRepo.getAudit(1);
    expect(dbAudit?.verdict).toBe("ok");
    const dbSummary = chaptersRepo.getSummary(1);
    expect(dbSummary?.oneLiner).toBe("测试章节");
  });

  it("verdict=critical 触发 repair,再审通过 → 2 version,最终 audit=ok", async () => {
    const evs = await consume(
      writeWithAudit(
        {
          model: makeStubLanguageModel({ chunks: ["原文"] }),
          chaptersRepo,
          chapterFiles,
          auditModel: makeSequencedAuditModel([
            JSON.stringify(criticalAudit),
            JSON.stringify(okAudit),
          ]),
          auditModelId: "deepseek-v4-flash",
        },
        { chapterNo: 1, userIntent: "测试" },
      ),
    );
    expect(evs.find((e: any) => e.type === "done")).toBeDefined();
    expect(
      evs.find(
        (e: any) =>
          e.type === "tool_call_start" && e.toolName === "chapter_repair",
      ),
    ).toBeDefined();
    const reAudit = evs.find(
      (e: any) =>
        e.type === "tool_call_end" && e.toolName === "chapter_repair_audit",
    );
    expect((reAudit as any).result.verdict).toBe("ok");

    const versions = chaptersRepo.listVersions(1);
    expect(versions).toHaveLength(2);
    expect(versions.map((v: any) => v.source).sort()).toEqual([
      "ai_rewrite",
      "ai_write",
    ]);
    expect(chaptersRepo.getAudit(1)?.verdict).toBe("ok");
  });

  it("verdict=critical,enableRepair=false:保留 critical,只 1 version", async () => {
    const evs = await consume(
      writeWithAudit(
        {
          model: makeStubLanguageModel({ chunks: ["原文"] }),
          chaptersRepo,
          chapterFiles,
          auditModel: makeAuditModel(JSON.stringify(criticalAudit)),
          auditModelId: "deepseek-v4-flash",
        },
        { chapterNo: 1, userIntent: "测试", enableRepair: false },
      ),
    );
    expect(evs.find((e: any) => e.type === "done")).toBeDefined();
    expect(
      evs.find(
        (e: any) =>
          e.type === "tool_call_start" && e.toolName === "chapter_repair",
      ),
    ).toBeUndefined();
    expect(chaptersRepo.listVersions(1)).toHaveLength(1);
    expect(chaptersRepo.getAudit(1)?.verdict).toBe("critical");
  });

  it("写章节失败时不进 audit,不落盘", async () => {
    const evs = await consume(
      writeWithAudit(
        {
          model: makeStubLanguageModel({
            chunks: ["x"],
            throwOn: "stream",
          }),
          chaptersRepo,
          chapterFiles,
          auditModel: makeAuditModel(JSON.stringify(okAudit)),
          auditModelId: "deepseek-v4-flash",
        },
        { chapterNo: 1, userIntent: "测试" },
      ),
    );
    expect(evs.some((e: any) => e.type === "error")).toBe(true);
    expect(
      evs.find(
        (e: any) =>
          e.type === "tool_call_end" && e.toolName === "chapter_audit",
      ),
    ).toBeUndefined();
    expect(chaptersRepo.listVersions(1)).toHaveLength(0);
    expect(chaptersRepo.getAudit(1)).toBeUndefined();
  });

  it("audit 模型抛错时,write 已落盘但 audit 失败 → SSE 含 error", async () => {
    const evs = await consume(
      writeWithAudit(
        {
          model: makeStubLanguageModel({ chunks: ["写好的正文"] }),
          chaptersRepo,
          chapterFiles,
          auditModel: makeAuditModel("非 JSON,parse 必失败"),
          auditModelId: "deepseek-v4-flash",
        },
        { chapterNo: 1, userIntent: "测试" },
      ),
    );
    expect(
      evs.some(
        (e: any) =>
          e.type === "error" && (e as any).message?.includes("审查失败"),
      ),
    ).toBe(true);
    // 写章节本身已成功落盘
    expect(chaptersRepo.listVersions(1)).toHaveLength(1);
    // audit 失败时不应有 audit 行
    expect(chaptersRepo.getAudit(1)).toBeUndefined();
  });
});
