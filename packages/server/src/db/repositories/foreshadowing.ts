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
    /**
     * 回档语义:从 fromChapterNo 起的内容被删时同步伏笔。
     * - planted_chapter >= from:埋设本身在回档范围内 → 整条删除。
     * - planted_chapter < from 但 paid_chapter >= from:伏笔早就埋下(应保留),
     *   只是“回收”发生在被删范围内 → 撤销回收,恢复为 active(不要把有效线索删掉)。
     * 返回实际删除的条数。
     */
    deleteFromChapter(fromChapterNo: number): number {
      const tx = db.transaction(() => {
        const deleted = db
          .prepare("DELETE FROM foreshadowing WHERE planted_chapter >= ?")
          .run(fromChapterNo).changes;
        db.prepare(
          "UPDATE foreshadowing SET status='active', paid_chapter=NULL WHERE planted_chapter < ? AND paid_chapter >= ?"
        ).run(fromChapterNo, fromChapterNo);
        return deleted;
      });
      return tx();
    },
  };
}
