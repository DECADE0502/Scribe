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

describe("revision through /agent/run", () => {
  it("legacy revise endpoints are gone entirely (404, no stub left)", async () => {
    const app = createApp({ bookRegistry: registry });
    const id = await setupBookWithChapter(app);

    const revise = await app.request(`/api/books/${id}/chapters/1/revise-segment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ segmentText: "text", instruction: "rewrite" }),
    });
    expect(revise.status).toBe(404);

    const apply = await app.request(`/api/books/${id}/chapters/1/apply-revision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ segmentText: "text", newSegment: "new" }),
    });
    expect(apply.status).toBe(404);
  });

  it("revises the selected segment end-to-end: merge happens server-side and commits", async () => {
    const app = createApp({
      bookRegistry: registry,
      getModel: () => makeStubModel(["这一段", "改得紧张多了。"]) as never,
      getAuditModel: () => makeStubModel(["unused"]) as never,
    });
    const id = await setupBookWithChapter(app);

    const res = await app.request(`/api/books/${id}/agent/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "改得更紧张",
        source: "revision",
        target: { revisionRange: { chapterNo: 1, selectedText: "这一段写得平淡。" } },
      }),
    });
    expect(res.status).toBe(200);
    const text = await new Response(res.body).text();
    expect(text).toContain("event: text_delta");
    expect(text).toContain('"committed":true');

    // 服务端已把新段落拼回整章:选段被替换,其余原文保留(章节文件末尾带换行)
    const chapter = await app.request(`/api/books/${id}/chapters/1`);
    const body = await chapter.json() as { content: string; title: string };
    expect(body.content.trim()).toBe("开头。这一段改得紧张多了。结尾。");
    // 用户自定义标题不被改写覆盖
    expect(body.title).toBe("第一章");

    // 版本历史多了一条 segment_revise
    const handle = registry.open(id);
    const versions = handle.chaptersRepo.listVersions(1);
    expect(versions.some((v) => v.source === "segment_revise")).toBe(true);
  });

  it("selection not found in the chapter → error event, chapter unchanged", async () => {
    const app = createApp({
      bookRegistry: registry,
      getModel: () => makeStubModel(["新段落。"]) as never,
    });
    const id = await setupBookWithChapter(app);

    const res = await app.request(`/api/books/${id}/agent/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "改",
        source: "revision",
        target: { revisionRange: { chapterNo: 1, selectedText: "根本不存在的文本" } },
      }),
    });
    const text = await new Response(res.body).text();
    expect(text).toContain("event: error");
    expect(text).toContain("selection_missing");

    const chapter = await app.request(`/api/books/${id}/chapters/1`);
    const body = await chapter.json() as { content: string };
    expect(body.content.trim()).toBe("开头。这一段写得平淡。结尾。");
  });
});