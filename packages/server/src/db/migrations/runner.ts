import type { Database } from "better-sqlite3";

export interface Migration {
  name: string;
  sql: string;
}

/**
 * 按文件名的数字前缀排序(001_init < 0008 < 0009)。
 * 不能用纯字典序 / localeCompare —— 那会把 "001_init" 排到 "0008"/"0009" 之后,
 * 导致基础表(在 001_init 里)最后才建,任何引用它的后续迁移在全新库上必崩。
 */
export function compareMigrations(a: { name: string }, b: { name: string }): number {
  const na = parseInt(a.name, 10);
  const nb = parseInt(b.name, 10);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a.name.localeCompare(b.name);
}

export function runMigrations(db: Database, migrations: Migration[]): void {
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`);
  const sorted = [...migrations].sort(compareMigrations);
  for (const m of sorted) {
    const row = db.prepare("SELECT 1 FROM _migrations WHERE name=?").get(m.name);
    if (row) continue;
    const tx = db.transaction(() => {
      db.exec(m.sql);
      db.prepare("INSERT INTO _migrations(name, applied_at) VALUES(?, ?)").run(m.name, Date.now());
    });
    tx();
  }
}
