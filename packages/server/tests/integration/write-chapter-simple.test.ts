import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations/runner.js";
import { createChaptersRepo } from "../../src/db/repositories/chapters.js";
import { createChapterFiles } from "../../src/fs/chapter-files.js";
import { writeChapterSimple } from "../../src/ai/orchestrator/write-chapter.js";
import { makeStubLanguageModel } from "../fixtures/mock-llm.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let tmp: string;
let db: any;
let chaptersRepo: any;
let chapterFiles: any;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scribe-write-"));
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

describe("writeChapterSimple", () => {
  it("成功路径:文本流出后落地 .md + chapter_versions 1 行", async () => {
    const evs = await consume(
      writeChapterSimple(
        {
          model: makeStubLanguageModel({ chunks: ["黎明时,", "雾气浸透山道。"] }),
          chaptersRepo,
          chapterFiles,
        },
        { chapterNo: 1, userIntent: "测试" },
      ),
    );
    expect(evs.find((e) => e.type === "done")).toBeTruthy();
    const file = path.join(tmp, "chapters", "0001.md");
    expect(fs.existsSync(file)).toBe(true);
    const md = fs.readFileSync(file, "utf-8");
    expect(md).toContain("黎明时,雾气浸透山道。");
    expect(md).toContain("version: 1");
    const versions = chaptersRepo.listVersions(1);
    expect(versions).toHaveLength(1);
    expect(versions[0].source).toBe("ai_write");
    expect(versions[0].contentMd).toContain("雾气浸透山道");
  });

  it("二次写入,版本号严格递增", async () => {
    await consume(
      writeChapterSimple(
        {
          model: makeStubLanguageModel({ chunks: ["第一稿"] }),
          chaptersRepo,
          chapterFiles,
        },
        { chapterNo: 1, userIntent: "测试" },
      ),
    );
    await consume(
      writeChapterSimple(
        {
          model: makeStubLanguageModel({ chunks: ["第二稿"] }),
          chaptersRepo,
          chapterFiles,
        },
        { chapterNo: 1, userIntent: "测试" },
      ),
    );
    const versions = chaptersRepo.listVersions(1);
    expect(
      versions.map((v: any) => v.versionNo).sort((a: number, b: number) => a - b),
    ).toEqual([1, 2]);
    const md = fs.readFileSync(path.join(tmp, "chapters", "0001.md"), "utf-8");
    expect(md).toContain("第二稿");
    expect(md).toContain("version: 2");
    expect(chapterFiles.list()).toHaveLength(1);
  });

  it("错误路径:LLM 抛错时不落盘(原子性)", async () => {
    const evs = await consume(
      writeChapterSimple(
        {
          model: makeStubLanguageModel({ chunks: ["前半"], throwOn: "stream" }),
          chaptersRepo,
          chapterFiles,
        },
        { chapterNo: 1, userIntent: "测试" },
      ),
    );
    expect(evs.some((e) => e.type === "error")).toBe(true);
    expect(fs.existsSync(path.join(tmp, "chapters", "0001.md"))).toBe(false);
    expect(chaptersRepo.listVersions(1)).toHaveLength(0);
  });

  it("落盘失败:yield error 替代 done,不破坏 SSE 终结契约", async () => {
    // saveVersion 抛错,模拟 DB 故障
    const brokenRepo = {
      saveVersion() {
        throw new Error("disk full");
      },
    };
    const evs = await consume(
      writeChapterSimple(
        {
          model: makeStubLanguageModel({ chunks: ["正文"] }),
          chaptersRepo: brokenRepo,
          chapterFiles,
        },
        { chapterNo: 1, userIntent: "测试" },
      ),
    );
    // 不能既出现 done 又出现 error;落盘失败应只出现 error
    const hasDone = evs.some((e) => e.type === "done");
    const errEv = evs.find((e) => e.type === "error");
    expect(hasDone).toBe(false);
    expect(errEv).toBeTruthy();
    if (errEv && errEv.type === "error") {
      expect(errEv.errorClass).toBe("save_failed");
      expect(errEv.message).toContain("disk full");
    }
    // 文件没写出来(saveVersion 在 .md 之前抛错)
    expect(fs.existsSync(path.join(tmp, "chapters", "0001.md"))).toBe(false);
  });
});
