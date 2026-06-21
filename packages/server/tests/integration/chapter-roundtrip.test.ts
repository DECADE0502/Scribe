import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createBookRegistry } from "../../src/http/book-registry.js";
import { createApp } from "../../src/http/server.js";
import { makeStubLanguageModel } from "../fixtures/mock-llm.js";
import type { AppPaths } from "../../src/config/paths.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const okAudit = JSON.stringify({
  verdict: "ok",
  issues: [
    "setting_consistency",
    "character_behavior",
    "pacing",
    "narrative_coherence",
    "foreshadowing",
    "hook_strength",
    "aesthetic_quality",
  ].map((dimension) => ({ dimension, severity: "ok", score: 8, note: "无明显问题" })),
  summary: {
    oneLiner: "雾气弥漫山道",
    paragraph: "本章写出山道雾气与角色前行的基础场景,文本可以作为第一章正文落地。审查模型在测试中返回稳定结构,确保完整写作链路能继续进入硬事实检查与状态记录。",
    keyEvents: [{ event: "雾气弥漫山道", characters: [], foreshadowingRefs: [] }],
  },
  hardFacts: [],
});

const criticalAudit = JSON.stringify({
  verdict: "critical",
  issues: [
    {
      dimension: "narrative_coherence",
      severity: "critical",
      score: 3,
      note: "需要修复",
    },
    ...[
      "setting_consistency",
      "character_behavior",
      "pacing",
      "foreshadowing",
      "hook_strength",
      "aesthetic_quality",
    ].map((dimension) => ({ dimension, severity: "ok", score: 8, note: "无明显问题" })),
  ],
  summary: {
    oneLiner: "需要修复的章节",
    paragraph: "本章在测试中被审查为严重问题,用于验证 finalize 阶段触发修复后不会把修复正文通过 SSE 泄露到左侧对话流,并且修复落盘内容能被后续再审查读取。",
    keyEvents: [{ event: "章节需要修复", characters: [], foreshadowingRefs: [] }],
  },
  hardFacts: [],
});

function makeAuditAndRecordModel(): any {
  return {
    specificationVersion: "v1",
    provider: "stub",
    modelId: "stub-audit",
    async doGenerate() {
      return {
        text: okAudit,
        finishReason: "stop",
        usage: { promptTokens: 10, completionTokens: 10 },
        rawCall: { rawPrompt: null, rawSettings: {} },
      };
    },
    async doStream() {
      return {
        stream: new ReadableStream({
          start(ctrl) {
            ctrl.enqueue({
              type: "finish",
              finishReason: "stop",
              usage: { promptTokens: 1, completionTokens: 0 },
            });
            ctrl.close();
          },
        }),
        rawCall: { rawPrompt: null, rawSettings: {} },
      };
    },
  };
}

function makeSequencedAuditAndRecordModel(texts: string[]): any {
  let callCount = 0;
  return {
    specificationVersion: "v1",
    provider: "stub",
    modelId: "stub-audit",
    async doGenerate() {
      const text = texts[Math.min(callCount, texts.length - 1)] ?? texts.at(-1) ?? okAudit;
      callCount += 1;
      return {
        text,
        finishReason: "stop",
        usage: { promptTokens: 10, completionTokens: 10 },
        rawCall: { rawPrompt: null, rawSettings: {} },
      };
    },
    async doStream() {
      return {
        stream: new ReadableStream({
          start(ctrl) {
            ctrl.enqueue({
              type: "finish",
              finishReason: "stop",
              usage: { promptTokens: 1, completionTokens: 0 },
            });
            ctrl.close();
          },
        }),
        rawCall: { rawPrompt: null, rawSettings: {} },
      };
    },
  };
}

function makePaths(root: string): AppPaths {
  return {
    appRoot: root,
    libraryDb: path.posix.join(root, "library.db"),
    booksDir: path.posix.join(root, "books"),
    backupsDir: path.posix.join(root, "backups"),
    secretsEnv: path.posix.join(root, "secrets.env"),
    configJson: path.posix.join(root, "config.json"),
    bookDir: (id: string) => path.posix.join(root, "books", id),
    workspaceDb: (id: string) => path.posix.join(root, "books", id, "workspace.db"),
    chaptersDir: (id: string) => path.posix.join(root, "books", id, "chapters"),
    rulesMd: (id: string) => path.posix.join(root, "books", id, "rules.md"),
    exportsDir: (id: string) => path.posix.join(root, "books", id, "exports"),
    bookBackupsDir: (id: string) => path.posix.join(root, "backups", id),
  };
}

