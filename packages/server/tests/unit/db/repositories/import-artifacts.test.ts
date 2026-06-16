import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { openWorkspaceDb } from "../../../../src/db/workspace.js";
import { createImportArtifactsRepo } from "../../../../src/db/repositories/import-artifacts.js";

const roots: string[] = [];

function openRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scribe-import-artifacts-"));
  roots.push(root);
  const db = openWorkspaceDb(path.join(root, "workspace.db"));
  return { db, repo: createImportArtifactsRepo(db, "book-1") };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("import artifacts repository", () => {
  it("creates and lists raw import artifacts", () => {
    const { db, repo } = openRepo();
    try {
      const artifact = repo.create({
        sourceType: "sillytavern_preset",
        sourceName: "Izumi 0503",
        sourceFilename: "Izumi 0503.json",
        rawJson: "{\"prompts\":[]}",
        rawHash: "abc",
        importReport: { warnings: [], stats: { promptCount: 0 } },
      });

      expect(artifact.bookId).toBe("book-1");
      expect(artifact.importReport.stats.promptCount).toBe(0);
      expect(repo.list()).toHaveLength(1);
      expect(repo.get(artifact.id)?.rawJson).toContain("prompts");
    } finally {
      db.close();
    }
  });
});
