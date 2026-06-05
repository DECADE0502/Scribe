import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations/runner.js";
import { createChaptersRepo } from "../../src/db/repositories/chapters.js";
import { auditChapter } from "../../src/ai/orchestrator/audit-chapter.js";
import { persistAuditResult } from "../../src/ai/orchestrator/audit-persist.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const okOutput = {
  verdict: "warning",
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
    severity: i === 5 ? "warning" : "ok",
    score: i === 5 ? 6 : 8,
    excerpt: i === 5 ? "章末过于平淡" : undefined,
    note: i === 5 ? "钩子较弱" : "ok",
  })),
  summary: {
    oneLiner: "林尘进城遭遇师妹",
    paragraph: "本章林尘携密信进入云上城,与师妹擦肩。".repeat(8),
    keyEvents: [
      { event: "进城", characters: ["林尘"], foreshadowingRefs: [] },
      {
        event: "误会",
        characters: ["林尘", "师妹"],
        foreshadowingRefs: ["旧账"],
      },
    ],
  },
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

let db: any, repo: ReturnType<typeof createChaptersRepo>;

beforeEach(() => {
  db = new Database(":memory:");
  const initSql = fs.readFileSync(
    path.join(__dirname, "../../src/db/migrations/workspace/001_init.sql"),
    "utf-8",
  );
  runMigrations(db, [{ name: "001_init.sql", sql: initSql }]);
  repo = createChaptersRepo(db);
});

afterEach(() => {
  try {
    db.close();
  } catch {
    /* ignore */
  }
});

describe("audit 落盘集成", () => {
  it("auditChapter + persistAuditResult → chapter_audits 和 chapter_summaries 各 1 行", async () => {
    const result = await auditChapter(
      { model: makeAuditModel(JSON.stringify(okOutput)) },
      { chapterNo: 1, chapterContent: "正文" },
    );
    persistAuditResult(repo, 1, result, "deepseek-v4-flash");

    const audit = repo.getAudit(1);
    expect(audit).toBeDefined();
    expect(audit!.verdict).toBe("warning");
    expect(audit!.issues).toHaveLength(7);
    expect(audit!.auditModel).toBe("deepseek-v4-flash");

    const summary = repo.getSummary(1);
    expect(summary).toBeDefined();
    expect(summary!.oneLiner).toBe("林尘进城遭遇师妹");
    expect(summary!.keyEvents).toHaveLength(2);
  });

  it("二次 audit 同章节 → INSERT OR REPLACE,行数仍为 1", async () => {
    const r1 = await auditChapter(
      { model: makeAuditModel(JSON.stringify(okOutput)) },
      { chapterNo: 1, chapterContent: "正文" },
    );
    persistAuditResult(repo, 1, r1, "deepseek-v4-flash");

    const ok2 = {
      ...okOutput,
      verdict: "ok",
      issues: okOutput.issues.map((i) => ({
        ...i,
        severity: "ok",
        note: "ok",
      })),
    };
    const r2 = await auditChapter(
      { model: makeAuditModel(JSON.stringify(ok2)) },
      { chapterNo: 1, chapterContent: "正文" },
    );
    persistAuditResult(repo, 1, r2, "deepseek-v4-pro");

    const finalAudit = repo.getAudit(1);
    expect(finalAudit!.verdict).toBe("ok");
    expect(finalAudit!.auditModel).toBe("deepseek-v4-pro");
    // 验证表里只有 1 行
    const rows = db
      .prepare("SELECT COUNT(*) AS c FROM chapter_audits WHERE chapter_no=1")
      .get() as any;
    expect(rows.c).toBe(1);
    const sumRows = db
      .prepare("SELECT COUNT(*) AS c FROM chapter_summaries WHERE chapter_no=1")
      .get() as any;
    expect(sumRows.c).toBe(1);
  });
});
