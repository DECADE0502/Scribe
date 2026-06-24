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

describe("legacy revision routes", () => {
  it("removes revise-segment as an executable AI route", async () => {
    const app = createApp({ bookRegistry: registry, getModel: () => makeStubModel(["x"]) as never });
    const id = await setupBookWithChapter(app);
    const res = await app.request(`/api/books/${id}/chapters/1/revise-segment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ segmentText: "text", instruction: "rewrite" }),
    });

    expect(res.status).toBe(410);
    expect(await res.json()).toMatchObject({ error: "legacy_revise_segment_removed" });
  });

  it("removes apply-revision as a direct persistence route", async () => {
    const app = createApp({ bookRegistry: registry });
    const id = await setupBookWithChapter(app);
    const res = await app.request(`/api/books/${id}/chapters/1/apply-revision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ segmentText: "text", newSegment: "new" }),
    });

    expect(res.status).toBe(410);
    expect(await res.json()).toMatchObject({ error: "legacy_apply_revision_removed" });
  });

  it("keeps invalid chapter numbers as request validation errors", async () => {
    const app = createApp({ bookRegistry: registry });
    const res = await app.request("/api/books/b1/chapters/abc/revise-segment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ segmentText: "text" }),
    });

    expect(res.status).toBe(400);
  });
});