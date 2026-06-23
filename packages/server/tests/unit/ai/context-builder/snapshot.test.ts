import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { runMigrations } from "../../../../src/db/migrations/runner.js";
import { createCharactersRepo } from "../../../../src/db/repositories/characters.js";
import { createOutlineRepo } from "../../../../src/db/repositories/outline.js";
import { createForeshadowingRepo } from "../../../../src/db/repositories/foreshadowing.js";
import { createChaptersRepo } from "../../../../src/db/repositories/chapters.js";
import { createGenreSectionsRepo } from "../../../../src/db/repositories/genre-sections.js";
import { createBookMetaRepo } from "../../../../src/db/repositories/book-meta.js";
import {
  loadBookSnapshot,
  createSnapshotCache,
} from "../../../../src/ai/context-builder/snapshot.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let tmp: string, db: any, repos: any, paths: any;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scribe-snap-"));
  db = new Database(":memory:");
  const initSql = fs.readFileSync(
    path.join(
      __dirname,
      "../../../../src/db/migrations/workspace/001_init.sql"
    ),
    "utf-8"
  );
  runMigrations(db, [{ name: "001_init.sql", sql: initSql }]);
  repos = {
    charactersRepo: createCharactersRepo(db),
    outlineRepo: createOutlineRepo(db),
    foreshadowingRepo: createForeshadowingRepo(db),
    chaptersRepo: createChaptersRepo(db),
    genreSectionsRepo: createGenreSectionsRepo(db),
    bookMetaRepo: createBookMetaRepo(db),
  };
  paths = { rulesMd: path.join(tmp, "rules.md") };
  // fixture
  repos.bookMetaRepo.set("title", "测试书");
  repos.bookMetaRepo.set("premise", "故事前提");
  repos.bookMetaRepo.set("genre", "仙侠");
  fs.writeFileSync(paths.rulesMd, "# 规则\n\n忌讳:破折号", "utf-8");
});

