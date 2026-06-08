import type { Database } from "better-sqlite3";

export function createBookMetaRepo(db: Database) {
  return {
    get(key: string): string | undefined {
      const row = db
        .prepare("SELECT value FROM book_meta WHERE key=?")
        .get(key) as { value: string } | undefined;
      return row?.value;
    },
    set(key: string, value: string): void {
      db.prepare(
        "INSERT OR REPLACE INTO book_meta(key, value) VALUES(?, ?)"
      ).run(key, value);
    },
    list(): { key: string; value: string }[] {
      return db
        .prepare("SELECT key, value FROM book_meta")
        .all() as { key: string; value: string }[];
    },
  };
}
