import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createBookRegistry } from "../../src/http/book-registry.js";
import { createApp } from "../../src/http/server.js";
import type { AppPaths } from "../../src/config/paths.js";

const json = <T>(res: Response): Promise<T> => res.json() as Promise<T>;

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

function okAudit(summary = "章节审查通过") {
  return JSON.stringify({
    verdict: "ok",
    issues: [
      "setting_consistency",
      "character_behavior",
      "pacing",
      "narrative_coherence",
      "foreshadowing",
      "hook_strength",
      "aesthetic_quality",
    ].map((dimension) => ({ dimension, severity: "ok", score: 8, note: "ok" })),
    summary: {
      oneLiner: summary,
      paragraph: `${summary}。人物目标清晰，设定和当前章节内容保持一致。章节保留了关键线索、行动结果和后续推进空间，足以作为审查摘要写入长期记忆。`,
      keyEvents: [{ event: summary, characters: ["林澈"], foreshadowingRefs: [] }],
    },
    hardFacts: [],
  });
}

function makeGenerateModel(texts: string[]): any {
  let index = 0;
  return {
    specificationVersion: "v1",
    provider: "stub",
    modelId: "stub-generate",
    async doGenerate() {
      const text = texts[Math.min(index, texts.length - 1)] ?? "";
      index += 1;
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
            ctrl.enqueue({ type: "finish", finishReason: "stop", usage: { promptTokens: 1, completionTokens: 0 } });
            ctrl.close();
          },
        }),
        rawCall: { rawPrompt: null, rawSettings: {} },
      };
    },
  };
}

function makeStreamingModel(chunks: string[]): any {
  return {
    specificationVersion: "v1",
    provider: "stub",
    modelId: "stub-stream",
    async doGenerate() {
      return {
        text: chunks.join(""),
        finishReason: "stop",
        usage: { promptTokens: 10, completionTokens: chunks.length },
        rawCall: { rawPrompt: null, rawSettings: {} },
      };
    },
    async doStream() {
      return {
        stream: new ReadableStream({
          start(ctrl) {
            for (const chunk of chunks) ctrl.enqueue({ type: "text-delta", textDelta: chunk });
            ctrl.enqueue({ type: "finish", finishReason: "stop", usage: { promptTokens: 10, completionTokens: chunks.length } });
            ctrl.close();
          },
        }),
        rawCall: { rawPrompt: null, rawSettings: {} },
      };
    },
  };
}

async function readSseEvents(res: Response): Promise<Array<Record<string, unknown>>> {
  const text = await new Response(res.body).text();
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
}

