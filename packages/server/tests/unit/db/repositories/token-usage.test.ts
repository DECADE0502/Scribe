import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "../../../../src/db/migrations/runner.js";
import { createTokenUsageRepo } from "../../../../src/db/repositories/token-usage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceInit = fs.readFileSync(
  path.join(__dirname, "../../../../src/db/migrations/workspace/001_init.sql"),
  "utf-8"
);

let db: any, repo: ReturnType<typeof createTokenUsageRepo>;
beforeEach(() => {
  db = new Database(":memory:");
  runMigrations(db, [{ name: "001_init.sql", sql: workspaceInit }]);
  repo = createTokenUsageRepo(db);
});

describe("token-usage repo", () => {
  it("record + totalCost", () => {
    repo.record({
      taskType: "write",
      model: "m1",
      promptTokens: 100,
      completionTokens: 50,
      cachedTokens: 0,
      reasoningTokens: 0,
      costUsd: 0.1,
      chapterNo: 1,
    });
    repo.record({
      taskType: "audit",
      model: "m1",
      promptTokens: 200,
      completionTokens: 100,
      cachedTokens: 0,
      reasoningTokens: 0,
      costUsd: 0.2,
      chapterNo: 1,
    });
    expect(repo.totalCost()).toBeCloseTo(0.3);
  });

  it("sumByChapter 汇总单章节", () => {
    repo.record({
      taskType: "write",
      model: "m1",
      promptTokens: 100,
      completionTokens: 50,
      cachedTokens: 0,
      reasoningTokens: 0,
      costUsd: 0.1,
      chapterNo: 1,
    });
    repo.record({
      taskType: "audit",
      model: "m1",
      promptTokens: 200,
      completionTokens: 100,
      cachedTokens: 0,
      reasoningTokens: 0,
      costUsd: 0.2,
      chapterNo: 1,
    });
    repo.record({
      taskType: "write",
      model: "m1",
      promptTokens: 300,
      completionTokens: 150,
      cachedTokens: 0,
      reasoningTokens: 0,
      costUsd: 0.5,
      chapterNo: 2,
    });
    const c1 = repo.sumByChapter(1);
    expect(c1.promptTokens).toBe(300);
    expect(c1.completionTokens).toBe(150);
    expect(c1.costUsd).toBeCloseTo(0.3);
  });

  it("sumByTaskType 按 taskType 汇总", () => {
    repo.record({
      taskType: "write",
      model: "m1",
      promptTokens: 0,
      completionTokens: 0,
      cachedTokens: 0,
      reasoningTokens: 0,
      costUsd: 0.1,
      chapterNo: null,
    });
    repo.record({
      taskType: "write",
      model: "m1",
      promptTokens: 0,
      completionTokens: 0,
      cachedTokens: 0,
      reasoningTokens: 0,
      costUsd: 0.2,
      chapterNo: null,
    });
    repo.record({
      taskType: "audit",
      model: "m1",
      promptTokens: 0,
      completionTokens: 0,
      cachedTokens: 0,
      reasoningTokens: 0,
      costUsd: 0.05,
      chapterNo: null,
    });
    const sums = repo.sumByTaskType();
    const writeSum = sums.find((s) => s.taskType === "write");
    const auditSum = sums.find((s) => s.taskType === "audit");
    expect(writeSum?.costUsd).toBeCloseTo(0.3);
    expect(auditSum?.costUsd).toBeCloseTo(0.05);
  });

  it("空表查询返回 0", () => {
    expect(repo.totalCost()).toBe(0);
    expect(repo.sumByChapter(1)).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
    });
    expect(repo.sumByTaskType()).toEqual([]);
  });

  it("chapterNo 可为 null", () => {
    repo.record({
      taskType: "chat",
      model: "m1",
      promptTokens: 10,
      completionTokens: 5,
      cachedTokens: 0,
      reasoningTokens: 0,
      costUsd: 0.01,
      chapterNo: null,
    });
    expect(repo.totalCost()).toBeCloseTo(0.01);
    expect(repo.sumByChapter(1)).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
    });
  });
});