describe("章节写入 round-trip(HTTP 端到端)", () => {
  let tmp: string;
  let registry: ReturnType<typeof createBookRegistry>;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scribe-rt-"));
    const paths = makePaths(tmp);
    fs.mkdirSync(paths.booksDir, { recursive: true });
    registry = createBookRegistry({ paths });
  });

  afterEach(() => {
    registry.closeAll();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("HTTP POST /chapters/1/write 默认不通过 SSE 泄露正文,但章节落地", async () => {
    // 先通过 API 创建一本书
    const createApp1 = createApp({ bookRegistry: registry });
    const createRes = await createApp1.request("/api/books", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "测试书", genre: "test" }),
    });
    const book = (await createRes.json()) as { id: string };
    const bookId = book.id;

    const app = createApp({
      bookRegistry: registry,
      getAuditModel: () => makeAuditAndRecordModel(),
      auditModelInfo: { id: "stub-audit" },
      getChapterDeps: (_bookId) => ({
        model: makeStubLanguageModel({ chunks: ["雾气", "弥漫", "山道。"] }),
        chaptersRepo: registry.open(bookId).chaptersRepo,
        chapterFiles: registry.open(bookId).chapterFiles,
      }),
    });
    const res = await app.request(`/api/books/${bookId}/chapters/1/write`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userIntent: "写第 1 章" }),
    });
    expect(res.status).toBe(200);
    const text = await new Response(res.body).text();
    // 按 SSE 行解析,与真实客户端行为一致:写作流程不应把正文发到左侧对话流
    const events = text
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice(6)) as { type: string; delta?: string });
    expect(events.some((ev) => ev.type === "text_delta")).toBe(false);
    expect(events.some((ev) => ev.type === "done")).toBe(true);
    // 验证章节落地
    const handle = registry.open(bookId);
    const versions = handle.chaptersRepo.listVersions(1);
    expect(versions.length).toBeGreaterThanOrEqual(1);
    expect(versions[0]!.contentMd).toBe("雾气弥漫山道。");
  });

  it("HTTP POST /chapters/1/finalize 修复阶段默认不通过 SSE 泄露修复正文", async () => {
    const createApp1 = createApp({ bookRegistry: registry });
    const createRes = await createApp1.request("/api/books", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "测试书", genre: "test" }),
    });
    const book = (await createRes.json()) as { id: string };
    const bookId = book.id;
    const handle = registry.open(bookId);
    const firstVersion = handle.chaptersRepo.saveVersion({
      chapterNo: 1,
      source: "user_edit",
      contentMd: "需要修复的原文",
    });
    handle.chapterFiles.save({
      chapterNo: 1,
      title: "第一章",
      content: "需要修复的原文",
      versionNo: firstVersion.versionNo,
    });

    const app = createApp({
      bookRegistry: registry,
      getAuditModel: () => makeSequencedAuditAndRecordModel([criticalAudit, okAudit]),
      auditModelInfo: { id: "stub-audit" },
      getChapterDeps: (_bookId) => ({
        model: makeStubLanguageModel({ chunks: ["修复后的正文"] }),
        chaptersRepo: handle.chaptersRepo,
        chapterFiles: handle.chapterFiles,
      }),
    });
    const res = await app.request(`/api/books/${bookId}/chapters/1/finalize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userIntent: "确认第一章" }),
    });

    expect(res.status).toBe(200);
    const text = await new Response(res.body).text();
    const events = text
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice(6)) as { type: string; delta?: string; toolName?: string });
    expect(events.some((ev) => ev.type === "text_delta")).toBe(false);
    expect(events).toContainEqual(expect.objectContaining({ type: "tool_call_end", toolName: "chapter_repair_audit" }));
    expect(events.some((ev) => ev.type === "done")).toBe(true);
    expect(handle.chapterFiles.read(1)?.content.trim()).toBe("修复后的正文");
    expect(handle.chaptersRepo.listVersions(1)[0]!.source).toBe("ai_rewrite");
  });

  it("没注入 chapter deps 时返回 503 + 中文提示", async () => {
    const app = createApp({ bookRegistry: registry });
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
      bookRegistry: registry,
      getChapterDeps: () => ({
        model: makeStubLanguageModel(),
        chaptersRepo: registry.open("nonexistent").chaptersRepo,
        chapterFiles: registry.open("nonexistent").chapterFiles,
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
