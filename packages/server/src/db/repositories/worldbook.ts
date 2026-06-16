import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import {
  type NewWorldbookEntryInput,
  NewWorldbookEntryInputSchema,
  type WorldbookEntry,
  WorldbookEntryPatchSchema,
  WorldbookEntrySchema,
} from "@scribe/shared";
import { parseJsonField } from "../json-utils.js";

export function createWorldbookRepo(db: Database) {
  const rowToEntry = (r: any): WorldbookEntry =>
    WorldbookEntrySchema.parse({
      id: r.id,
      title: r.title,
      content: r.content,
      enabled: Boolean(r.enabled),
      activation: r.activation,
      keys: parseJsonField<string[]>(r.keys_json, []),
      secondaryKeys: parseJsonField<string[]>(r.secondary_keys_json, []),
      constant: Boolean(r.constant),
      priority: r.priority,
      insertionDepth: r.insertion_depth,
      recursive: Boolean(r.recursive),
      recursionLimit: r.recursion_limit,
      tokenBudget: r.token_budget ?? null,
      category: r.category ?? null,
      metadata: parseJsonField<Record<string, unknown>>(r.metadata_json, {}),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    });

  const normalizeNewEntry = (input: NewWorldbookEntryInput) => {
    const parsed = NewWorldbookEntryInputSchema.parse(input);
    const constant = parsed.constant ?? parsed.activation === "constant";
    return {
      ...parsed,
      enabled: parsed.enabled ?? true,
      activation: parsed.activation ?? (constant ? "constant" : "triggered"),
      keys: parsed.keys ?? [],
      secondaryKeys: parsed.secondaryKeys ?? [],
      constant,
      priority: parsed.priority ?? 0,
      insertionDepth: parsed.insertionDepth ?? 0,
      recursive: parsed.recursive ?? false,
      recursionLimit: parsed.recursionLimit ?? 0,
      tokenBudget: parsed.tokenBudget ?? null,
      category: parsed.category ?? null,
      metadata: parsed.metadata ?? {},
    };
  };

  return {
    create(input: NewWorldbookEntryInput): WorldbookEntry {
      const entry = normalizeNewEntry(input);
      const id = randomUUID();
      const now = Date.now();
      db.prepare(
        `INSERT INTO worldbook_entries(
          id,title,content,enabled,activation,keys_json,secondary_keys_json,
          constant,priority,insertion_depth,recursive,recursion_limit,
          token_budget,category,metadata_json,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        id,
        entry.title,
        entry.content,
        entry.enabled ? 1 : 0,
        entry.activation,
        JSON.stringify(entry.keys),
        JSON.stringify(entry.secondaryKeys),
        entry.constant ? 1 : 0,
        entry.priority,
        entry.insertionDepth,
        entry.recursive ? 1 : 0,
        entry.recursionLimit,
        entry.tokenBudget,
        entry.category,
        JSON.stringify(entry.metadata),
        now,
        now,
      );
      return this.get(id)!;
    },

    get(id: string): WorldbookEntry | undefined {
      const row = db.prepare("SELECT * FROM worldbook_entries WHERE id=?").get(id);
      return row ? rowToEntry(row) : undefined;
    },

    list(opts?: { enabledOnly?: boolean }): WorldbookEntry[] {
      const sql = opts?.enabledOnly
        ? "SELECT * FROM worldbook_entries WHERE enabled=1 ORDER BY priority DESC, updated_at DESC"
        : "SELECT * FROM worldbook_entries ORDER BY priority DESC, updated_at DESC";
      return db.prepare(sql).all().map(rowToEntry);
    },

    update(
      id: string,
      patch: Partial<NewWorldbookEntryInput>,
    ): WorldbookEntry {
      const current = this.get(id);
      if (!current) {
        throw new Error(`Worldbook entry not found: ${id}`);
      }
      const parsed = WorldbookEntryPatchSchema.parse(patch);
      const merged = {
        ...current,
        ...parsed,
        activation:
          parsed.activation ??
          (parsed.constant !== undefined
            ? parsed.constant
              ? "constant"
              : "triggered"
            : current.activation),
        keys: parsed.keys ?? current.keys,
        secondaryKeys: parsed.secondaryKeys ?? current.secondaryKeys,
        tokenBudget:
          parsed.tokenBudget !== undefined
            ? parsed.tokenBudget
            : current.tokenBudget,
        category:
          parsed.category !== undefined ? parsed.category : current.category,
        metadata: parsed.metadata ?? current.metadata,
      };
      const now = Date.now();
      db.prepare(
        `UPDATE worldbook_entries SET
          title=?, content=?, enabled=?, activation=?, keys_json=?,
          secondary_keys_json=?, constant=?, priority=?, insertion_depth=?,
          recursive=?, recursion_limit=?, token_budget=?, category=?,
          metadata_json=?, updated_at=?
        WHERE id=?`,
      ).run(
        merged.title,
        merged.content,
        merged.enabled ? 1 : 0,
        merged.activation,
        JSON.stringify(merged.keys),
        JSON.stringify(merged.secondaryKeys),
        merged.constant ? 1 : 0,
        merged.priority,
        merged.insertionDepth,
        merged.recursive ? 1 : 0,
        merged.recursionLimit,
        merged.tokenBudget,
        merged.category,
        JSON.stringify(merged.metadata),
        now,
        id,
      );
      return this.get(id)!;
    },

    delete(id: string): void {
      db.prepare("DELETE FROM worldbook_entries WHERE id=?").run(id);
    },
  };
}
