import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { runMigrations } from "../../../../src/db/migrations/runner.js";
import { createOutlineRepo } from "../../../../src/db/repositories/outline.js";
import { createChaptersRepo } from "../../../../src/db/repositories/chapters.js";
import { createCharactersRepo } from "../../../../src/db/repositories/characters.js";
import { createForeshadowingRepo } from "../../../../src/db/repositories/foreshadowing.js";
import { createTimelineRepo } from "../../../../src/db/repositories/timeline.js";
import { createBookMetaRepo } from "../../../../src/db/repositories/book-meta.js";
import { makeBookTools } from "../../../../src/ai/tools/book-tools.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let db: Database.Database;
let tools: ReturnType<typeof makeBookTools>;
let outlineRepo: ReturnType<typeof createOutlineRepo>;

beforeEach(() => {
  db = new Database(":memory:");
  const initSql = fs.readFileSync(
    path.join(__dirname, "../../../../src/db/migrations/workspace/001_init.sql"),
    "utf-8",
  );
  runMigrations(db, [{ name: "001_init.sql", sql: initSql }]);
  outlineRepo = createOutlineRepo(db);
  tools = makeBookTools({
    handle: {
      workspaceDb: db,
      chaptersRepo: createChaptersRepo(db),
      charactersRepo: createCharactersRepo(db),
      outlineRepo,
      foreshadowingRepo: createForeshadowingRepo(db),
      timelineRepo: createTimelineRepo(db),
      bookMetaRepo: createBookMetaRepo(db),
      close: () => db.close(),
    },
  } as any);
});

afterEach(() => {
  try {
    if (db.open) db.close();
  } catch {}
});

async function exec(toolName: string, args: unknown): Promise<any> {
  const t = tools[toolName];
  if (!t?.execute) throw new Error(`tool ${toolName} missing execute`);
  const parsed = t.parameters.parse(args);
  return await t.execute(parsed, { toolCallId: "test", messages: [] } as any);
}

describe("book tools", () => {
  it("add_outline_node treats omitted parentId as a top-level node", async () => {
    const result = await exec("add_outline_node", {
      title: "Chapter 2",
      level: "chapter",
      summary: "The second chapter.",
    });

    expect(result.created).toBe(true);
    expect(result.title).toBe("Chapter 2");
    const node = outlineRepo.listAll().find(n => n.id === result.id);
    expect(node?.parentId).toBeNull();
  });
});
