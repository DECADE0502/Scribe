import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import {
  type ReaderIssue,
  type ReaderIssueStatus,
  type ReaderIssueType,
  ReaderIssueSchema,
} from "@scribe/shared";

export interface NewReaderIssueInput {
  chapterNo: number;
  type: ReaderIssueType;
  severity: "warning" | "critical";
  note: string;
  evidence?: string | null;
  suggestedAction?: string | null;
  status?: ReaderIssueStatus;
}

export interface ReaderIssuePatch {
  chapterNo?: number;
  type?: ReaderIssueType;
  severity?: "warning" | "critical";
  note?: string;
  evidence?: string | null;
  suggestedAction?: string | null;
  status?: ReaderIssueStatus;
}

export function createReaderIssuesRepo(db: Database) {
  const rowToIssue = (r: any): ReaderIssue =>
    ReaderIssueSchema.parse({
      id: r.id,
      chapterNo: r.chapter_no,
      type: r.type,
      severity: r.severity,
      note: r.note,
      evidence: r.evidence ?? null,
      suggestedAction: r.suggested_action ?? null,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    });

  return {
    create(input: NewReaderIssueInput): ReaderIssue {
      const id = randomUUID();
      const now = Date.now();
      db.prepare(
        `INSERT INTO reader_issues(
          id,chapter_no,type,severity,note,evidence,suggested_action,
          status,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        id,
        input.chapterNo,
        input.type,
        input.severity,
        input.note,
        input.evidence ?? null,
        input.suggestedAction ?? null,
        input.status ?? "open",
        now,
        now,
      );
      return this.get(id)!;
    },

    get(id: string): ReaderIssue | undefined {
      const row = db.prepare("SELECT * FROM reader_issues WHERE id=?").get(id);
      return row ? rowToIssue(row) : undefined;
    },

    listAll(): ReaderIssue[] {
      return db
        .prepare("SELECT * FROM reader_issues ORDER BY chapter_no ASC, created_at ASC")
        .all()
        .map(rowToIssue);
    },

    listOpen(): ReaderIssue[] {
      return db
        .prepare(
          `SELECT * FROM reader_issues
           WHERE status IN ('open','injected','deferred')
           ORDER BY chapter_no ASC, created_at ASC`,
        )
        .all()
        .map(rowToIssue);
    },

    update(id: string, patch: ReaderIssuePatch): ReaderIssue {
      const current = this.get(id);
      if (!current) {
        throw new Error(`Reader issue not found: ${id}`);
      }
      const merged = { ...current, ...patch };
      const now = Date.now();
      db.prepare(
        `UPDATE reader_issues SET
          chapter_no=?, type=?, severity=?, note=?, evidence=?,
          suggested_action=?, status=?, updated_at=?
        WHERE id=?`,
      ).run(
        merged.chapterNo,
        merged.type,
        merged.severity,
        merged.note,
        merged.evidence,
        merged.suggestedAction,
        merged.status,
        now,
        id,
      );
      return this.get(id)!;
    },
  };
}
