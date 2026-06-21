import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import {
  type Foreshadowing,
  type ForeshadowingStatus,
  type NewForeshadowing,
  ForeshadowingSchema,
} from "@scribe/shared";
import { parseJsonArray } from "../json-utils.js";

export function createForeshadowingRepo(db: Database) {
  const rowToForeshadowing = (r: any): Foreshadowing =>
    ForeshadowingSchema.parse({
      id: r.id,
      label: r.label,
      description: r.description,
      plantedChapter: r.planted_chapter,
      paidChapter: r.paid_chapter,
      status: r.status,
      relatedCharacters: parseJsonArray<string>(r.related_characters),
    });

  return {
    create(input: NewForeshadowing): Foreshadowing {
      const id = randomUUID();
      db.prepare(
        `INSERT INTO foreshadowing(id,label,description,planted_chapter,paid_chapter,status,related_characters)
                  VALUES(?,?,?,?,?,?,?)`
      ).run(
        id,
        input.label,
        input.description,
        input.plantedChapter,
        input.paidChapter,
        input.status,
        JSON.stringify(input.relatedCharacters)
      );
      return this.get(id)!;
    },
    get(id: string): Foreshadowing | undefined {
      const r = db.prepare("SELECT * FROM foreshadowing WHERE id=?").get(id);
      return r ? rowToForeshadowing(r) : undefined;
    },
    list(filterStatus?: ForeshadowingStatus): Foreshadowing[] {
      const rows = filterStatus
        ? db.prepare("SELECT * FROM foreshadowing WHERE status=?").all(filterStatus)
        : db.prepare("SELECT * FROM foreshadowing").all();
      return rows.map(rowToForeshadowing);
    },
    update(id: string, patch: Partial<Foreshadowing>): Foreshadowing {
      const current = this.get(id);
      if (!current) throw new Error(`foreshadowing ${id} not found`);
      const next: Foreshadowing = { ...current, ...patch, id: current.id };
      db.prepare(
        `UPDATE foreshadowing
            SET label=?, description=?, planted_chapter=?, paid_chapter=?, status=?, related_characters=?
          WHERE id=?`
      ).run(
        next.label,
        next.description,
        next.plantedChapter,
        next.paidChapter,
        next.status,
        JSON.stringify(next.relatedCharacters),
        id
      );
      return this.get(id)!;
    },
    delete(id: string): void {
      db.prepare("DELETE FROM foreshadowing WHERE id=?").run(id);
    },
    pay(id: string, paidChapter: number): Foreshadowing {
      db.prepare(
        "UPDATE foreshadowing SET status='paid', paid_chapter=? WHERE id=?"
      ).run(paidChapter, id);
      return this.get(id)!;
    },
    /** 删 planted_chapter 或 paid_chapter >= fromChapterNo 的伏笔（回档语义） */
    deleteFromChapter(fromChapterNo: number): number {
      return db
        .prepare("DELETE FROM foreshadowing WHERE planted_chapter >= ? OR paid_chapter >= ?")
        .run(fromChapterNo, fromChapterNo).changes;
    },
  };
}
