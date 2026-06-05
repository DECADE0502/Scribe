import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { runMigrations } from "../../../../src/db/migrations/runner.js";
import { createChaptersRepo } from "../../../../src/db/repositories/chapters.js";
import { createChapterFiles } from "../../../../src/fs/chapter-files.js";
import { repairChapter } from "../../../../src/ai/orchestrator/repair-chapter.js";
import { makeStubLanguageModel } from "../../../fixtures/mock-llm.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let tmp: string;
let db: any;
let chaptersRepo: any;
let chapterFiles: any;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scribe-repair-"));
  db = new Database(":memory:");
  const initSql = fs.readFileSync(
    path.join(__dirname, "../../../../src/db/migrations/workspace/001_init.sql"),
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

describe("repairChapter", () => {
  const baseCtx = {
    chapterContent: "原章节正文",
    issues: [
      {
        dimension: "aesthetic_quality",
        severity: "warning" as const,
        note: "钩子较弱",
      },
    ],
  };

  it("成功路径:落地 .md + ai_rewrite version", async () => {
    const evs = await consume(
      repairChapter(
        {
          model: makeStubLanguageModel({ chunks: ["修复后", "正文"] }),
          chaptersRepo,
          chapterFiles,
        },
        { chapterNo: 1, ctx: baseCtx },
      ),
    );
    expect(evs.find((e: any) => e.type === "done")).toBeDefined();
    const md = fs.readFileSync(
      path.join(tmp, "chapters", "0001.md"),
      "utf-8",
    );
    expect(md).toContain("修复后正文");
    const versions = chaptersRepo.listVersions(1);
    expect(versions).toHaveLength(1);
    expect(versions[0].source).toBe("ai_rewrite");
  });

  it("LLM 抛错:不落盘", async () => {
    const evs = await consume(
      repairChapter(
        {
          model: makeStubLanguageModel({ chunks: ["x"], throwOn: "stream" }),
          chaptersRepo,
          chapterFiles,
        },
        { chapterNo: 1, ctx: baseCtx },
      ),
    );
    expect(evs.some((e: any) => e.type === "error")).toBe(true);
    expect(fs.existsSync(path.join(tmp, "chapters", "0001.md"))).toBe(false);
    expect(chaptersRepo.listVersions(1)).toHaveLength(0);
  });

  it("fs.save 抛错:回滚 DB", async () => {
    const broken = {
      save() {
        throw new Error("EPERM");
      },
    };
    const evs = await consume(
      repairChapter(
        {
          model: makeStubLanguageModel({ chunks: ["x"] }),
          chaptersRepo,
          chapterFiles: broken as any,
        },
        { chapterNo: 1, ctx: baseCtx },
      ),
    );
    expect(evs.find((e: any) => e.type === "done")).toBeUndefined();
    const errEv = evs.find((e: any) => e.type === "error");
    expect(errEv).toBeDefined();
    expect((errEv as any).errorClass).toBe("save_failed");
    expect(chaptersRepo.listVersions(1)).toHaveLength(0);
  });

  it("空内容:不 yield done 也不落盘", async () => {
    const evs = await consume(
      repairChapter(
        {
          model: makeStubLanguageModel({ chunks: [""] }),
          chaptersRepo,
          chapterFiles,
        },
        { chapterNo: 1, ctx: baseCtx },
      ),
    );
    expect(evs.find((e: any) => e.type === "done")).toBeUndefined();
    expect(chaptersRepo.listVersions(1)).toHaveLength(0);
    expect(fs.existsSync(path.join(tmp, "chapters", "0001.md"))).toBe(false);
  });
});

describe("buildRepairUserPrompt", () => {
  it("拼接 issues + 上下文", async () => {
    const { buildRepairUserPrompt } = await import(
      "../../../../src/ai/prompts/repair-chapter.js"
    );
    const text = buildRepairUserPrompt({
      chapterContent: "正文",
      issues: [
        {
          dimension: "character_behavior",
          severity: "critical",
          excerpt: "他突然爆发",
          note: "OOC",
        },
        { dimension: "pacing", severity: "ok", note: "skip" },
      ],
      premise: "p",
    });
    expect(text).toContain("## 原章节正文");
    expect(text).toContain("## 审查报告");
    expect(text).toContain("[critical] character_behavior");
    expect(text).toContain("原文:他突然爆发");
    expect(text).not.toContain("[ok]");
    expect(text).toContain("## 故事前提");
  });
});
