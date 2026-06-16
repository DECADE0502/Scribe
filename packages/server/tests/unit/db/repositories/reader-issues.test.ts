import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { openWorkspaceDb } from "../../../../src/db/workspace.js";
import { createReaderIssuesRepo } from "../../../../src/db/repositories/reader-issues.js";

const roots: string[] = [];

function openRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scribe-reader-issues-"));
  roots.push(root);
  const db = openWorkspaceDb(path.join(root, "workspace.db"));
  return { db, repo: createReaderIssuesRepo(db) };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("reader issues repository", () => {
  it("creates open issues and updates their status", () => {
    const { db, repo } = openRepo();
    try {
      const issue = repo.create({
        chapterNo: 4,
        type: "continuity",
        severity: "warning",
        note: "A character disappears without explanation.",
        evidence: "Chapter 3 says he joins the team.",
        suggestedAction: "Explain the absence before moving on.",
        status: "open",
      });

      expect(repo.listOpen()).toHaveLength(1);
      repo.update(issue.id, { status: "resolved" });
      expect(repo.listOpen()).toEqual([]);
      expect(repo.listAll()[0]!.status).toBe("resolved");
    } finally {
      db.close();
    }
  });
});
