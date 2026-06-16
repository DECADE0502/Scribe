import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import {
  type ImportArtifact,
  type ImportReport,
  type ImportSourceType,
  ImportArtifactSchema,
} from "@scribe/shared";
import { parseJsonField } from "../json-utils.js";

export interface NewImportArtifactInput {
  sourceType: ImportSourceType;
  sourceName: string;
  sourceFilename: string;
  rawJson: string;
  rawHash: string;
  importReport: ImportReport;
}

export function createImportArtifactsRepo(db: Database, bookId: string) {
  const rowToArtifact = (r: any): ImportArtifact =>
    ImportArtifactSchema.parse({
      id: r.id,
      bookId: r.book_id,
      sourceType: r.source_type,
      sourceName: r.source_name,
      sourceFilename: r.source_filename,
      rawJson: r.raw_json,
      rawHash: r.raw_hash,
      importReport: parseJsonField<ImportReport>(r.import_report_json, {
        warnings: [],
        stats: {},
      }),
      importedAt: r.imported_at,
    });

  return {
    create(input: NewImportArtifactInput): ImportArtifact {
      const id = randomUUID();
      const now = Date.now();
      db.prepare(
        `INSERT INTO import_artifacts(
          id,book_id,source_type,source_name,source_filename,raw_json,
          raw_hash,import_report_json,imported_at
        ) VALUES(?,?,?,?,?,?,?,?,?)`,
      ).run(
        id,
        bookId,
        input.sourceType,
        input.sourceName,
        input.sourceFilename,
        input.rawJson,
        input.rawHash,
        JSON.stringify(input.importReport),
        now,
      );
      return this.get(id)!;
    },

    get(id: string): ImportArtifact | undefined {
      const row = db
        .prepare("SELECT * FROM import_artifacts WHERE id=? AND book_id=?")
        .get(id, bookId);
      return row ? rowToArtifact(row) : undefined;
    },

    list(): ImportArtifact[] {
      return db
        .prepare(
          "SELECT * FROM import_artifacts WHERE book_id=? ORDER BY imported_at DESC",
        )
        .all(bookId)
        .map(rowToArtifact);
    },
  };
}
