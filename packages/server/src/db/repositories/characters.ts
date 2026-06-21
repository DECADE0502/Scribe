import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import {
  type Character,
  type CharacterAppearance,
  type NewCharacterInput,
  CharacterSchema,
} from "@scribe/shared";
import { parseJsonArray, parseJsonField } from "../json-utils.js";

export function createCharactersRepo(db: Database) {
  const rowToCharacter = (r: any): Character =>
    CharacterSchema.parse({
      id: r.id,
      name: r.name,
      role: r.role,
      baseData: parseJsonField<Record<string, unknown>>(r.base_data, {}),
      currentState: parseJsonField<Record<string, unknown>>(r.current_state, {}),
      appearances: parseJsonArray<CharacterAppearance>(r.appearances),
      updatedAt: r.updated_at,
    });

  return {
    create(input: NewCharacterInput): Character {
      const id = randomUUID();
      const now = Date.now();
      db.prepare(
        `INSERT INTO characters(id,name,role,base_data,current_state,appearances,updated_at)
                  VALUES(?,?,?,?,?,?,?)`
      ).run(
        id,
        input.name,
        input.role ?? null,
        JSON.stringify(input.baseData ?? {}),
        JSON.stringify(input.currentState ?? {}),
        JSON.stringify([]),
        now
      );
      return this.get(id)!;
    },
    get(id: string): Character | undefined {
      const r = db.prepare("SELECT * FROM characters WHERE id=?").get(id);
      return r ? rowToCharacter(r) : undefined;
    },
    list(): Character[] {
      return db
        .prepare("SELECT * FROM characters ORDER BY updated_at DESC")
        .all()
        .map(rowToCharacter);
    },
    update(id: string, patch: Partial<Character>): Character {
      const current = this.get(id);
      if (!current) throw new Error(`character ${id} not found`);
      const next: Character = {
        ...current,
        ...patch,
        id: current.id,
        updatedAt: Date.now(),
      };
      db.prepare(
        `UPDATE characters
            SET name=?, role=?, base_data=?, current_state=?, appearances=?, updated_at=?
          WHERE id=?`
      ).run(
        next.name,
        next.role,
        JSON.stringify(next.baseData),
        JSON.stringify(next.currentState),
        JSON.stringify(next.appearances),
        next.updatedAt,
        id
      );
      return this.get(id)!;
    },
    delete(id: string): void {
      db.prepare("DELETE FROM characters WHERE id=?").run(id);
    },
    addAppearance(id: string, appearance: CharacterAppearance): Character {
      const current = this.get(id);
      if (!current) throw new Error(`character ${id} not found`);
      const next = [...current.appearances, appearance];
      const now = Date.now();
      db.prepare("UPDATE characters SET appearances=?, updated_at=? WHERE id=?").run(
        JSON.stringify(next),
        now,
        id
      );
      return this.get(id)!;
    },
    /** 从所有角色的 appearances 数组里移除 chapterNo >= fromChapterNo 的元素（回档语义） */
    removeAppearancesFromChapter(fromChapterNo: number): number {
      const all = this.list();
      let touched = 0;
      const now = Date.now();
      for (const c of all) {
        const filtered = c.appearances.filter((a) => a.chapterNo < fromChapterNo);
        if (filtered.length !== c.appearances.length) {
          db.prepare("UPDATE characters SET appearances=?, updated_at=? WHERE id=?").run(
            JSON.stringify(filtered),
            now,
            c.id
          );
          touched++;
        }
      }
      return touched;
    },
  };
}
