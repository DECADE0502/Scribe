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

  it("legacy chapter write route is removed", async () => {
    const app = createApp({ bookRegistry: registry });
    const res = await app.request("/api/books/b1/chapters/1/write", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userIntent: "x" }),
    });

    expect(res.status).toBe(410);
    expect(await res.json()).toMatchObject({ error: "legacy_write_route_removed" });
  });

  it("legacy chapter draft/finalize routes are removed", async () => {
    const app = createApp({ bookRegistry: registry });
    const draft = await app.request("/api/books/b1/chapters/1/write-draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userIntent: "x" }),
    });
    const finalize = await app.request("/api/books/b1/chapters/1/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userIntent: "x" }),
    });

    expect(draft.status).toBe(410);
    expect(finalize.status).toBe(410);
    expect(await draft.json()).toMatchObject({ error: "legacy_write_draft_route_removed" });
    expect(await finalize.json()).toMatchObject({ error: "legacy_finalize_route_removed" });
  });

  it("invalid legacy chapter write route chapter number returns 410 before legacy execution", async () => {
    const app = createApp({ bookRegistry: registry });
    const res = await app.request("/api/books/b1/chapters/abc/write", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userIntent: "x" }),
    });

    expect(res.status).toBe(410);
  });});