describe("writer-facing user journeys", () => {
  let tmp: string;
  let paths: AppPaths;
  let registry: ReturnType<typeof createBookRegistry>;
  let app: ReturnType<typeof createApp>;
  let bookId: string;

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scribe-user-journey-"));
    paths = makePaths(tmp);
    fs.mkdirSync(paths.booksDir, { recursive: true });
    registry = createBookRegistry({ paths });
    app = createApp({
      bookRegistry: registry,
      appPaths: paths,
      configJsonPath: paths.configJson,
      secretsEnvPath: paths.secretsEnv,
      getModel: () => makeGenerateModel(["草稿正文", "重写正文"]),
      getAuditModel: () => makeGenerateModel([okAudit("审查通过")]),
      auditModelInfo: { id: "stub-audit" },
      getChapterDeps: (id) => {
        const handle = registry.open(id);
        return {
          model: makeGenerateModel(["林澈带着旧地图走进雨巷。", "林澈在雨巷里重写了选择。"]),
          chaptersRepo: handle.chaptersRepo,
          chapterFiles: handle.chapterFiles,
        };
      },
      writeModelInfo: { id: "stub-write", pricing: { input: 0.1, output: 0.2 } },
      budgetLimitUsd: 100,
    });

    const created = await app.request("/api/books", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "雾城手记", genre: "都市奇幻" }),
    });
    bookId = (await json<{ id: string }>(created)).id;
  });

  afterEach(() => {
    registry.closeAll();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("lets an author prepare a book before writing", async () => {
    const meta = await app.request(`/api/books/${bookId}/meta`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "雾城手记 修订版",
        premise: "旧城区每到雨夜都会多出一条不存在的街。",
        tone: "温暖悬疑",
        genre: "都市奇幻",
      }),
    });
    expect(meta.status).toBe(200);

    const masterPrompt = await app.request(`/api/books/${bookId}/master-prompt`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ perBook: "写作时保持章节连续，不输出解释。" }),
    });
    expect((await json<{ perBook: string }>(masterPrompt)).perBook).toContain("章节连续");

    const rules = await app.request(`/api/books/${bookId}/rules`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "## 写作规则\n\n每章都要保留雨夜线索。" }),
    });
    expect(rules.status).toBe(200);

    const volume = await app.request(`/api/books/${bookId}/outline`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ level: "volume", title: "第一卷 雨街", summary: "主角发现雨街入口。", sortOrder: 1 }),
    });
    expect(volume.status).toBe(201);
    const chapterNode = await app.request(`/api/books/${bookId}/outline`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ level: "chapter", title: "第1章 雨巷", summary: "林澈收到旧地图。", sortOrder: 2 }),
    });
    expect(chapterNode.status).toBe(201);

    const handle = registry.open(bookId);
    handle.charactersRepo.create({
      name: "林澈",
      role: "protagonist",
      baseData: { motivation: "找回失踪的妹妹" },
      currentState: { location: "旧城区", clueCount: 0 },
    });

    const status = await app.request(`/api/books/${bookId}/onboard-status`);
    const onboard = await json<{ ok: boolean; missing: string[] }>(status);
    expect(onboard.ok).toBe(true);
    expect(onboard.missing).toEqual([]);

    const metaRead = await app.request(`/api/books/${bookId}/meta`);
    expect((await json<{ title: string; premise: string }>(metaRead)).title).toBe("雾城手记 修订版");
  });

  it("lets an author maintain story bible records and broadcasts manual edits", async () => {
    const handle = registry.open(bookId);
    const character = handle.charactersRepo.create({
      name: "林澈",
      role: "protagonist",
      baseData: {},
      currentState: { clueCount: 0 },
    });

    const characterUpdate = await app.request(`/api/books/${bookId}/characters/${character.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseData: { languageHabits: "句子短，先观察再判断。" },
        currentState: { clueCount: 1, location: "雨巷口" },
      }),
    });
    expect(characterUpdate.status).toBe(200);

    const foreshadowing = await app.request(`/api/books/${bookId}/foreshadowing`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "旧地图背面的红点", description: "指向雨街入口", plantedChapter: 1 }),
    });
    const foreshadowingId = (await json<{ id: string }>(foreshadowing)).id;
    expect(foreshadowing.status).toBe(201);

    const section = handle.genreSectionsRepo.createSection({
      name: "线索簿",
      schema: [
        { name: "name", type: "string", required: true, role: "identity" },
        { name: "status", type: "string", role: "status" },
      ],
      createdBy: "user",
    });
    const item = await app.request(`/api/books/${bookId}/genre-sections/${section.id}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: { name: "旧地图", status: "已获得" } }),
    });
    expect(item.status).toBe(201);

    const invalidItem = await app.request(`/api/books/${bookId}/genre-sections/${section.id}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: { status: "缺少名称" } }),
    });
    expect(invalidItem.status).toBe(400);

    const deletedForeshadowing = await app.request(`/api/books/${bookId}/foreshadowing/${foreshadowingId}`, { method: "DELETE" });
    expect(deletedForeshadowing.status).toBe(200);

    const messages = handle.conversationsRepo.listLatest(20);
    expect(messages.some((message) => message.role === "system" && message.metadata?.target === "character")).toBe(true);
    expect(messages.some((message) => message.role === "system" && message.metadata?.target === "foreshadowing")).toBe(true);
    expect(messages.some((message) => message.role === "system" && message.metadata?.target === "genre_section_item")).toBe(true);
  });

  it("supports manual chapter drafting, version recovery, export, snapshot restore, and rollback delete", async () => {
    const saved = await app.request(`/api/books/${bookId}/chapters/1`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "第一章 雨巷", content: "林澈第一次看见雨巷。" }),
    });
    expect(saved.status).toBe(200);

    await app.request(`/api/books/${bookId}/chapters/1`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "林澈把雨巷线索写进笔记。" }),
    });

    const versions = await app.request(`/api/books/${bookId}/chapters/1/versions`);
    expect((await json<{ versions: Array<{ versionNo: number }> }>(versions)).versions.map((v) => v.versionNo)).toEqual([2, 1]);

    const restoreVersion = await app.request(`/api/books/${bookId}/chapters/1/restore-version`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionNo: 1 }),
    });
    expect(restoreVersion.status).toBe(200);
    expect(registry.open(bookId).chapterFiles.read(1)?.content).toContain("第一次看见雨巷");

    await app.request(`/api/books/${bookId}/chapters/2`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "第二章 红点", content: "旧地图背面的红点亮了一下。" }),
    });

    const exported = await app.request(`/api/books/${bookId}/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format: "md" }),
    });
    const filename = (await json<{ filename: string }>(exported)).filename;
    const download = await app.request(`/api/books/${bookId}/exports/${encodeURIComponent(filename)}`);
    expect(await download.text()).toContain("旧地图背面的红点");

    const snapshot = await app.request(`/api/books/${bookId}/snapshots/create`, { method: "POST" });
    expect(snapshot.status).toBe(201);
    const snapshotName = (await json<{ filename: string }>(snapshot)).filename;

    await app.request(`/api/books/${bookId}/chapters/1`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "误删后的坏内容" }),
    });
    const restoreWithoutConfirm = await app.request(`/api/books/${bookId}/snapshots/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: snapshotName }),
    });
    expect(restoreWithoutConfirm.status).toBe(400);
    const restoreSnapshot = await app.request(`/api/books/${bookId}/snapshots/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: snapshotName, confirmText: "RESTORE" }),
    });
    expect(restoreSnapshot.status).toBe(200);
    expect(registry.open(bookId).chapterFiles.read(1)?.content).not.toContain("误删");

    const deleteFromSecond = await app.request(`/api/books/${bookId}/chapters/2`, { method: "DELETE" });
    expect(deleteFromSecond.status).toBe(200);
    expect(registry.open(bookId).chapterFiles.read(1)).toBeTruthy();
    expect(registry.open(bookId).chapterFiles.read(2)).toBeUndefined();
  });

  it("keeps legacy AI draft/finalize routes deleted (404, no stub left)", async () => {
    const draft = await app.request(`/api/books/${bookId}/chapters/1/write-draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userIntent: "按大纲写第一章" }),
    });
    const finalize = await app.request(`/api/books/${bookId}/chapters/1/finalize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userIntent: "确认第一章" }),
    });

    expect(draft.status).toBe(404);
    expect(finalize.status).toBe(404);
  });
  it("supports conversation, worldbook editing, imports, settings, usage, and common error paths", async () => {
    const chatApp = createApp({
      bookRegistry: registry,
      appPaths: paths,
      configJsonPath: paths.configJson,
      secretsEnvPath: paths.secretsEnv,
      getModel: () => makeStreamingModel(["收到，我会整理雨街设定。"]),
    });

    const conversation = await chatApp.request(`/api/books/${bookId}/agent/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "帮我整理雨街规则", source: "chat" }),
    });
    expect(conversation.status).toBe(200);
    const conversationText = await new Response(conversation.body).text();
    expect(conversationText).toContain("event: text_delta");
    expect(conversationText).toContain("收到，我会整理雨街设定。");
    expect(conversationText).not.toContain("event: main_output");

    const worldbook = await chatApp.request(`/api/books/${bookId}/worldbook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "雨街",
        content: "雨街只在连续降雨三小时后出现。",
        activation: "triggered",
        keys: ["雨街"],
        priority: 50,
      }),
    });
    const worldbookId = (await json<{ entry: { id: string } }>(worldbook)).entry.id;
    expect(worldbook.status).toBe(201);

    const preview = await chatApp.request(`/api/books/${bookId}/worldbook/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "林澈走到雨街入口" }),
    });
    expect((await json<{ selected: Array<{ title: string }>; rendered: string }>(preview)).rendered).toContain("连续降雨");

    const importedPreset = await chatApp.request(`/api/books/${bookId}/imports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "preset.json",
        json: {
          prompts: [{ identifier: "main", name: "Main", role: "system", content: "保持温柔悬疑。" }],
          prompt_order: [{ character_id: 100001, order: [{ identifier: "main", enabled: true }] }],
        },
      }),
    });
    expect(importedPreset.status).toBe(201);

    const importedWorldbook = await chatApp.request(`/api/books/${bookId}/imports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "worldbook.json",
        json: { entries: { "0": { key: ["红伞"], comment: "红伞", content: "红伞属于失踪的妹妹。", constant: false } } },
      }),
    });
    expect(importedWorldbook.status).toBe(201);

    const settings = await chatApp.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "deepseek", singleBudgetUsd: 12 }),
    });
    expect((await json<{ singleBudgetUsd: number }>(settings)).singleBudgetUsd).toBe(12);

    registry.open(bookId).tokenUsageRepo.record({
      taskType: "write",
      model: "stub",
      promptTokens: 100,
      completionTokens: 80,
      cachedTokens: 0,
      reasoningTokens: 0,
      costUsd: 0.02,
      chapterNo: 1,
    });
    const usage = await chatApp.request(`/api/books/${bookId}/usage/summary`);
    expect((await json<{ totalUsd: number }>(usage)).totalUsd).toBeCloseTo(0.02, 5);

    const badWorldbook = await chatApp.request(`/api/books/${bookId}/worldbook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "", content: "" }),
    });
    expect(badWorldbook.status).toBe(400);

    const missingBook = await chatApp.request("/api/books/missing-book/worldbook");
    expect(missingBook.status).toBe(404);

    const traversal = await chatApp.request(`/api/books/${bookId}/exports/..%2F..%2Fsecrets.env`);
    expect(traversal.status).toBe(400);

    const deleteWorldbook = await chatApp.request(`/api/books/${bookId}/worldbook/${worldbookId}`, { method: "DELETE" });
    expect(deleteWorldbook.status).toBe(204);
  });
});
