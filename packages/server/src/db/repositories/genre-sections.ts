import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import {
  type GenreField,
  type GenreSection,
  type GenreSectionItem,
  GenreSectionSchema,
  GenreSectionItemSchema,
} from "@scribe/shared";
import { parseJsonArray, parseJsonField } from "../json-utils.js";

export interface NewGenreSectionInput {
  name: string;
  schema: GenreField[];
  createdBy: "ai" | "user";
}

export function createGenreSectionsRepo(db: Database) {
  const rowToSection = (r: any): GenreSection =>
    GenreSectionSchema.parse({
      id: r.id,
      name: r.name,
      schema: parseJsonArray<GenreField>(r.schema),
      createdBy: r.created_by,
      createdAt: r.created_at,
    });
  const rowToItem = (r: any): GenreSectionItem =>
    GenreSectionItemSchema.parse({
      id: r.id,
      sectionId: r.section_id,
      data: parseJsonField<Record<string, unknown>>(r.data, {}),
      updatedAt: r.updated_at,
    });

  return {
    createSection(input: NewGenreSectionInput): GenreSection {
      const id = randomUUID();
      const now = Date.now();
      db.prepare(
        `INSERT INTO genre_sections(id,name,schema,created_by,created_at)
                  VALUES(?,?,?,?,?)`
      ).run(id, input.name, JSON.stringify(input.schema), input.createdBy, now);
      return this.getSection(id)!;
    },
    getSection(id: string): GenreSection | undefined {
      const r = db.prepare("SELECT * FROM genre_sections WHERE id=?").get(id);
      return r ? rowToSection(r) : undefined;
    },
    listSections(): GenreSection[] {
      return db
        .prepare("SELECT * FROM genre_sections ORDER BY created_at ASC")
        .all()
        .map(rowToSection);
    },
    updateSectionSchema(id: string, schema: GenreField[]): GenreSection {
      db.prepare("UPDATE genre_sections SET schema=? WHERE id=?").run(
        JSON.stringify(schema),
        id
      );
      return this.getSection(id)!;
    },
    deleteSection(id: string): void {
      const tx = db.transaction(() => {
        db.prepare("DELETE FROM genre_section_items WHERE section_id=?").run(id);
        db.prepare("DELETE FROM genre_sections WHERE id=?").run(id);
      });
      tx();
    },
    addItem(sectionId: string, data: Record<string, unknown>): GenreSectionItem {
      const id = randomUUID();
      const now = Date.now();
      db.prepare(
        `INSERT INTO genre_section_items(id,section_id,data,updated_at)
                  VALUES(?,?,?,?)`
      ).run(id, sectionId, JSON.stringify(data), now);
      return this.getItem(id)!;
    },
    getItem(itemId: string): GenreSectionItem | undefined {
      const r = db.prepare("SELECT * FROM genre_section_items WHERE id=?").get(itemId);
      return r ? rowToItem(r) : undefined;
    },
    listItems(sectionId: string): GenreSectionItem[] {
      return db
        .prepare(
          "SELECT * FROM genre_section_items WHERE section_id=? ORDER BY updated_at ASC"
        )
        .all(sectionId)
        .map(rowToItem);
    },
    updateItem(itemId: string, data: Record<string, unknown>): GenreSectionItem {
      const now = Date.now();
      db.prepare(
        "UPDATE genre_section_items SET data=?, updated_at=? WHERE id=?"
      ).run(JSON.stringify(data), now, itemId);
      return this.getItem(itemId)!;
    },
    deleteItem(itemId: string): void {
      db.prepare("DELETE FROM genre_section_items WHERE id=?").run(itemId);
    },
  };
}
