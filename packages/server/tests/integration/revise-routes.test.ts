import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createBookRegistry } from "../../src/http/book-registry.js";
import { createApp } from "../../src/http/server.js";

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

function makeStubModel(chunks: string[]) {
  return {
    specificationVersion: "v1" as const,
    provider: "stub",
    modelId: "stub",
    async doGenerate() { throw new Error("not used"); },
    async doStream() {
      return {
        stream: new ReadableStream({
          start(ctrl) {
            for (const ch of chunks) ctrl.enqueue({ type: "text-delta", textDelta: ch });
            ctrl.enqueue({ type: "finish", finishReason: "stop", usage: { promptTokens: 10, completionTokens: chunks.length } });
            ctrl.close();
          },
        }),
        rawCall: { rawPrompt: null, rawSettings: {} },
      };
    },
  };
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scribe-revise-"));
  const paths = makePaths(tmp);
  fs.mkdirSync(paths.booksDir, { recursive: true });
  registry = createBookRegistry({ paths });
});

afterEach(() => {
  registry.closeAll();
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function setupBookWithChapter(app: ReturnType<typeof createApp>): Promise<string> {
  const res = await app.request("/api/books", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "改写测试" }),
  });
  const { id } = await res.json() as { id: string };
  await app.request(`/api/books/${id}/chapters/1`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: "开头。这一段写得平淡。结尾。", title: "第一章" }),
  });
  return id;
}

describe("POST /chapters/:no/revise-segment", () => {
  it("流式输出新段落,不落盘", async () => {
    const app = createApp({
      bookRegistry: registry,
      getModel: () => makeStubModel(["这一段", "如刀刻般冷峻。"]) as never,
    });
    const id = await setupBookWithChapter(app);
    const res = await app.request(`/api/books/${id}/chapters/1/revise-segment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ segmentText: "这一段写得平淡。", instruction: "更冷峻" }),
    });
    expect(res.status).toBe(200);
    const text = await new Response(res.body).text();
    expect(text).toContain("event: text_delta");
    expect(text).toContain("如刀刻般冷峻");
    expect(text).toContain("event: done");
    // 不落盘:仍只有 1 个 version
    const handle = registry.open(id);
    expect(handle.chaptersRepo.listVersions(1)).toHaveLength(1);
    expect(handle.chapterFiles.read(1)?.content).toContain("这一段写得平淡。");
  });

  it("segmentText 与章节不匹配 → SSE error 事件", async () => {
    const app = createApp({
      bookRegistry: registry,
      getModel: () => makeStubModel(["x"]) as never,
    });
    const id = await setupBookWithChapter(app);
    const res = await app.request(`/api/books/${id}/chapters/1/revise-segment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ segmentText: "不存在的段落", instruction: "x" }),
    });
    const text = await new Response(res.body).text();
    expect(text).toContain("event: error");
    expect(text).toContain("segment_not_found");
  });

  it("空 segmentText 返回 400;无 model 返回 503;章节缺失 404", async () => {
    const appNoModel = createApp({ bookRegistry: registry });
    const id = await setupBookWithChapter(appNoModel);

    const r400 = await appNoModel.request(`/api/books/${id}/chapters/1/revise-segment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ segmentText: " " }),
    });
    expect(r400.status).toBe(400);

    const r503 = await appNoModel.request(`/api/books/${id}/chapters/1/revise-segment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ segmentText: "这一段写得平淡。" }),
    });
    expect(r503.status).toBe(503);

    const appWithModel = createApp({ bookRegistry: registry, getModel: () => makeStubModel(["x"]) as never });
    const r404 = await appWithModel.request(`/api/books/${id}/chapters/9/revise-segment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ segmentText: "x" }),
    });
    expect(r404.status).toBe(404);
  });
});

describe("POST /chapters/:no/apply-revision", () => {
  it("happy:替换段落,新增 segment_revise version,.md 同步", async () => {
    const app = createApp({ bookRegistry: registry });
    const id = await setupBookWithChapter(app);
    const res = await app.request(`/api/books/${id}/chapters/1/apply-revision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        segmentText: "这一段写得平淡。",
        newSegment: "这一段如刀刻般冷峻。",
      }),
    });
    expect(res.status).toBe(200);
    const j = await res.json() as { versionNo: number; content: string };
    expect(j.versionNo).toBe(2);
    expect(j.content.trim()).toBe("开头。这一段如刀刻般冷峻。结尾。");

    const handle = registry.open(id);
    const versions = handle.chaptersRepo.listVersions(1);
    expect(versions).toHaveLength(2);
    expect(versions[0]!.source).toBe("segment_revise"); // listVersions desc
    expect(handle.chapterFiles.read(1)?.content.trim()).toBe("开头。这一段如刀刻般冷峻。结尾。");
  });

  it("段落不匹配返回 409(章节可能已被修改)", async () => {
    const app = createApp({ bookRegistry: registry });
    const id = await setupBookWithChapter(app);
    const res = await app.request(`/api/books/${id}/chapters/1/apply-revision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ segmentText: "已经不存在的旧段落", newSegment: "x" }),
    });
    expect(res.status).toBe(409);
  });

  it("缺参数返回 400", async () => {
    const app = createApp({ bookRegistry: registry });
    const id = await setupBookWithChapter(app);
    const res = await app.request(`/api/books/${id}/chapters/1/apply-revision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ segmentText: "x" }),
    });
    expect(res.status).toBe(400);
  });
});
