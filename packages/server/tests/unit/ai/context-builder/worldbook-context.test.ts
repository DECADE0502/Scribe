import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { openWorkspaceDb } from "../../../../src/db/workspace.js";
import { createBookMetaRepo } from "../../../../src/db/repositories/book-meta.js";
import { createCharactersRepo } from "../../../../src/db/repositories/characters.js";
import { createOutlineRepo } from "../../../../src/db/repositories/outline.js";
import { createForeshadowingRepo } from "../../../../src/db/repositories/foreshadowing.js";
import { createGenreSectionsRepo } from "../../../../src/db/repositories/genre-sections.js";
import { createChaptersRepo } from "../../../../src/db/repositories/chapters.js";
import { createWorldbookRepo } from "../../../../src/db/repositories/worldbook.js";
import { buildChapterWriteMessages } from "../../../../src/ai/context-builder/book-context.js";

const tmpRoots: string[] = [];

function makeHandle() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scribe-worldbook-context-"));
  tmpRoots.push(root);
  const db = openWorkspaceDb(path.join(root, "workspace.db"));
  const bookMetaRepo = createBookMetaRepo(db);
  const chaptersRepo = createChaptersRepo(db);
  const worldbookRepo = createWorldbookRepo(db);

  bookMetaRepo.set("title", "Context Test");
  bookMetaRepo.set("premise", "A cross-genre writing context test.");
  chaptersRepo.saveSummary({
    chapterNo: 1,
    oneLiner: "The crew reaches Glass Harbor.",
    paragraph: "Glass Harbor is unstable because the tide engine failed.",
    keyEvents: [],
    generatedAt: 1,
    reasoningContent: null,
  });

  return {
    db,
    handle: {
      bookId: "context-test",
      bookMetaRepo,
      charactersRepo: createCharactersRepo(db),
      outlineRepo: createOutlineRepo(db),
      foreshadowingRepo: createForeshadowingRepo(db),
      genreSectionsRepo: createGenreSectionsRepo(db),
      chaptersRepo,
      worldbookRepo,
      rulesMdPath: path.join(root, "rules.md"),
    },
  };
}

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("worldbook write context integration", () => {
  it("injects constant and matching triggered entries before drafting", () => {
    const { db, handle } = makeHandle();
    try {
      handle.worldbookRepo.create({
        title: "Narrative contract",
        content: "All chapters must preserve close third person narration.",
        activation: "constant",
        constant: true,
        priority: 100,
      });
      handle.worldbookRepo.create({
        title: "Tide engine",
        content: "When the tide engine appears, mention pressure bells.",
        keys: ["tide engine"],
        priority: 80,
      });
      handle.worldbookRepo.create({
        title: "Mountain monastery",
        content: "This unrelated setting must not be injected.",
        keys: ["monastery"],
        priority: 90,
      });

      const result = buildChapterWriteMessages(
        handle as never,
        2,
        "Continue from Glass Harbor and repair the tide engine.",
      );
      const text = result.messages
        .map((message) => (typeof message.content === "string" ? message.content : ""))
        .join("\n");

      expect(text).toContain("## Worldbook");
      expect(text).toContain("close third person narration");
      expect(text).toContain("pressure bells");
      expect(text).not.toContain("unrelated setting");
      expect(result.diagnostics?.worldbookEntryIds.length).toBeGreaterThanOrEqual(2);
    } finally {
      db.close();
    }
  });
});
