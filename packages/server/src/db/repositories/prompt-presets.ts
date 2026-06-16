import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import {
  type PromptBlock,
  type PromptPreset,
  type PromptRole,
  PromptBlockSchema,
  PromptPresetSchema,
} from "@scribe/shared";
import { parseJsonField } from "../json-utils.js";

export interface NewPromptPresetInput {
  name: string;
  enabled?: boolean;
  sourceImportId?: string | null;
  generationSettings?: Record<string, unknown>;
  extensions?: Record<string, unknown>;
  regexScriptsEnabled?: boolean;
}

export interface NewPromptBlockInput {
  presetId: string;
  sourceIdentifier: string;
  name: string;
  role: PromptRole;
  content: string;
  enabled?: boolean;
  stackIndex?: number | null;
  injectionPosition?: number | null;
  injectionDepth?: number | null;
  injectionOrder?: number | null;
  systemPrompt?: boolean;
  marker?: boolean;
  forbidOverrides?: boolean;
  injectionTrigger?: string[];
  sourcePromptEnabled?: boolean | null;
  sourceOrderEnabled?: boolean | null;
  metadata?: Record<string, unknown>;
}

export interface PromptPresetPatch {
  name?: string;
  enabled?: boolean;
  generationSettings?: Record<string, unknown>;
  extensions?: Record<string, unknown>;
  regexScriptsEnabled?: boolean;
}

export interface PromptBlockPatch {
  name?: string;
  role?: PromptRole;
  content?: string;
  enabled?: boolean;
  stackIndex?: number | null;
  injectionPosition?: number | null;
  injectionDepth?: number | null;
  injectionOrder?: number | null;
  systemPrompt?: boolean;
  marker?: boolean;
  forbidOverrides?: boolean;
  injectionTrigger?: string[];
  sourcePromptEnabled?: boolean | null;
  sourceOrderEnabled?: boolean | null;
  metadata?: Record<string, unknown>;
}

function nullableBool(value: unknown): boolean | null {
  return value === null || value === undefined ? null : Boolean(value);
}

function boolToDb(value: boolean | null | undefined): number | null {
  return value === null || value === undefined ? null : value ? 1 : 0;
}

