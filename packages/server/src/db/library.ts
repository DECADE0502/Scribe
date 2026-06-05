import Database, { type Database as DatabaseType } from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations, type Migration } from "./migrations/runner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadMigrations(dir: string): Migration[] {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  return files.map((name) => ({
    name,
    sql: fs.readFileSync(path.join(dir, name), "utf8"),
  }));
}

export function openLibraryDb(dbPath: string): DatabaseType {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const migDir = path.join(__dirname, "migrations", "library");
  runMigrations(db, loadMigrations(migDir));
  return db;
}
