import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createBookRegistry } from "../../src/http/book-registry.js";
import { createApp } from "../../src/http/server.js";
import { estimateAutoModeCost, checkAutoModeBudget } from "../../src/ai/budget-check.js";
import type { ModelInfo } from "@scribe/shared";

let tmp: string;
let registry: ReturnType<typeof createBookRegistry>;

function makePaths(root: string) {
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

const dsPro: ModelInfo = { id: "ds-pro", pricing: { input: 0.27, output: 1.1 } };
const dsFlash: ModelInfo = { id: "ds-flash", pricing: { input: 0.07, output: 0.28 } };

/** 写作 stub:每次 doStream 输出固定正文 */
function makeWriteModel() {
  return {
    specificationVersion: "v1" as const,
    provider: "stub", modelId: "stub-write",
    async doGenerate() { throw new Error("not used"); },
    async doStream() {
      return {
        stream: new ReadableStream({
          start(ctrl) {
            ctrl.enqueue({ type: "text-delta", textDelta: "本章正文。" });
            ctrl.enqueue({ type: "finish", finishReason: "stop", usage: { promptTokens: 10, completionTokens: 5 } });
            ctrl.close();
          },
        }),
        rawCall: { rawPrompt: null, rawSettings: {} },
      };
    },
  };
}

const okAudit = JSON.stringify({
  verdict: "ok",
  issues: Array.from({ length: 7 }, (_, i) => ({
    dimension: ["setting_consistency","character_behavior","pacing","narrative_coherence","foreshadowing","hook_strength","aesthetic_quality"][i],
    severity: "ok", score: 8, note: "ok",
  })),
  summary: { oneLiner: "一句话", paragraph: "段落".repeat(30), keyEvents: [] },
});

const criticalAudit = JSON.stringify({
  verdict: "critical",
  issues: [
    { dimension: "character_behavior", severity: "critical", score: 2, note: "OOC" },
    ...Array.from({ length: 6 }, (_, i) => ({
      dimension: ["setting_consistency","pacing","narrative_coherence","foreshadowing","hook_strength","aesthetic_quality"][i],
      severity: "ok", score: 8, note: "ok",
    })),
  ],
  summary: { oneLiner: "一句话", paragraph: "段落".repeat(30), keyEvents: [] },
});

/** audit stub:按章节序列返回 verdict(repair 后再审同样吃序列) */
function makeAuditModel(sequence: string[]) {
  let i = 0;
  return {
    specificationVersion: "v1" as const,
    provider: "stub", modelId: "stub-audit",
    async doGenerate() {
      const text = sequence[Math.min(i, sequence.length - 1)]!;
      i++;
      return { text, finishReason: "stop", usage: { promptTokens: 10, completionTokens: 5 }, rawCall: { rawPrompt: null, rawSettings: {} } };
    },
    async doStream() { throw new Error("not used"); },
  };
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scribe-auto-"));
  const paths = makePaths(tmp);
  fs.mkdirSync(paths.booksDir, { recursive: true });
  registry = createBookRegistry({ paths });
});

afterEach(() => {
  registry.closeAll();
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function createBook(app: ReturnType<typeof createApp>): Promise<string> {
  const res = await app.request("/api/books", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "自动测试" }),
  });
  return (await res.json() as { id: string }).id;
}

describe("budget-check 单元", () => {
  it("无历史用默认估算,2 章成本可计算", () => {
    const est = estimateAutoModeCost(2, dsPro, dsFlash);
    expect(est.basis).toBe("default");
    expect(est.estimatedUsd).toBeGreaterThan(0);
    expect(est.estimatedUsd).toBeCloseTo(est.perChapterUsd * 2, 10);
  });

  it("超限拒绝", () => {
    const r = checkAutoModeBudget(1000, 0.01, dsPro, dsFlash);
    expect(r.ok).toBe(false);
  });

  it("有历史时用历史均值", () => {
    const est = estimateAutoModeCost(1, dsPro, dsFlash, {
      recentWriteAverage: () => ({ promptTokens: 100, completionTokens: 100 }),
    });
    expect(est.basis).toBe("history");
  });
});

