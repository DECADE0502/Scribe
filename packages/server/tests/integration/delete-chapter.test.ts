import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createBookRegistry } from "../../src/http/book-registry.js";
import type { BookHandle } from "../../src/http/book-registry.js";
import { createApp } from "../../src/http/server.js";
import { makeStubLanguageModel } from "../fixtures/mock-llm.js";
import type { AppPaths } from "../../src/config/paths.js";
import { deleteChaptersFrom } from "../../src/ai/orchestrator/delete-chapter.js";

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

function seedChapter(handle: BookHandle, no: number, content: string) {
  const v = handle.chaptersRepo.saveVersion({ chapterNo: no, source: "user_edit" as const, contentMd: content });
  handle.chapterFiles.save({ chapterNo: no, title: `第${no}章`, content, versionNo: v.versionNo });
}

describe("删除章节（回档语义）", () => {
  let tmp: string;
  let registry: ReturnType<typeof createBookRegistry>;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scribe-del-"));
    const paths = makePaths(tmp);
    fs.mkdirSync(paths.booksDir, { recursive: true });
    registry = createBookRegistry({ paths });
  });

  afterEach(() => {
    registry.closeAll();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("deleteChaptersFrom(3) 删第 3 章及之后，保留 1/2 章", async () => {
    const createApp1 = createApp({ bookRegistry: registry });
    const res = await createApp1.request("/api/books", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "删章测试书" }),
    });
    const book = (await res.json()) as { id: string };
    const handle = registry.open(book.id);

    seedChapter(handle, 1, "第一章正文");
    seedChapter(handle, 2, "第二章正文");
    seedChapter(handle, 3, "第三章正文");
    seedChapter(handle, 4, "第四章正文");

    // 加摘要、时间线、伏笔、角色出场
    handle.chaptersRepo.saveSummary({
      chapterNo: 1, oneLiner: "一", paragraph: "一", keyEvents: [],
      generatedAt: Date.now(), reasoningContent: null,
    });
    handle.chaptersRepo.saveSummary({
      chapterNo: 3, oneLiner: "三", paragraph: "三", keyEvents: [],
      generatedAt: Date.now(), reasoningContent: null,
    });
    handle.timelineRepo.create({
      chapterNo: 3, storyTime: "当夜", event: "事件三", participants: [],
    });
    handle.foreshadowingRepo.create({
      label: "伏笔A", description: "第三章埋下",
      plantedChapter: 3, paidChapter: null,
      status: "active" as const, relatedCharacters: [],
    });
    const char = handle.charactersRepo.create({
      name: "主角", role: "protagonist",
      baseData: {}, currentState: { 位置: "王城" },
    });
    handle.charactersRepo.addAppearance(char.id, { chapterNo: 1, brief: "登场" });
    handle.charactersRepo.addAppearance(char.id, { chapterNo: 3, brief: "进城" });

    const result = deleteChaptersFrom(handle, 3);

    expect(result.deletedChapters).toEqual([3, 4]);
    expect(handle.chapterFiles.list().map((c) => c.chapterNo)).toEqual([1, 2]);
    expect(handle.chaptersRepo.getSummary(1)).toBeDefined();
    expect(handle.chaptersRepo.getSummary(3)).toBeUndefined();
    expect(handle.timelineRepo.listByChapter(3)).toHaveLength(0);
    expect(handle.foreshadowingRepo.list().filter((f) => f.plantedChapter === 3)).toHaveLength(0);
    const updatedChar = handle.charactersRepo.get(char.id)!;
    expect(updatedChar.appearances).toHaveLength(1);
    expect(updatedChar.appearances[0]!.chapterNo).toBe(1);
    expect(result.affectedCharacterNames).toContain("主角");
  });

  it("DELETE /api/books/:id/chapters/:no 路由正常", async () => {
    const createApp1 = createApp({ bookRegistry: registry });
    const res = await createApp1.request("/api/books", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "路由测试书" }),
    });
    const book = (await res.json()) as { id: string };
    const handle = registry.open(book.id);
    seedChapter(handle, 1, "一");
    seedChapter(handle, 2, "二");
    seedChapter(handle, 3, "三");

    const app = createApp({ bookRegistry: registry });
    const delRes = await app.request(`/api/books/${book.id}/chapters/2`, { method: "DELETE" });
    expect(delRes.status).toBe(200);
    const body = (await delRes.json()) as { result: { deletedChapters: number[] } };
    expect(body.result.deletedChapters).toEqual([2, 3]);
    expect(handle.chapterFiles.list().map((c) => c.chapterNo)).toEqual([1]);
  });

  it("DELETE /api/books/:id/chapters 删所有章", async () => {
    const createApp1 = createApp({ bookRegistry: registry });
    const res = await createApp1.request("/api/books", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "全删测试书" }),
    });
    const book = (await res.json()) as { id: string };
    const handle = registry.open(book.id);
    seedChapter(handle, 1, "一");
    seedChapter(handle, 2, "二");

    const app = createApp({ bookRegistry: registry });
    const delRes = await app.request(`/api/books/${book.id}/chapters`, { method: "DELETE" });
    expect(delRes.status).toBe(200);
    const body = (await delRes.json()) as { result: { deletedChapters: number[] } };
    expect(body.result.deletedChapters).toEqual([1, 2]);
    expect(handle.chapterFiles.list()).toHaveLength(0);
  });

  it("删除不存在的章号返回 404", async () => {
    const createApp1 = createApp({ bookRegistry: registry });
    const res = await createApp1.request("/api/books", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "空书" }),
    });
    const book = (await res.json()) as { id: string };

    const app = createApp({ bookRegistry: registry });
    const delRes = await app.request(`/api/books/${book.id}/chapters/5`, { method: "DELETE" });
    expect(delRes.status).toBe(404);
  });

  it("token_usage 保留不删", async () => {
    const createApp1 = createApp({ bookRegistry: registry });
    const res = await createApp1.request("/api/books", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "用量测试书" }),
    });
    const book = (await res.json()) as { id: string };
    const handle = registry.open(book.id);
    seedChapter(handle, 1, "一");
    seedChapter(handle, 2, "二");
    handle.tokenUsageRepo.record({
      taskType: "write" as const, model: "stub", promptTokens: 100,
      completionTokens: 200, cachedTokens: 0, reasoningTokens: 0,
      costUsd: 0.01, chapterNo: 2,
    });

    deleteChaptersFrom(handle, 2);

    const sum = handle.tokenUsageRepo.sumByChapter(2);
    expect(sum.promptTokens).toBe(100);
    expect(sum.completionTokens).toBe(200);
  });
});
