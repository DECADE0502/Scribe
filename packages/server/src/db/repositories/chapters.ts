import type { Database } from "better-sqlite3";
import {
  type ChapterAudit,
  type ChapterSummary,
  type ChapterVersion,
  type ChapterVersionSource,
  type AuditIssue,
  type KeyEvent,
  ChapterAuditSchema,
  ChapterSummarySchema,
  ChapterVersionSchema,
} from "@scribe/shared";

function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export interface NewChapterVersionInput {
  chapterNo: number;
  source: ChapterVersionSource;
  contentMd: string;
}

export function createChaptersRepo(db: Database) {
  const rowToSummary = (r: any): ChapterSummary =>
    ChapterSummarySchema.parse({
      chapterNo: r.chapter_no,
      oneLiner: r.one_liner,
      paragraph: r.paragraph,
      keyEvents: parseJson<KeyEvent[]>(r.key_events, []),
      generatedAt: r.generated_at,
      reasoningContent: r.reasoning_content,
    });
  const rowToVersion = (r: any): ChapterVersion =>
    ChapterVersionSchema.parse({
      id: r.id,
      chapterNo: r.chapter_no,
      versionNo: r.version_no,
      source: r.source,
      contentMd: r.content_md,
      createdAt: r.created_at,
    });
  const rowToAudit = (r: any): ChapterAudit =>
    ChapterAuditSchema.parse({
      chapterNo: r.chapter_no,
      verdict: r.verdict,
      issues: parseJson<AuditIssue[]>(r.issues, []),
      auditModel: r.audit_model,
      auditedAt: r.audited_at,
    });

  return {
    // ---- summaries
    saveSummary(s: ChapterSummary): void {
      db.prepare(
        `INSERT INTO chapter_summaries(chapter_no,one_liner,paragraph,key_events,generated_at,reasoning_content)
                  VALUES(?,?,?,?,?,?)
         ON CONFLICT(chapter_no) DO UPDATE SET
            one_liner=excluded.one_liner,
            paragraph=excluded.paragraph,
            key_events=excluded.key_events,
            generated_at=excluded.generated_at,
            reasoning_content=excluded.reasoning_content`
      ).run(
        s.chapterNo,
        s.oneLiner,
        s.paragraph,
        JSON.stringify(s.keyEvents),
        s.generatedAt,
        s.reasoningContent
      );
    },
    getSummary(chapterNo: number): ChapterSummary | undefined {
      const r = db
        .prepare("SELECT * FROM chapter_summaries WHERE chapter_no=?")
        .get(chapterNo);
      return r ? rowToSummary(r) : undefined;
    },
    listSummaries(): ChapterSummary[] {
      return db
        .prepare("SELECT * FROM chapter_summaries ORDER BY chapter_no ASC")
        .all()
        .map(rowToSummary);
    },

    // ---- versions
    saveVersion(input: NewChapterVersionInput): ChapterVersion {
      const row = db
        .prepare(
          "SELECT MAX(version_no) AS max_no FROM chapter_versions WHERE chapter_no=?"
        )
        .get(input.chapterNo) as { max_no: number | null } | undefined;
      const nextVersionNo = (row?.max_no ?? 0) + 1;
      const now = Date.now();
      const result = db
        .prepare(
          `INSERT INTO chapter_versions(chapter_no,version_no,source,content_md,created_at)
                    VALUES(?,?,?,?,?)`
        )
        .run(input.chapterNo, nextVersionNo, input.source, input.contentMd, now);
      const id = Number(result.lastInsertRowid);
      const r = db.prepare("SELECT * FROM chapter_versions WHERE id=?").get(id);
      return rowToVersion(r);
    },
    listVersions(chapterNo: number): ChapterVersion[] {
      return db
        .prepare(
          "SELECT * FROM chapter_versions WHERE chapter_no=? ORDER BY version_no DESC"
        )
        .all(chapterNo)
        .map(rowToVersion);
    },
    getLatestVersion(chapterNo: number): ChapterVersion | undefined {
      const r = db
        .prepare(
          "SELECT * FROM chapter_versions WHERE chapter_no=? ORDER BY version_no DESC LIMIT 1"
        )
        .get(chapterNo);
      return r ? rowToVersion(r) : undefined;
    },

    // ---- audits
    saveAudit(a: ChapterAudit): void {
      db.prepare(
        `INSERT INTO chapter_audits(chapter_no,verdict,issues,audit_model,audited_at)
                  VALUES(?,?,?,?,?)
         ON CONFLICT(chapter_no) DO UPDATE SET
            verdict=excluded.verdict,
            issues=excluded.issues,
            audit_model=excluded.audit_model,
            audited_at=excluded.audited_at`
      ).run(
        a.chapterNo,
        a.verdict,
        JSON.stringify(a.issues),
        a.auditModel,
        a.auditedAt
      );
    },
    getAudit(chapterNo: number): ChapterAudit | undefined {
      const r = db
        .prepare("SELECT * FROM chapter_audits WHERE chapter_no=?")
        .get(chapterNo);
      return r ? rowToAudit(r) : undefined;
    },
  };
}