afterEach(() => {
  try {
    db.close();
  } catch {}
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("loadBookSnapshot", () => {
  it("空 DB 但有 meta + rules.md", () => {
    const snap = loadBookSnapshot("b1", repos, paths);
    expect(snap.bookId).toBe("b1");
    expect(snap.meta.title).toBe("测试书");
    expect(snap.meta.premise).toBe("故事前提");
    expect(snap.meta.genre).toBe("仙侠");
    expect(snap.rulesMd).toContain("忌讳:破折号");
    expect(snap.characters).toHaveLength(0);
    expect(snap.allSummaries).toHaveLength(0);
    expect(snap.recentSummaries).toHaveLength(0);
  });

  it("rules.md 不存在时返回空字符串", () => {
    fs.unlinkSync(paths.rulesMd);
    const snap = loadBookSnapshot("b1", repos, paths);
    expect(snap.rulesMd).toBe("");
  });

  it("recentSummaries 取最近 3 章按 desc 排", () => {
    for (let i = 1; i <= 5; i++) {
      repos.chaptersRepo.saveSummary({
        chapterNo: i,
        oneLiner: `第${i}章`,
        paragraph: "x".repeat(100),
        keyEvents: [],
        generatedAt: i * 1000,
        reasoningContent: null,
      });
    }
    const snap = loadBookSnapshot("b1", repos, paths);
    expect(snap.allSummaries).toHaveLength(5);
    expect(snap.recentSummaries.map((s: any) => s.chapterNo)).toEqual([5, 4, 3]);
  });

  it("活跃 vs 已回收伏笔分两组", () => {
    repos.foreshadowingRepo.create({
      label: "黑剑",
      description: "出处不明",
      plantedChapter: 1,
      paidChapter: null,
      status: "active",
      relatedCharacters: [],
    });
    repos.foreshadowingRepo.create({
      label: "旧账",
      description: null,
      plantedChapter: 2,
      paidChapter: 5,
      status: "paid",
      relatedCharacters: [],
    });
    const snap = loadBookSnapshot("b1", repos, paths);
    expect(snap.activeForeshadowing).toHaveLength(1);
    expect(snap.paidForeshadowing).toHaveLength(1);
    expect(snap.activeForeshadowing[0]!.label).toBe("黑剑");
  });

  it("genreSections 含 items 列表", () => {
    const sec = repos.genreSectionsRepo.createSection({
      name: "功法体系",
      schema: [{ name: "name", type: "string", required: true }],
      createdBy: "ai",
    });
    repos.genreSectionsRepo.addItem(sec.id, { name: "九转金身" });
    repos.genreSectionsRepo.addItem(sec.id, { name: "玄阴诀" });
    const snap = loadBookSnapshot("b1", repos, paths);
    expect(snap.genreSections).toHaveLength(1);
    expect(snap.genreSections[0]!.section.name).toBe("功法体系");
    expect(snap.genreSections[0]!.items).toHaveLength(2);
  });

  it("载入 outline 章→弧→卷 路径与弧/卷总结", () => {
    // 准备: 卷 1 > 弧 A(章 1,2) > 弧 B(章 3); 弧 A.summary="弧 A 总结"; 卷 1.summary=null
    const vol1 = repos.outlineRepo.create({
      parentId: null,
      level: "volume",
      title: "卷一",
      summary: null,
      status: "planned",
      sortOrder: 0,
      metadata: {},
    });
    const arcA = repos.outlineRepo.create({
      parentId: vol1.id,
      level: "arc",
      title: "弧 A",
      summary: "弧 A 总结",
      status: "planned",
      sortOrder: 0,
      metadata: {},
    });
    const arcB = repos.outlineRepo.create({
      parentId: vol1.id,
      level: "arc",
      title: "弧 B",
      summary: null,
      status: "planned",
      sortOrder: 1,
      metadata: {},
    });
    repos.outlineRepo.create({
      parentId: arcA.id,
      level: "chapter",
      title: "第一章",
      summary: null,
      status: "planned",
      sortOrder: 0,
      metadata: { chapterNo: 1 },
    });
    repos.outlineRepo.create({
      parentId: arcA.id,
      level: "chapter",
      title: "第二章",
      summary: null,
      status: "planned",
      sortOrder: 1,
      metadata: { chapterNo: 2 },
    });
    repos.outlineRepo.create({
      parentId: arcB.id,
      level: "chapter",
      title: "第三章",
      summary: null,
      status: "planned",
      sortOrder: 0,
      metadata: { chapterNo: 3 },
    });
    // 章节小总结
    repos.chaptersRepo.saveSummary({
      chapterNo: 1,
      oneLiner: "第1章",
      paragraph: "x".repeat(100),
      keyEvents: [],
      generatedAt: 1000,
      reasoningContent: null,
    });
    repos.chaptersRepo.saveSummary({
      chapterNo: 2,
      oneLiner: "第2章",
      paragraph: "x".repeat(100),
      keyEvents: [],
      generatedAt: 2000,
      reasoningContent: null,
    });
    repos.chaptersRepo.saveSummary({
      chapterNo: 3,
      oneLiner: "第3章",
      paragraph: "x".repeat(100),
      keyEvents: [],
      generatedAt: 3000,
      reasoningContent: null,
    });

    const snap = loadBookSnapshot("b1", repos, paths);
    expect(snap.chapterOutlinePaths.find((p: any) => p.chapterNo === 1)).toMatchObject({
      arcSummary: "弧 A 总结",
      volumeSummary: null,
    });
    expect(snap.chapterOutlinePaths.find((p: any) => p.chapterNo === 3)?.arcSummary).toBeNull();
    expect(snap.arcVolumeSummaries.some((s: any) => s.text === "弧 A 总结")).toBe(true);
  });
});

describe("createSnapshotCache", () => {
  it("同一 bookId 同周期内只 build 一次", async () => {
    const cache = createSnapshotCache();
    let buildCount = 0;
    const build = () => {
      buildCount++;
      return loadBookSnapshot("b1", repos, paths);
    };
    const r1 = await cache.withSnapshot("b1", build, (snap) => snap.meta.title);
    const r2 = await cache.withSnapshot("b1", build, (snap) => snap.meta.title);
    expect(r1).toBe("测试书");
    expect(r2).toBe("测试书");
    expect(buildCount).toBe(1);
  });

  it("invalidate 后会重新 build", async () => {
    const cache = createSnapshotCache();
    let buildCount = 0;
    const build = () => {
      buildCount++;
      return loadBookSnapshot("b1", repos, paths);
    };
    await cache.withSnapshot("b1", build, (_) => null);
    cache.invalidate("b1");
    await cache.withSnapshot("b1", build, (_) => null);
    expect(buildCount).toBe(2);
  });

  it("不同 bookId 各自缓存", async () => {
    const cache = createSnapshotCache();
    let buildCount = 0;
    const build = () => {
      buildCount++;
      return loadBookSnapshot("any", repos, paths);
    };
    await cache.withSnapshot("a", build, (_) => null);
    await cache.withSnapshot("b", build, (_) => null);
    await cache.withSnapshot("a", build, (_) => null);
    expect(buildCount).toBe(2);
  });
});
