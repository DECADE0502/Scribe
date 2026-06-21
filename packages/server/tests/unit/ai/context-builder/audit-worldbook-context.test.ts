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
import { createReaderIssuesRepo } from "../../../../src/db/repositories/reader-issues.js";
import { buildChapterAuditContext } from "../../../../src/ai/context-builder/book-context.js";

const roots: string[] = [];

function makeHandle() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scribe-audit-worldbook-"));
  roots.push(root);
  const db = openWorkspaceDb(path.join(root, "workspace.db"));
  const bookMetaRepo = createBookMetaRepo(db);
  const chaptersRepo = createChaptersRepo(db);
  const worldbookRepo = createWorldbookRepo(db);
  const readerIssuesRepo = createReaderIssuesRepo(db);
  bookMetaRepo.set("title", "Audit Context");
  bookMetaRepo.set("premise", "Imported settings should guide audit judgment.");
  chaptersRepo.saveSummary({
    chapterNo: 8,
    oneLiner: "Lin has no pet balls.",
    paragraph: "Lin SP is 3 and has no pet balls available.",
    keyEvents: [],
    generatedAt: 1,
    reasoningContent: null,
  });
  return {
    db,
    handle: {
      bookId: "audit-context",
      bookMetaRepo,
      charactersRepo: createCharactersRepo(db),
      outlineRepo: createOutlineRepo(db),
      foreshadowingRepo: createForeshadowingRepo(db),
      genreSectionsRepo: createGenreSectionsRepo(db),
      chaptersRepo,
      worldbookRepo,
      readerIssuesRepo,
      rulesMdPath: path.join(root, "rules.md"),
    },
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("audit context worldbook and reader issue integration", () => {
  it("passes imported worldbook, open reader issues, and hard facts to audit", () => {
    const { db, handle } = makeHandle();
    try {
      handle.worldbookRepo.create({
        title: "Heaven route",
        content: "Heaven routes are paired with demon rifts and are known to observers.",
        keys: ["Heaven"],
        priority: 90,
      });
      handle.readerIssuesRepo.create({
        chapterNo: 8,
        type: "continuity",
        severity: "warning",
        note: "Pet ball inventory must not change without an explicit cause.",
        status: "open",
      });
      // 创建角色使 dynamicTerms 包含 "SP" 和 "Lin"(动态词表需要角色状态 key)
      handle.charactersRepo.create({
        name: "Lin",
        role: "protagonist",
        baseData: {},
        currentState: { SP: 3 },
      });

      const result = buildChapterAuditContext(
        handle as never,
        9,
        "Continue with Heaven route and pet ball inventory.",
      );

      expect(result.auditCtx.worldbookContext).toContain("Heaven routes are paired");
      expect(result.auditCtx.readerIssuesContext).toContain("Pet ball inventory");
      expect(result.auditCtx.hardContinuityContext).toContain("SP is 3");
    } finally {
      db.close();
    }
  });
});
