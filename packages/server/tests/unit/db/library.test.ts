import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { openLibraryDb } from "../../../src/db/library.js";

let tmpDir: string, dbPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "scribe-lib-test-"));
  dbPath = path.join(tmpDir, "library.db");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("openLibraryDb 集成", () => {
  it("打开新 DB 后 books 表已建好", () => {
    const db = openLibraryDb(dbPath);
    try {
      const row = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='books'"
        )
        .get();
      expect(row).toBeTruthy();
    } finally {
      db.close();
    }
  });

  it("PRAGMA journal_mode 是 wal", () => {
    const db = openLibraryDb(dbPath);
    try {
      const r = db.prepare("PRAGMA journal_mode").get() as any;
      expect(String(r.journal_mode).toLowerCase()).toBe("wal");
    } finally {
      db.close();
    }
  });

  it("PRAGMA foreign_keys 是 1", () => {
    const db = openLibraryDb(dbPath);
    try {
      const r = db.prepare("PRAGMA foreign_keys").get() as any;
      expect(r.foreign_keys).toBe(1);
    } finally {
      db.close();
    }
  });
});
