import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import {
  type GenreField,
  type GenreSection,
  type GenreSectionItem,
  GenreSectionSchema,
  GenreSectionItemSchema,
  resolveItemIdentityKey,
} from "@scribe/shared";
import { parseJsonField } from "../json-utils.js";

export interface NewGenreSectionInput {
  name: string;
  schema: GenreField[];
  identityFields?: string[];
  displayFields?: string[];
  searchFields?: string[];
  createdBy: "ai" | "user";
}

export function createGenreSectionsRepo(db: Database) {
  const rowToSection = (r: any): GenreSection => {
    const rawSchema = parseJsonField<unknown>(r.schema, []);
    const fields = Array.isArray(rawSchema)
      ? rawSchema
      : Array.isArray((rawSchema as any)?.fields)
        ? (rawSchema as any).fields
        : [];
    const meta = !Array.isArray(rawSchema) && rawSchema && typeof rawSchema === "object"
      ? (rawSchema as {
          identityFields?: string[];
          displayFields?: string[];
          searchFields?: string[];
        })
      : {};
    return GenreSectionSchema.parse({
      id: r.id,
      name: r.name,
      schema: fields,
      identityFields: meta.identityFields,
      displayFields: meta.displayFields,
      searchFields: meta.searchFields,
      createdBy: r.created_by,
      createdAt: r.created_at,
    });
  };
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
      const schemaPayload = input.schema;
      db.prepare(
        `INSERT INTO genre_sections(id,name,schema,created_by,created_at)
                  VALUES(?,?,?,?,?)`
      ).run(
        id,
        input.name,
        JSON.stringify({
          fields: schemaPayload,
          identityFields: input.identityFields,
          displayFields: input.displayFields,
          searchFields: input.searchFields,
        }),
        input.createdBy,
        now,
      );
      return this.getSection(id)!;
    },
    getSection(id: string): GenreSection | undefined {
      const r = db.prepare("SELECT * FROM genre_sections WHERE id=?").get(id);
      return r ? rowToSection(r) : undefined;
    },
    getByName(name: string): GenreSection | undefined {
      const r = db
        .prepare("SELECT * FROM genre_sections WHERE name=?")
        .get(name);
      return r ? rowToSection(r) : undefined;
    },
    listSections(): GenreSection[] {
      return db
        .prepare("SELECT * FROM genre_sections ORDER BY created_at ASC")
        .all()
        .map(rowToSection);
    },
    updateSectionSchema(
      id: string,
      schema: GenreField[],
      metadata?: {
        identityFields?: string[];
        displayFields?: string[];
        searchFields?: string[];
      },
    ): GenreSection {
      const current = this.getSection(id);
      db.prepare("UPDATE genre_sections SET schema=? WHERE id=?").run(
        JSON.stringify({
          fields: schema,
          identityFields: metadata?.identityFields ?? current?.identityFields,
          displayFields: metadata?.displayFields ?? current?.displayFields,
          searchFields: metadata?.searchFields ?? current?.searchFields,
        }),
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
    findItemByIdentity(
      section: GenreSection,
      data: Record<string, unknown>,
    ): GenreSectionItem | undefined {
      const targetKey = resolveItemIdentityKey(section, data);
      if (!targetKey) return undefined;
      return this.listItems(section.id).find(
        (item) => resolveItemIdentityKey(section, item.data) === targetKey,
      );
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
