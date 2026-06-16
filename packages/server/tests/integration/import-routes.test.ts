import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createBookRegistry } from "../../src/http/book-registry.js";
import { createApp } from "../../src/http/server.js";

const json = <T>(res: Response): Promise<T> => res.json() as Promise<T>;

let tmp: string;
let registry: ReturnType<typeof createBookRegistry>;
let app: ReturnType<typeof createApp>;
let bookId: string;

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

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scribe-import-routes-"));
  const paths = makePaths(tmp);
  fs.mkdirSync(paths.booksDir, { recursive: true });
  registry = createBookRegistry({ paths });
  app = createApp({ bookRegistry: registry });
  const create = await app.request("/api/books", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Import test" }),
  });
  bookId = ((await create.json()) as { id: string }).id;
});

afterEach(() => {
  registry.closeAll();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("sillytavern import routes", () => {
  it("previews and imports a preset using prompt_order state", async () => {
    const payload = {
      filename: "Izumi 0503.json",
      json: {
        temperature: 1,
        prompts: [{
          identifier: "main",
          name: "Main",
          enabled: false,
          role: "system",
          content: "Write with continuity.",
        }],
        prompt_order: [{
          character_id: 100001,
          order: [{ identifier: "main", enabled: true }],
        }],
      },
    };

    const preview = await app.request(`/api/books/${bookId}/imports/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(preview.status).toBe(200);
    const previewJson = await json<{
      sourceType: string;
      stats: Record<string, unknown>;
    }>(preview);
    expect(previewJson.sourceType).toBe("sillytavern_preset");
    expect(previewJson.stats.promptCount).toBe(1);

    const imported = await app.request(`/api/books/${bookId}/imports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(imported.status).toBe(201);
    const importedJson = await json<{
      sourceType: string;
      imported: { promptBlocks: number };
    }>(imported);
    expect(importedJson.imported.promptBlocks).toBe(1);
    const handle = registry.open(bookId);
    expect(handle.importArtifactsRepo.list()).toHaveLength(1);
    expect(handle.promptPresetsRepo.listPresets()).toHaveLength(1);
    expect(handle.promptPresetsRepo.listBlocks(
      handle.promptPresetsRepo.listPresets()[0]!.id,
    )[0]!.enabled).toBe(true);
  });

  it("imports a worldbook into native worldbook entries", async () => {
    const imported = await app.request(`/api/books/${bookId}/imports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "worldbook.json",
        json: {
          entries: {
            "0": {
              key: ["capture"],
              keysecondary: [],
              comment: "Capture rules",
              content: "Capture must roll probability.",
              constant: false,
              order: 88,
              depth: 4,
              disable: false,
              role: "system",
            },
          },
        },
      }),
    });

    expect(imported.status).toBe(201);
    const handle = registry.open(bookId);
    const captureEntry = handle.worldbookRepo
      .list()
      .find((entry) => entry.title === "Capture rules");
    expect(captureEntry).toBeTruthy();
    expect(captureEntry!.metadata).toMatchObject({
      sourceImportId: expect.any(String),
      sillytavern: { uid: "0" },
    });
  });
});
