import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import {
  type OutlineNode,
  type NewOutlineNode,
  OutlineNodeSchema,
} from "@scribe/shared";
import { parseNullableObject } from "../json-utils.js";

export function createOutlineRepo(db: Database) {
  const rowToNode = (r: any): OutlineNode =>
    OutlineNodeSchema.parse({
      id: r.id,
      parentId: r.parent_id,
      level: r.level,
      title: r.title,
      summary: r.summary,
      status: r.status,
      sortOrder: r.sort_order,
      metadata: parseNullableObject(r.metadata),
    });

  return {
    create(input: NewOutlineNode): OutlineNode {
      const id = randomUUID();
      db.prepare(
        `INSERT INTO outline_nodes(id,parent_id,level,title,summary,status,sort_order,metadata)
                  VALUES(?,?,?,?,?,?,?,?)`
      ).run(
        id,
        input.parentId,
        input.level,
        input.title,
        input.summary,
        input.status,
        input.sortOrder,
        input.metadata === null ? null : JSON.stringify(input.metadata)
      );
      return this.get(id)!;
    },
    get(id: string): OutlineNode | undefined {
      const r = db.prepare("SELECT * FROM outline_nodes WHERE id=?").get(id);
      return r ? rowToNode(r) : undefined;
    },
    listChildren(parentId: string | null): OutlineNode[] {
      const sql =
        parentId === null
          ? "SELECT * FROM outline_nodes WHERE parent_id IS NULL ORDER BY sort_order ASC"
          : "SELECT * FROM outline_nodes WHERE parent_id=? ORDER BY sort_order ASC";
      const rows = parentId === null ? db.prepare(sql).all() : db.prepare(sql).all(parentId);
      return rows.map(rowToNode);
    },
    listAll(): OutlineNode[] {
      return db
        .prepare("SELECT * FROM outline_nodes ORDER BY sort_order ASC")
        .all()
        .map(rowToNode);
    },
    update(id: string, patch: Partial<OutlineNode>): OutlineNode {
      const current = this.get(id);
      if (!current) throw new Error(`outline node ${id} not found`);
      const next: OutlineNode = { ...current, ...patch, id: current.id };
      db.prepare(
        `UPDATE outline_nodes
            SET parent_id=?, level=?, title=?, summary=?, status=?, sort_order=?, metadata=?
          WHERE id=?`
      ).run(
        next.parentId,
        next.level,
        next.title,
        next.summary,
        next.status,
        next.sortOrder,
        next.metadata === null ? null : JSON.stringify(next.metadata),
        id
      );
      return this.get(id)!;
    },
    delete(id: string): void {
      db.prepare("DELETE FROM outline_nodes WHERE id=?").run(id);
    },
    reorder(parentId: string | null, ids: string[]): void {
      const stmt = db.prepare(
        "UPDATE outline_nodes SET sort_order=? WHERE id=? AND " +
          (parentId === null ? "parent_id IS NULL" : "parent_id=?")
      );
      const tx = db.transaction(() => {
        ids.forEach((id, idx) => {
          if (parentId === null) stmt.run(idx, id);
          else stmt.run(idx, id, parentId);
        });
      });
      tx();
    },
    updateSummary(id: string, summary: string | null): void {
      db.prepare("UPDATE outline_nodes SET summary=? WHERE id=?").run(summary, id);
    },
    findChapterNode(chapterNo: number): OutlineNode | undefined {
      const r = db.prepare(
        `SELECT * FROM outline_nodes
          WHERE level='chapter'
            AND CAST(json_extract(metadata,'$.chapterNo') AS INTEGER) = ?
          LIMIT 1`
      ).get(chapterNo);
      return r ? rowToNode(r) : undefined;
    },
    clearAncestorSummaries(nodeId: string): void {
      const node = this.get(nodeId);
      if (!node) return;
      this.clearAncestorSummariesByParentId(node.parentId);
    },
    clearAncestorSummariesByParentId(parentId: string | null): void {
      if (!parentId) return;
      const update = db.prepare("UPDATE outline_nodes SET summary=NULL WHERE id=?");
      const select = db.prepare("SELECT parent_id FROM outline_nodes WHERE id=?");
      const tx = db.transaction(() => {
        let curId: string | null = parentId;
        while (curId) {
          update.run(curId);
          const r = select.get(curId) as { parent_id?: string } | undefined;
          curId = r?.parent_id ?? null;
        }
      });
      tx();
    },
  };
}