describe("POST /api/books/:id/auto", () => {
  function makeApp() {
    return createApp({
      bookRegistry: registry,
      getModel: () => makeWriteModel() as never,
      getAuditModel: () => makeAuditModel([okAudit, criticalAudit]) as never,
      budgetLimitUsd: 100,
      writeModelInfo: dsPro,
      auditModelInfo: dsFlash,
    });
  }

  it("第 1 章 ok 第 2 章 critical → 只完成 1 章,paused_by_critical", async () => {
    const app = makeApp();
    const id = await createBook(app);
    const res = await app.request(`/api/books/${id}/auto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ n: 3 }),
    });
    expect(res.status).toBe(200);
    const text = await new Response(res.body).text();
    expect(text).toContain("paused_by_critical");
    expect(text).not.toContain('"state":"done"');

    const handle = registry.open(id);
    // 第 1 章 ok(1 version),第 2 章 critical 且 repair 后再审仍 critical(序列耗尽重复 critical)
    expect(handle.chaptersRepo.getAudit(1)?.verdict).toBe("ok");
    expect(handle.chaptersRepo.getAudit(2)?.verdict).toBe("critical");
  });

  it("预算超限 → SSE budget_exceeded", async () => {
    const app = createApp({
      bookRegistry: registry,
      getModel: () => makeWriteModel() as never,
      getAuditModel: () => makeAuditModel([okAudit]) as never,
      budgetLimitUsd: 0.000001,
      writeModelInfo: dsPro,
      auditModelInfo: dsFlash,
    });
    const id = await createBook(app);
    const res = await app.request(`/api/books/${id}/auto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ n: 5 }),
    });
    const text = await new Response(res.body).text();
    expect(text).toContain("budget_exceeded");
    expect(text).toContain("超过单次上限");
  });

  it("n 非法 400;书不存在 404;无 model 503", async () => {
    const app = makeApp();
    const id = await createBook(app);
    const r400 = await app.request(`/api/books/${id}/auto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ n: 0 }),
    });
    expect(r400.status).toBe(400);

    const r404 = await app.request("/api/books/ghost/auto", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ n: 1 }),
    });
    expect(r404.status).toBe(404);

    const appNoModel = createApp({ bookRegistry: registry });
    const id2 = await createBook(appNoModel);
    const r503 = await appNoModel.request(`/api/books/${id2}/auto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ n: 1 }),
    });
    expect(r503.status).toBe(503);
  });

  it("全部 ok → done 状态 + N 章完成", async () => {
    const app = createApp({
      bookRegistry: registry,
      getModel: () => makeWriteModel() as never,
      getAuditModel: () => makeAuditModel([okAudit]) as never,
      budgetLimitUsd: 100,
      writeModelInfo: dsPro,
      auditModelInfo: dsFlash,
    });
    const id = await createBook(app);
    const res = await app.request(`/api/books/${id}/auto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ n: 2 }),
    });
    const text = await new Response(res.body).text();
    expect(text).toContain('"state":"done"');
    const handle = registry.open(id);
    expect(handle.chaptersRepo.maxChapterNo()).toBe(2);
  });
});

describe("版本路由", () => {
  it("GET versions 倒序;restore-version 创建新 user_edit version", async () => {
    const app = createApp({ bookRegistry: registry });
    const id = await createBook(app);
    // 直接写两个版本
    await app.request(`/api/books/${id}/chapters/1`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "v1 内容", title: "第一章" }),
    });
    await app.request(`/api/books/${id}/chapters/1`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "v2 内容" }),
    });

    const list = await app.request(`/api/books/${id}/chapters/1/versions`);
    const j = await list.json() as { versions: Array<{ versionNo: number; source: string }> };
    expect(j.versions.map(v => v.versionNo)).toEqual([2, 1]);

    // 回滚到 v1
    const restore = await app.request(`/api/books/${id}/chapters/1/restore-version`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionNo: 1 }),
    });
    expect(restore.status).toBe(200);
    const rj = await restore.json() as { versionNo: number; restoredFrom: number };
    expect(rj.versionNo).toBe(3);
    expect(rj.restoredFrom).toBe(1);
    const handle = registry.open(id);
    expect(handle.chapterFiles.read(1)?.content).toContain("v1 内容");
    expect(handle.chaptersRepo.listVersions(1)).toHaveLength(3);
  });

  it("restore 不存在的版本 404", async () => {
    const app = createApp({ bookRegistry: registry });
    const id = await createBook(app);
    const res = await app.request(`/api/books/${id}/chapters/1/restore-version`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionNo: 99 }),
    });
    expect(res.status).toBe(404);
  });
});

describe("用量与设置路由", () => {
  it("usage/summary 聚合正确", async () => {
    const app = createApp({ bookRegistry: registry });
    const id = await createBook(app);
    const handle = registry.open(id);
    handle.tokenUsageRepo.record({
      taskType: "write", model: "ds-pro", promptTokens: 100, completionTokens: 200,
      cachedTokens: 0, reasoningTokens: 0, costUsd: 0.5, chapterNo: 1,
    });
    handle.tokenUsageRepo.record({
      taskType: "audit", model: "ds-flash", promptTokens: 50, completionTokens: 20,
      cachedTokens: 0, reasoningTokens: 0, costUsd: 0.1, chapterNo: 1,
    });
    const res = await app.request(`/api/books/${id}/usage/summary`);
    const j = await res.json() as {
      totalUsd: number;
      byTaskType: Array<{ taskType: string; costUsd: number }>;
      byModel: Array<{ model: string }>;
      byChapter: Array<{ chapterNo: number | null; costUsd: number }>;
    };
    expect(j.totalUsd).toBeCloseTo(0.6, 5);
    expect(j.byTaskType).toHaveLength(2);
    expect(j.byModel.map(m => m.model).sort()).toEqual(["ds-flash", "ds-pro"]);
    expect(j.byChapter[0]!.costUsd).toBeCloseTo(0.6, 5);
  });

  it("usage/recent 返回明细", async () => {
    const app = createApp({ bookRegistry: registry });
    const id = await createBook(app);
    const handle = registry.open(id);
    handle.tokenUsageRepo.record({
      taskType: "chat", model: "ds-pro", promptTokens: 10, completionTokens: 5,
      cachedTokens: 0, reasoningTokens: 0, costUsd: 0.01, chapterNo: null,
    });
    const res = await app.request(`/api/books/${id}/usage/recent?limit=10`);
    const j = await res.json() as { records: Array<{ taskType: string }> };
    expect(j.records).toHaveLength(1);
    expect(j.records[0]!.taskType).toBe("chat");
  });

  it("GET/PUT settings 读写预算上限", async () => {
    const configPath = path.posix.join(tmp, "config.json");
    const app = createApp({ bookRegistry: registry, configJsonPath: configPath });
    const get1 = await app.request("/api/settings");
    expect((await get1.json() as { singleBudgetUsd: number }).singleBudgetUsd).toBe(5);

    const put = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ singleBudgetUsd: 10 }),
    });
    expect((await put.json() as { singleBudgetUsd: number }).singleBudgetUsd).toBe(10);

    const get2 = await app.request("/api/settings");
    expect((await get2.json() as { singleBudgetUsd: number }).singleBudgetUsd).toBe(10);
  });
});
