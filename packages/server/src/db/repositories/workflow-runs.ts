import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";

export interface WorkflowRun {
  id: string;
  bookId: string;
  source: string;
  phase: string;
  verdict: string | null;
  createdAt: number;
  updatedAt: number;
}

export function createWorkflowRunsRepo(db: Database) {
  const rowToRun = (r: any): WorkflowRun => ({
    id: r.id,
    bookId: r.book_id,
    source: r.source,
    phase: r.phase,
    verdict: r.verdict ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });

  return {
    create(bookId: string, source: string, id: string = randomUUID()): WorkflowRun {
      const now = Date.now();
      db.prepare(
        `INSERT INTO workflow_runs(id,book_id,source,phase,created_at,updated_at) VALUES(?,?,?,?,?,?)`,
      ).run(id, bookId, source, "thinking", now, now);
      return this.get(id)!;
    },
    get(id: string): WorkflowRun | undefined {
      const r = db.prepare("SELECT * FROM workflow_runs WHERE id=?").get(id);
      return r ? rowToRun(r) : undefined;
    },
    setPhase(id: string, phase: string, verdict?: string): void {
      const now = Date.now();
      db.prepare("UPDATE workflow_runs SET phase=?,verdict=?,updated_at=? WHERE id=?")
        .run(phase, verdict ?? null, now, id);
    },
    getLatestByBook(bookId: string): WorkflowRun | undefined {
      const r = db.prepare(
        "SELECT * FROM workflow_runs WHERE book_id=? ORDER BY updated_at DESC LIMIT 1",
      ).get(bookId);
      return r ? rowToRun(r) : undefined;
    },
    getLatestWaitingUser(bookId: string): WorkflowRun | undefined {
      const r = db.prepare(
        "SELECT * FROM workflow_runs WHERE book_id=? AND phase='waiting_user' ORDER BY updated_at DESC LIMIT 1",
      ).get(bookId);
      return r ? rowToRun(r) : undefined;
    },
    delete(id: string): void {
      db.prepare("DELETE FROM workflow_runs WHERE id=?").run(id);
    },

    addChange(runId: string, change: { id: string; type: string; payload: unknown; sortOrder: number }): void {
      const now = Date.now();
      db.prepare(
        `INSERT INTO workflow_staged_changes(id,run_id,type,payload,committed,sort_order,created_at) VALUES(?,?,?,?,0,?,?)`,
      ).run(change.id, runId, change.type, JSON.stringify(change.payload), change.sortOrder, now);
    },
    listChanges(runId: string): Array<{ id: string; type: string; payload: unknown; committed: boolean; sortOrder: number }> {
      return (db.prepare(
        "SELECT * FROM workflow_staged_changes WHERE run_id=? ORDER BY sort_order ASC",
      ).all(runId) as any[]).map((r) => ({
        id: r.id,
        type: r.type,
        payload: JSON.parse(r.payload),
        committed: r.committed === 1,
        sortOrder: r.sort_order,
      }));
    },
    markChangeCommitted(id: string): void {
      db.prepare("UPDATE workflow_staged_changes SET committed=1 WHERE id=?").run(id);
    },
    deleteChanges(runId: string): void {
      db.prepare("DELETE FROM workflow_staged_changes WHERE run_id=? AND committed=0").run(runId);
    },
  };
}
