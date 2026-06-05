import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations/runner.js";
import { createChaptersRepo } from "../../src/db/repositories/chapters.js";
import { createChapterFiles } from "../../src/fs/chapter-files.js";
import { createApp } from "../../src/http/server.js";
import { makeStubLanguageModel } from "../fixtures/mock-llm.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("章节写入 round-trip(HTTP 端到端)", () => {
  let tmp: string;
  let db: any;
  let chaptersRepo: any;
  let chapterFiles: any;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scribe-rt-"));
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

  it("HTTP POST /chapters/1/write → SSE → 章节落地,数据一致", async () => {
    const app = createApp({
      getChapterDeps: (_bookId) => ({
        model: makeStubLanguageModel({ chunks: ["雾气", "弥漫", "山道。"] }),
        chaptersRepo,
        chapterFiles,
      }),
    });
    const res = await app.request("/api/books/b1/chapters/1/write", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userIntent: "写第 1 章" }),
    });
    expect(res.status).toBe(200);
    const text = await new Response(res.body).text();
    const deltas = [...text.matchAll(/data: (\{"type":"text_delta"[^}]+\})/g)]
      .map((m) => JSON.parse(m[1]!).delta)
      .join("");
    expect(deltas).toBe("雾气弥漫山道。");
    const md = fs.readFileSync(path.join(tmp, "chapters", "0001.md"), "utf-8");
    expect(md).toContain("雾气弥漫山道。");
    const versions = chaptersRepo.listVersions(1);
    expect(versions).toHaveLength(1);
    expect(versions[0].contentMd).toBe("雾气弥漫山道。");
  });

  it("没注入 chapter deps 时返回 503 + 中文提示", async () => {
    const app = createApp();
    const res = await app.request("/api/books/b1/chapters/1/write", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userIntent: "x" }),
    });
    expect(res.status).toBe(503);
    const j = (await res.json()) as { error: string };
    expect(j.error).toContain("未配置模型");
  });

  it("章节号非法返回 400", async () => {
    const app = createApp({
      getChapterDeps: () => ({
        model: makeStubLanguageModel(),
        chaptersRepo,
        chapterFiles,
      }),
    });
    const res = await app.request("/api/books/b1/chapters/abc/write", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userIntent: "x" }),
    });
    expect(res.status).toBe(400);
  });
});
