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
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scribe-worldbook-routes-"));
  const paths = makePaths(tmp);
  fs.mkdirSync(paths.booksDir, { recursive: true });
  registry = createBookRegistry({ paths });
  app = createApp({ bookRegistry: registry });
  const create = await app.request("/api/books", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Worldbook route test" }),
  });
  bookId = ((await create.json()) as { id: string }).id;
});

afterEach(() => {
  registry.closeAll();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("worldbook routes", () => {
  it("creates, lists, updates, deletes entries, and previews retrieval", async () => {
    const create = await app.request(`/api/books/${bookId}/worldbook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Harbor tower",
        content: "The harbor tower controls the tide engine.",
        keys: ["harbor tower"],
        priority: 30,
        recursive: true,
        recursionLimit: 1,
      }),
    });
    expect(create.status).toBe(201);
    const created = await json<{ entry: { id: string; title: string } }>(create);
    expect(created.entry.title).toBe("Harbor tower");

    const list = await app.request(`/api/books/${bookId}/worldbook`);
    expect(list.status).toBe(200);
    expect(
      (await json<{ entries: Array<{ title: string }> }>(list)).entries.map(
        (entry) => entry.title,
      ),
    ).toContain("Harbor tower");

    const update = await app.request(
      `/api/books/${bookId}/worldbook/${created.entry.id}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: false, priority: 90 }),
      },
    );
    expect(update.status).toBe(200);
    const updated = await json<{ entry: { enabled: boolean; priority: number } }>(
      update,
    );
    expect(updated.entry.enabled).toBe(false);
    expect(updated.entry.priority).toBe(90);

    await app.request(`/api/books/${bookId}/worldbook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Tide engine",
        content: "Tide engine scenes must mention the pressure bells.",
        keys: ["tide engine"],
        priority: 50,
      }),
    });
    const preview = await app.request(`/api/books/${bookId}/worldbook/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "Repair the tide engine." }),
    });
    expect(preview.status).toBe(200);
    const previewJson = await json<{
      selected: Array<{ entry: { title: string } }>;
      rendered: string;
    }>(preview);
    expect(previewJson.selected.map((item) => item.entry.title)).toContain(
      "Tide engine",
    );
    expect(previewJson.rendered).toContain("pressure bells");

    const del = await app.request(
      `/api/books/${bookId}/worldbook/${created.entry.id}`,
      { method: "DELETE" },
    );
    expect(del.status).toBe(204);
  });

  it("returns 404 for missing books", async () => {
    const res = await app.request("/api/books/missing/worldbook");
    expect(res.status).toBe(404);
  });

  it("updates SillyTavern metadata controls and preview uses them", async () => {
    const create = await app.request(`/api/books/${bookId}/worldbook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Selective capture",
        content: "Selective capture rules require a visible status bar.",
        keys: ["capture"],
        secondaryKeys: ["status bar"],
        metadata: {
          sillytavern: {
            uid: "st-1",
            selective: false,
            probability: 100,
            useProbability: true,
            scanDepth: 10,
            rawEntry: { id: 1 },
          },
        },
      }),
    });
    const created = await json<{ entry: { id: string } }>(create);

    const update = await app.request(
      `/api/books/${bookId}/worldbook/${created.entry.id}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metadata: {
            sillytavern: {
              uid: "st-1",
              selective: true,
              probability: 100,
              useProbability: true,
              scanDepth: 1,
              matchWholeWords: true,
              rawEntry: { id: 1, preserved: true },
            },
          },
        }),
      },
    );
    expect(update.status).toBe(200);
    const updated = await json<{ entry: { metadata: Record<string, any> } }>(update);
    expect(updated.entry.metadata.sillytavern).toMatchObject({
      selective: true,
      scanDepth: 1,
      rawEntry: { preserved: true },
    });

    const missingSecondary = await app.request(`/api/books/${bookId}/worldbook/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "capture" }),
    });
    const missingJson = await json<{ selected: Array<{ entry: { id: string } }> }>(
      missingSecondary,
    );
    expect(missingJson.selected.map((item) => item.entry.id)).not.toContain(
      created.entry.id,
    );

    const matched = await app.request(`/api/books/${bookId}/worldbook/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "capture status bar" }),
    });
    const matchedJson = await json<{ selected: Array<{ entry: { id: string } }> }>(
      matched,
    );
    expect(matchedJson.selected.map((item) => item.entry.id)).toContain(
      created.entry.id,
    );
  });

  it("legacy worldbook chat endpoint is gone entirely (404, no stub left)", async () => {
    const res = await app.request(`/api/books/${bookId}/worldbook/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Refine the tide city setting." }),
    });

    expect(res.status).toBe(404);
  });});