export function createPromptPresetsRepo(db: Database, bookId: string) {
  const rowToPreset = (r: any): PromptPreset =>
    PromptPresetSchema.parse({
      id: r.id,
      bookId: r.book_id,
      name: r.name,
      enabled: Boolean(r.enabled),
      sourceImportId: r.source_import_id ?? null,
      generationSettings: parseJsonField<Record<string, unknown>>(
        r.generation_settings_json,
        {},
      ),
      extensions: parseJsonField<Record<string, unknown>>(r.extensions_json, {}),
      regexScriptsEnabled: Boolean(r.regex_scripts_enabled),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    });

  const rowToBlock = (r: any): PromptBlock =>
    PromptBlockSchema.parse({
      id: r.id,
      presetId: r.preset_id,
      sourceIdentifier: r.source_identifier,
      name: r.name,
      role: r.role,
      content: r.content,
      enabled: Boolean(r.enabled),
      stackIndex: r.stack_index ?? null,
      injectionPosition: r.injection_position ?? null,
      injectionDepth: r.injection_depth ?? null,
      injectionOrder: r.injection_order ?? null,
      systemPrompt: Boolean(r.system_prompt),
      marker: Boolean(r.marker),
      forbidOverrides: Boolean(r.forbid_overrides),
      injectionTrigger: parseJsonField<string[]>(r.injection_trigger_json, []),
      sourcePromptEnabled: nullableBool(r.source_prompt_enabled),
      sourceOrderEnabled: nullableBool(r.source_order_enabled),
      metadata: parseJsonField<Record<string, unknown>>(r.metadata_json, {}),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    });

  return {
    createPreset(input: NewPromptPresetInput): PromptPreset {
      const id = randomUUID();
      const now = Date.now();
      db.prepare(
        `INSERT INTO prompt_presets(
          id,book_id,name,enabled,source_import_id,generation_settings_json,
          extensions_json,regex_scripts_enabled,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        id,
        bookId,
        input.name,
        input.enabled ?? true ? 1 : 0,
        input.sourceImportId ?? null,
        JSON.stringify(input.generationSettings ?? {}),
        JSON.stringify(input.extensions ?? {}),
        input.regexScriptsEnabled ? 1 : 0,
        now,
        now,
      );
      return this.getPreset(id)!;
    },

    getPreset(id: string): PromptPreset | undefined {
      const row = db
        .prepare("SELECT * FROM prompt_presets WHERE id=? AND book_id=?")
        .get(id, bookId);
      return row ? rowToPreset(row) : undefined;
    },

    listPresets(opts?: { enabledOnly?: boolean }): PromptPreset[] {
      const sql = opts?.enabledOnly
        ? "SELECT * FROM prompt_presets WHERE book_id=? AND enabled=1 ORDER BY updated_at DESC"
        : "SELECT * FROM prompt_presets WHERE book_id=? ORDER BY updated_at DESC";
      return db.prepare(sql).all(bookId).map(rowToPreset);
    },

    updatePreset(id: string, patch: PromptPresetPatch): PromptPreset {
      const current = this.getPreset(id);
      if (!current) {
        throw new Error(`Prompt preset not found: ${id}`);
      }
      const merged = { ...current, ...patch };
      const now = Date.now();
      db.prepare(
        `UPDATE prompt_presets SET
          name=?, enabled=?, generation_settings_json=?, extensions_json=?,
          regex_scripts_enabled=?, updated_at=?
        WHERE id=? AND book_id=?`,
      ).run(
        merged.name,
        merged.enabled ? 1 : 0,
        JSON.stringify(merged.generationSettings),
        JSON.stringify(merged.extensions),
        merged.regexScriptsEnabled ? 1 : 0,
        now,
        id,
        bookId,
      );
      return this.getPreset(id)!;
    },

    createBlock(input: NewPromptBlockInput): PromptBlock {
      const preset = this.getPreset(input.presetId);
      if (!preset) {
        throw new Error(`Prompt preset not found: ${input.presetId}`);
      }
      const id = randomUUID();
      const now = Date.now();
      db.prepare(
        `INSERT INTO prompt_blocks(
          id,preset_id,source_identifier,name,role,content,enabled,stack_index,
          injection_position,injection_depth,injection_order,system_prompt,
          marker,forbid_overrides,injection_trigger_json,source_prompt_enabled,
          source_order_enabled,metadata_json,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        id,
        input.presetId,
        input.sourceIdentifier,
        input.name,
        input.role,
        input.content,
        input.enabled ?? true ? 1 : 0,
        input.stackIndex ?? null,
        input.injectionPosition ?? null,
        input.injectionDepth ?? null,
        input.injectionOrder ?? null,
        input.systemPrompt ? 1 : 0,
        input.marker ? 1 : 0,
        input.forbidOverrides ? 1 : 0,
        JSON.stringify(input.injectionTrigger ?? []),
        boolToDb(input.sourcePromptEnabled),
        boolToDb(input.sourceOrderEnabled),
        JSON.stringify(input.metadata ?? {}),
        now,
        now,
      );
      return this.getBlock(id)!;
    },

    getBlock(id: string): PromptBlock | undefined {
      const row = db
        .prepare(
          `SELECT b.* FROM prompt_blocks b
           JOIN prompt_presets p ON p.id=b.preset_id
           WHERE b.id=? AND p.book_id=?`,
        )
        .get(id, bookId);
      return row ? rowToBlock(row) : undefined;
    },

    listBlocks(presetId: string, opts?: { enabledOnly?: boolean }): PromptBlock[] {
      const preset = this.getPreset(presetId);
      if (!preset) return [];
      const sql = opts?.enabledOnly
        ? `SELECT * FROM prompt_blocks
           WHERE preset_id=? AND enabled=1
           ORDER BY stack_index IS NULL, stack_index ASC, source_identifier ASC`
        : `SELECT * FROM prompt_blocks
           WHERE preset_id=?
           ORDER BY stack_index IS NULL, stack_index ASC, source_identifier ASC`;
      return db.prepare(sql).all(presetId).map(rowToBlock);
    },

    updateBlock(id: string, patch: PromptBlockPatch): PromptBlock {
      const current = this.getBlock(id);
      if (!current) {
        throw new Error(`Prompt block not found: ${id}`);
      }
      const merged = { ...current, ...patch };
      const now = Date.now();
      db.prepare(
        `UPDATE prompt_blocks SET
          name=?, role=?, content=?, enabled=?, stack_index=?,
          injection_position=?, injection_depth=?, injection_order=?,
          system_prompt=?, marker=?, forbid_overrides=?,
          injection_trigger_json=?, source_prompt_enabled=?,
          source_order_enabled=?, metadata_json=?, updated_at=?
        WHERE id=?`,
      ).run(
        merged.name,
        merged.role,
        merged.content,
        merged.enabled ? 1 : 0,
        merged.stackIndex,
        merged.injectionPosition,
        merged.injectionDepth,
        merged.injectionOrder,
        merged.systemPrompt ? 1 : 0,
        merged.marker ? 1 : 0,
        merged.forbidOverrides ? 1 : 0,
        JSON.stringify(merged.injectionTrigger),
        boolToDb(merged.sourcePromptEnabled),
        boolToDb(merged.sourceOrderEnabled),
        JSON.stringify(merged.metadata),
        now,
        id,
      );
      return this.getBlock(id)!;
    },

    deleteBlock(id: string): void {
      db.prepare(
        `DELETE FROM prompt_blocks
         WHERE id IN (
           SELECT b.id FROM prompt_blocks b
           JOIN prompt_presets p ON p.id=b.preset_id
           WHERE b.id=? AND p.book_id=?
         )`,
      ).run(id, bookId);
    },
  };
}
