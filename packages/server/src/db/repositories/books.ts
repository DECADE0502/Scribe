import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import { type Book, type NewBookInput, BookSchema } from "@scribe/shared";

export function createBooksRepo(db: Database) {
  const rowToBook = (r: any): Book =>
    BookSchema.parse({
      id: r.id,
      title: r.title,
      genre: r.genre,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      totalCostUsd: r.total_cost_usd,
    });
  return {
    create(input: NewBookInput): Book {
      const id = randomUUID();
      const now = Date.now();
      db.prepare(
        `INSERT INTO books(id,title,genre,created_at,updated_at,total_cost_usd)
                  VALUES(?,?,?,?,?,0)`
      ).run(id, input.title, input.genre ?? null, now, now);
      return this.get(id)!;
    },
    get(id: string): Book | undefined {
      const r = db.prepare("SELECT * FROM books WHERE id=?").get(id);
      return r ? rowToBook(r) : undefined;
    },
    list(): Book[] {
      return db
        .prepare("SELECT * FROM books ORDER BY updated_at DESC")
        .all()
        .map(rowToBook);
    },
    rename(id: string, title: string): Book {
      db.prepare("UPDATE books SET title=?, updated_at=? WHERE id=?").run(
        title,
        Date.now(),
        id
      );
      return this.get(id)!;
    },
    delete(id: string): void {
      db.prepare("DELETE FROM books WHERE id=?").run(id);
    },
    addCost(id: string, deltaUsd: number): void {
      db.prepare(
        "UPDATE books SET total_cost_usd = total_cost_usd + ?, updated_at=? WHERE id=?"
      ).run(deltaUsd, Date.now(), id);
    },
  };
}
