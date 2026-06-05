import type { Database } from "better-sqlite3";

export interface Migration {
  name: string;
  sql: string;
}

export function runMigrations(db: Database, migrations: Migration[]): void {
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`);
  const sorted = [...migrations].sort((a, b) => a.name.localeCompare(b.name));
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
