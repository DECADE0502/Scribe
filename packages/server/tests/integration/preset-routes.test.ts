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
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scribe-preset-routes-"));
  const paths = makePaths(tmp);
  fs.mkdirSync(paths.booksDir, { recursive: true });
  registry = createBookRegistry({ paths });
  app = createApp({ bookRegistry: registry });
  const create = await app.request("/api/books", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Preset routes" }),
  });
  bookId = ((await create.json()) as { id: string }).id;
});

afterEach(() => {
  registry.closeAll();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("preset routes", () => {
  it("lists presets and toggles prompt blocks", async () => {
    const handle = registry.open(bookId);
    const preset = handle.promptPresetsRepo.createPreset({
      name: "Imported",
      enabled: true,
    });
    const block = handle.promptPresetsRepo.createBlock({
      presetId: preset.id,
      sourceIdentifier: "main",
      name: "Main",
      role: "system",
      content: "Write well.",
      enabled: true,
      stackIndex: 0,
      injectionPosition: 0,
      injectionDepth: 4,
      injectionOrder: 100,
      systemPrompt: false,
      marker: false,
      forbidOverrides: false,
      injectionTrigger: [],
      sourcePromptEnabled: true,
      sourceOrderEnabled: true,
      metadata: {},
    });

    const list = await app.request(`/api/books/${bookId}/presets`);
    expect(list.status).toBe(200);
    const listJson = await json<{
      presets: Array<{ id: string; blocks: Array<{ id: string }> }>;
    }>(list);
    expect(listJson.presets[0]!.blocks[0]!.id).toBe(block.id);

    const update = await app.request(
      `/api/books/${bookId}/presets/${preset.id}/blocks/${block.id}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: false,
          content: "Write with continuity.",
          stackIndex: 2,
        }),
      },
    );
    expect(update.status).toBe(200);
    const updated = handle.promptPresetsRepo.listBlocks(preset.id)[0]!;
    expect(updated.enabled).toBe(false);
    expect(updated.content).toBe("Write with continuity.");
    expect(updated.stackIndex).toBe(2);
  });

  it("updates preset generation settings and regex scripts", async () => {
    const handle = registry.open(bookId);
    const preset = handle.promptPresetsRepo.createPreset({
      name: "Imported",
      enabled: true,
      generationSettings: { temperature: 0.7 },
      extensions: {
        regex_scripts: [{
          id: "r1",
          scriptName: "replace bad",
          findRegex: "/bad/g",
          replaceString: "good",
          disabled: false,
          promptOnly: true,
        }],
      },
      regexScriptsEnabled: true,
    });

    const update = await app.request(
      `/api/books/${bookId}/presets/${preset.id}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: false,
          generationSettings: { temperature: 0.95, top_p: 0.8 },
          regexScriptsEnabled: true,
          regexScripts: [{
            id: "r1",
            scriptName: "replace bad",
            findRegex: "/bad/g",
            replaceString: "better",
            disabled: true,
            promptOnly: true,
          }],
        }),
      },
    );

    expect(update.status).toBe(200);
    const updated = handle.promptPresetsRepo.getPreset(preset.id)!;
    expect(updated.enabled).toBe(false);
    expect(updated.generationSettings).toEqual({ temperature: 0.95, top_p: 0.8 });
    expect(updated.regexScriptsEnabled).toBe(true);
    expect(updated.extensions.regex_scripts).toMatchObject([{
      id: "r1",
      replaceString: "better",
      disabled: true,
    }]);
  });
});
