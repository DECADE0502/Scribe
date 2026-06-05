import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "../../../../src/db/migrations/runner.js";
import { createChaptersRepo } from "../../../../src/db/repositories/chapters.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceInit = fs.readFileSync(
  path.join(__dirname, "../../../../src/db/migrations/workspace/001_init.sql"),
  "utf-8"
);

let db: any, repo: ReturnType<typeof createChaptersRepo>;
beforeEach(() => {
  db = new Database(":memory:");
  runMigrations(db, [{ name: "001_init.sql", sql: workspaceInit }]);
  repo = createChaptersRepo(db);
});

describe("chapters repo - summaries", () => {
  it("saveSummary + getSummary", () => {
    repo.saveSummary({
      chapterNo: 1,
      oneLiner: "开端",
      paragraph: "故事开始了",
      keyEvents: [{ event: "登场", characters: ["c1"], foreshadowingRefs: [] }],
      generatedAt: 1000,
      reasoningContent: null,
    });
    const got = repo.getSummary(1);
    expect(got?.oneLiner).toBe("开端");
    expect(got?.keyEvents).toHaveLength(1);
  });

  it("saveSummary upsert 覆盖", () => {
    repo.saveSummary({
      chapterNo: 1,
      oneLiner: "v1",
      paragraph: "p1",
      keyEvents: [],
      generatedAt: 1,
      reasoningContent: null,
    });
    repo.saveSummary({
      chapterNo: 1,
      oneLiner: "v2",
      paragraph: "p2",
      keyEvents: [],
      generatedAt: 2,
      reasoningContent: "thinking",
    });
    expect(repo.getSummary(1)?.oneLiner).toBe("v2");
    expect(repo.getSummary(1)?.reasoningContent).toBe("thinking");
  });

  it("listSummaries 按 chapterNo 升序", () => {
    repo.saveSummary({
      chapterNo: 3,
      oneLiner: "C",
      paragraph: "",
      keyEvents: [],
      generatedAt: 0,
      reasoningContent: null,
    });
    repo.saveSummary({
      chapterNo: 1,
      oneLiner: "A",
      paragraph: "",
      keyEvents: [],
      generatedAt: 0,
      reasoningContent: null,
    });
    repo.saveSummary({
      chapterNo: 2,
      oneLiner: "B",
      paragraph: "",
      keyEvents: [],
      generatedAt: 0,
      reasoningContent: null,
    });
    expect(repo.listSummaries().map((s) => s.oneLiner)).toEqual(["A", "B", "C"]);
  });

  it("getSummary 不存在返回 undefined", () => {
    expect(repo.getSummary(999)).toBeUndefined();
  });
});

describe("chapters repo - versions", () => {
  it("saveVersion 自动分配 versionNo", () => {
    const v1 = repo.saveVersion({ chapterNo: 1, source: "ai_write", contentMd: "hello" });
    const v2 = repo.saveVersion({ chapterNo: 1, source: "user_edit", contentMd: "hi" });
    expect(v1.versionNo).toBe(1);
    expect(v2.versionNo).toBe(2);
  });

  it("不同章节 versionNo 独立计数", () => {
    repo.saveVersion({ chapterNo: 1, source: "ai_write", contentMd: "a" });
    repo.saveVersion({ chapterNo: 1, source: "ai_write", contentMd: "b" });
    const c2v1 = repo.saveVersion({ chapterNo: 2, source: "ai_write", contentMd: "x" });
    expect(c2v1.versionNo).toBe(1);
  });

  it("listVersions 按 versionNo desc", () => {
    repo.saveVersion({ chapterNo: 1, source: "ai_write", contentMd: "a" });
    repo.saveVersion({ chapterNo: 1, source: "ai_rewrite", contentMd: "b" });
    repo.saveVersion({ chapterNo: 1, source: "user_edit", contentMd: "c" });
    const list = repo.listVersions(1);
    expect(list.map((v) => v.versionNo)).toEqual([3, 2, 1]);
    expect(list[0]?.contentMd).toBe("c");
  });

  it("getLatestVersion 返回最新", () => {
    repo.saveVersion({ chapterNo: 1, source: "ai_write", contentMd: "a" });
    repo.saveVersion({ chapterNo: 1, source: "user_edit", contentMd: "b" });
    expect(repo.getLatestVersion(1)?.contentMd).toBe("b");
    expect(repo.getLatestVersion(999)).toBeUndefined();
  });
});

describe("chapters repo - audits", () => {
  it("saveAudit + getAudit", () => {
    repo.saveAudit({
      chapterNo: 1,
      verdict: "warning",
      issues: [{ dimension: "logic", severity: "warning", note: "矛盾" }],
      auditModel: "gpt-x",
      auditedAt: 1000,
    });
    const a = repo.getAudit(1);
    expect(a?.verdict).toBe("warning");
    expect(a?.issues).toHaveLength(1);
  });

  it("saveAudit upsert 覆盖", () => {
    repo.saveAudit({
      chapterNo: 1,
      verdict: "warning",
      issues: [],
      auditModel: "m1",
      auditedAt: 1,
    });
    repo.saveAudit({
      chapterNo: 1,
      verdict: "ok",
      issues: [],
      auditModel: "m2",
      auditedAt: 2,
    });
    expect(repo.getAudit(1)?.verdict).toBe("ok");
    expect(repo.getAudit(1)?.auditModel).toBe("m2");
  });

  it("getAudit 不存在返回 undefined", () => {
    expect(repo.getAudit(999)).toBeUndefined();
  });
});
