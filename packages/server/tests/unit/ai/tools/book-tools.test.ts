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
import { createWorldbookRepo } from "../../../../src/db/repositories/worldbook.js";
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
      worldbookRepo: createWorldbookRepo(db),
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
  it("list_outline returns all outline nodes", async () => {
    outlineRepo.create({
      parentId: null, level: "chapter", title: "第1章",
      summary: "test", status: "planned", sortOrder: 0, metadata: null,
    });

    const result = await exec("list_outline", {});
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].title).toBe("第1章");
  });

  it("get_book_status returns current book state", async () => {
    const result = await exec("get_book_status", {});
    expect(result.chapters).toBe(0);
    expect(result.characters).toBe("无");
  });
});
