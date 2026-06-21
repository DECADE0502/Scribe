import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { runMigrations } from "../../../../src/db/migrations/runner.js";
import { createCharactersRepo } from "../../../../src/db/repositories/characters.js";
import { createForeshadowingRepo } from "../../../../src/db/repositories/foreshadowing.js";
import { createTimelineRepo } from "../../../../src/db/repositories/timeline.js";
import { makeStateTools } from "../../../../src/ai/tools/state-tools.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let db: any;
let charactersRepo: ReturnType<typeof createCharactersRepo>;
let foreshadowingRepo: ReturnType<typeof createForeshadowingRepo>;
let timelineRepo: ReturnType<typeof createTimelineRepo>;
let tools: ReturnType<typeof makeStateTools>;

beforeEach(() => {
  db = new Database(":memory:");
  const initSql = fs.readFileSync(
    path.join(__dirname, "../../../../src/db/migrations/workspace/001_init.sql"),
    "utf-8",
  );
  runMigrations(db, [{ name: "001_init.sql", sql: initSql }]);
  charactersRepo = createCharactersRepo(db);
  foreshadowingRepo = createForeshadowingRepo(db);
  timelineRepo = createTimelineRepo(db);
  charactersRepo.create({ name: "Lin", role: "protagonist", baseData: {}, currentState: {} });
  tools = makeStateTools({ charactersRepo, foreshadowingRepo, timelineRepo, chapterNo: 5 });
});

afterEach(() => {
  db.close();
});

async function exec(toolName: string, args: Record<string, unknown>): Promise<any> {
  const t = tools[toolName];
  if (!t) throw new Error(`missing tool: ${toolName}`);
  const parsed = t.parameters.parse(args);
  if (!t.execute) throw new Error(`tool is not executable: ${toolName}`);
  return await t.execute(parsed, { toolCallId: "test", messages: [] } as any);
}

describe("state tools dedupe", () => {
  it("skips a duplicate character appearance for the same chapter and character", async () => {
    await exec("add_character_appearance", { name: "Lin", brief: "first brief" });
    const result = await exec("add_character_appearance", { name: "Lin", brief: "second brief" });

    const lin = charactersRepo.list().find(character => character.name === "Lin");
    expect(result.skipped).toBeTruthy();
    expect(lin?.appearances).toHaveLength(1);
    expect(lin?.appearances[0]?.brief).toBe("first brief");
  });

  it("skips a duplicate foreshadowing label after normalizing whitespace", async () => {
    await exec("add_foreshadowing", { label: " red umbrella " });
    const result = await exec("add_foreshadowing", { label: "red umbrella" });

    expect(result.skipped).toBeTruthy();
    expect(foreshadowingRepo.list()).toHaveLength(1);
    expect(foreshadowingRepo.list()[0]?.label).toBe("red umbrella");
  });

  it("skips a duplicate timeline event in the same chapter", async () => {
    await exec("add_timeline_event", { storyTime: "night", event: " Lin leaves ", participants: ["Lin"] });
    const result = await exec("add_timeline_event", { storyTime: "night", event: "Lin leaves", participants: ["Lin"] });

    expect(result.skipped).toBeTruthy();
    expect(timelineRepo.listAll()).toHaveLength(1);
    expect(timelineRepo.listAll()[0]?.event).toBe("Lin leaves");
  });
});
