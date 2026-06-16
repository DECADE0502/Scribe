import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { openWorkspaceDb } from "../../../../src/db/workspace.js";
import { createWorldbookRepo } from "../../../../src/db/repositories/worldbook.js";

const tmpRoots: string[] = [];

function openRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scribe-worldbook-"));
  tmpRoots.push(root);
  const db = openWorkspaceDb(path.join(root, "workspace.db"));
  return { db, repo: createWorldbookRepo(db) };
}

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("worldbook repository", () => {
  it("creates and lists entries with trigger and recursion settings", () => {
    const { db, repo } = openRepo();
    try {
      const entry = repo.create({
        title: "潮汐能源总则",
        content: "澜川城的潮汐能源系统由潮汐塔统一调度。",
        activation: "triggered",
        keys: ["潮汐塔", "潮汐能源"],
        secondaryKeys: ["澜川"],
        constant: false,
        priority: 80,
        insertionDepth: 1,
        recursive: true,
        recursionLimit: 2,
        tokenBudget: 600,
        category: "world_rule",
        metadata: { source: "test" },
      });

      expect(entry.id).toBeTruthy();
      expect(entry.enabled).toBe(true);
      expect(entry.keys).toEqual(["潮汐塔", "潮汐能源"]);
      expect(entry.recursive).toBe(true);
      expect(entry.metadata).toEqual({ source: "test" });

      const list = repo.list();
      expect(list).toHaveLength(1);
      expect(list[0]!.title).toBe("潮汐能源总则");
    } finally {
      db.close();
    }
  });

  it("updates, disables, and deletes entries", () => {
    const { db, repo } = openRepo();
    try {
      const entry = repo.create({
        title: "旧标题",
        content: "旧内容",
        activation: "constant",
        keys: [],
        secondaryKeys: [],
        constant: true,
        priority: 10,
        insertionDepth: 0,
        recursive: false,
        recursionLimit: 0,
        tokenBudget: null,
        category: "note",
        metadata: {},
      });

      const updated = repo.update(entry.id, {
        title: "新标题",
        enabled: false,
        keys: ["新触发词"],
        priority: 30,
      });

      expect(updated.title).toBe("新标题");
      expect(updated.enabled).toBe(false);
      expect(updated.keys).toEqual(["新触发词"]);
      expect(updated.priority).toBe(30);
      expect(updated.updatedAt).toBeGreaterThanOrEqual(entry.updatedAt);

      repo.delete(entry.id);
      expect(repo.get(entry.id)).toBeUndefined();
      expect(repo.list()).toEqual([]);
    } finally {
      db.close();
    }
  });
});
