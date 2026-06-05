import Database, { type Database as DatabaseType } from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations, type Migration } from "./migrations/runner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadMigrations(dir: string): Migration[] {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  return files.map((name) => ({
    name,
    sql: fs.readFileSync(path.join(dir, name), "utf8"),
  }));
}

/**
 * 打开 SQLite 数据库,设置默认 PRAGMA(WAL + foreign_keys),并应用 migrations 子目录下的所有迁移。
 * 调用方负责 db.close() 释放资源。若迁移失败,内部会先 close 再抛出,避免文件句柄泄漏。
 */
export function openDbWithMigrations(dbPath: string, migrationsSubdir: string): DatabaseType {
  const db = new Database(dbPath);
  try {
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    const migDir = path.join(__dirname, "migrations", migrationsSubdir);
    runMigrations(db, loadMigrations(migDir));
    return db;
  } catch (err) {
    db.close();
    throw err;
  }
}
