# SillyTavern Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fully support SillyTavern preset and worldbook imports so users can freely tune/edit them and so imported prompt behavior, worldbook retrieval, dynamic memory, and reader-continuity issues genuinely preserve long-form plot continuity.

**Architecture:** Add raw import artifacts, prompt preset/block storage, deterministic SillyTavern parsers, macro and regex compatibility engines, import routes, and a prompt compiler that places enabled preset blocks before worldbook and runtime story context. Reuse the existing `worldbook_entries` repository for native entries, extend retrieval to SillyTavern-style matching controls, and preserve every imported field in metadata. Add a reader-issue store so audit warnings become writing constraints in later chapters.

**Tech Stack:** TypeScript, Zod, Hono, SQLite/better-sqlite3 workspace migrations, Vercel AI SDK `CoreMessage`, React, Vitest, Testing Library.

---

## File Structure

- Create `packages/shared/src/types/sillytavern-import.ts`: shared schemas for import artifacts, prompt presets, prompt blocks, import reports, and reader issues.
- Modify `packages/shared/src/index.ts`: export the new shared types.
- Create `packages/server/src/db/migrations/workspace/0009_sillytavern_imports.sql`: raw imports, prompt presets, prompt blocks, and reader issues.
- Create `packages/server/src/db/repositories/import-artifacts.ts`: raw JSON import artifact CRUD.
- Create `packages/server/src/db/repositories/prompt-presets.ts`: preset and prompt block CRUD.
- Create `packages/server/src/db/repositories/reader-issues.ts`: reader-continuity issue CRUD.
- Modify `packages/server/src/http/book-registry.ts`: attach the new repositories to `BookHandle`.
- Create `packages/server/src/ai/import/sillytavern-detect.ts`: detect preset/worldbook/unknown JSON.
- Create `packages/server/src/ai/import/sillytavern-preset.ts`: normalize preset JSON into prompt preset plus blocks.
- Create `packages/server/src/ai/import/sillytavern-worldbook.ts`: normalize worldbook JSON into native worldbook entries and preserved metadata.
- Create `packages/server/src/ai/import/import-service.ts`: orchestrate raw artifact save, normalization, repository writes, and import report.
- Create `packages/server/src/ai/presets/render.ts`: compile enabled prompt preset blocks into `CoreMessage[]`.
- Create `packages/server/src/ai/presets/macros.ts`: SillyTavern-compatible scoped macro engine for `setvar`, `getvar`, and common template variables.
- Create `packages/server/src/ai/presets/regex-scripts.ts`: import, store, toggle, and execute SillyTavern regex scripts when enabled.
- Modify `packages/server/src/ai/worldbook/retrieval.ts`: add selective keys, probability, group scoring, scan depth, case sensitivity, whole-word matching, sticky/cooldown/delay, and explainable trigger diagnostics.
- Modify `packages/server/src/ai/context-builder/snapshot.ts`: include prompt preset and reader issues.
- Modify `packages/server/src/ai/context-builder/builder.ts`: render preset blocks before static/worldbook/dynamic context and render open reader issues.
- Modify `packages/server/src/ai/orchestrator/audit-persist.ts`: persist warning/critical audit issues as reader issues.
- Create `packages/server/src/http/routes/imports.ts`: preview/import endpoints.
- Create `packages/server/src/http/routes/presets.ts`: preset/block list and toggle endpoints.
- Modify `packages/server/src/http/server.ts`: mount import and preset routes.
- Modify `packages/server/src/http/routes/worldbook.ts`: include import metadata in list output and keep preview working for imported entries.
- Modify `packages/client/src/api/client.ts`: add import and preset APIs.
- Create `packages/client/src/components/import/import-dialog.tsx`: JSON import preview and import UI.
- Create `packages/client/src/components/presets/preset-panel.tsx`: ordered preset stack viewer/toggler.
- Modify `packages/client/src/components/sidebar/side-panel.tsx`: add import/preset access next to worldbook.
- Tests:
  - `packages/shared/tests/sillytavern-import.test.ts`
  - `packages/server/tests/unit/db/repositories/import-artifacts.test.ts`
  - `packages/server/tests/unit/db/repositories/prompt-presets.test.ts`
  - `packages/server/tests/unit/db/repositories/reader-issues.test.ts`
  - `packages/server/tests/unit/ai/import/sillytavern-detect.test.ts`
  - `packages/server/tests/unit/ai/import/sillytavern-preset.test.ts`
  - `packages/server/tests/unit/ai/import/sillytavern-worldbook.test.ts`
  - `packages/server/tests/unit/ai/presets/render.test.ts`
  - `packages/server/tests/unit/ai/presets/macros.test.ts`
  - `packages/server/tests/unit/ai/presets/regex-scripts.test.ts`
  - `packages/server/tests/unit/ai/worldbook/sillytavern-retrieval.test.ts`
  - `packages/server/tests/unit/ai/context-builder/preset-context.test.ts`
  - `packages/server/tests/unit/ai/context-builder/reader-issues-context.test.ts`
  - `packages/server/tests/integration/import-routes.test.ts`
  - `packages/server/tests/integration/preset-routes.test.ts`
  - `packages/client/tests/components/import-dialog.test.tsx`
  - `packages/client/tests/components/preset-panel.test.tsx`
  - `packages/server/tools/verify-sillytavern-import.ts`

## Task 1: Shared Types And Workspace Tables

**Files:**
- Create: `packages/shared/src/types/sillytavern-import.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `packages/server/src/db/migrations/workspace/0009_sillytavern_imports.sql`
- Test: `packages/shared/tests/sillytavern-import.test.ts`

- [ ] **Step 1: Write failing shared schema tests**

Create `packages/shared/tests/sillytavern-import.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  ImportArtifactSchema,
  PromptPresetSchema,
  PromptBlockSchema,
  ReaderIssueSchema,
} from "../src/types/sillytavern-import.js";

describe("sillytavern import shared schemas", () => {
  it("accepts import artifacts, prompt blocks, and reader issues", () => {
    expect(ImportArtifactSchema.parse({
      id: "imp-1",
      bookId: "book-1",
      sourceType: "sillytavern_preset",
      sourceName: "Izumi 0503",
      sourceFilename: "Izumi 0503.json",
      rawJson: "{}",
      rawHash: "hash",
      importReport: { warnings: [], stats: {} },
      importedAt: 1,
    }).sourceType).toBe("sillytavern_preset");

    expect(PromptPresetSchema.parse({
      id: "preset-1",
      bookId: "book-1",
      name: "Izumi",
      enabled: true,
      sourceImportId: "imp-1",
      generationSettings: { temperature: 1 },
      extensions: { regex_scripts: [] },
      createdAt: 1,
      updatedAt: 1,
    }).enabled).toBe(true);

    expect(PromptBlockSchema.parse({
      id: "block-1",
      presetId: "preset-1",
      sourceIdentifier: "main",
      name: "Main",
      role: "system",
      content: "Write well.",
      enabled: true,
      stackIndex: 0,
      injectionPosition: 0,
      injectionDepth: 4,
      injectionOrder: 100,
      systemPrompt: false,
      marker: false,
      forbidOverrides: false,
      injectionTrigger: [],
      sourcePromptEnabled: false,
      sourceOrderEnabled: true,
      metadata: {},
      createdAt: 1,
      updatedAt: 1,
    }).sourceOrderEnabled).toBe(true);

    expect(ReaderIssueSchema.parse({
      id: "issue-1",
      chapterNo: 4,
      type: "continuity",
      severity: "warning",
      note: "A companion vanished without explanation.",
      evidence: "Chapter 3 says he joined; chapter 4 omits him.",
      suggestedAction: "Explain his absence or bring him back on page.",
      status: "open",
      createdAt: 1,
      updatedAt: 1,
    }).status).toBe("open");
  });
});
```

- [ ] **Step 2: Run RED**

Run:

```bash
pnpm --filter @scribe/shared test -- sillytavern-import.test.ts
```

Expected: FAIL because `types/sillytavern-import.ts` does not exist.

- [ ] **Step 3: Implement shared types**

Create `packages/shared/src/types/sillytavern-import.ts`:

```ts
import { z } from "zod";

export const ImportSourceTypeSchema = z.enum([
  "sillytavern_preset",
  "sillytavern_worldbook",
  "unknown_json",
]);

export const ImportReportSchema = z.object({
  warnings: z.array(z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    path: z.string().optional(),
  })),
  stats: z.record(z.unknown()),
});

export const ImportArtifactSchema = z.object({
  id: z.string().min(1),
  bookId: z.string().min(1),
  sourceType: ImportSourceTypeSchema,
  sourceName: z.string().min(1),
  sourceFilename: z.string().min(1),
  rawJson: z.string().min(1),
  rawHash: z.string().min(1),
  importReport: ImportReportSchema,
  importedAt: z.number().int(),
});

export const PromptRoleSchema = z.enum(["system", "user", "assistant"]);

export const PromptPresetSchema = z.object({
  id: z.string().min(1),
  bookId: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean(),
  sourceImportId: z.string().min(1).nullable(),
  generationSettings: z.record(z.unknown()),
  extensions: z.record(z.unknown()),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

export const PromptBlockSchema = z.object({
  id: z.string().min(1),
  presetId: z.string().min(1),
  sourceIdentifier: z.string().min(1),
  name: z.string().min(1),
  role: PromptRoleSchema,
  content: z.string(),
  enabled: z.boolean(),
  stackIndex: z.number().int().nullable(),
  injectionPosition: z.number().int().nullable(),
  injectionDepth: z.number().int().nullable(),
  injectionOrder: z.number().int().nullable(),
  systemPrompt: z.boolean(),
  marker: z.boolean(),
  forbidOverrides: z.boolean(),
  injectionTrigger: z.array(z.string()),
  sourcePromptEnabled: z.boolean().nullable(),
  sourceOrderEnabled: z.boolean().nullable(),
  metadata: z.record(z.unknown()),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

export const ReaderIssueTypeSchema = z.enum([
  "continuity",
  "character_behavior",
  "foreshadowing",
  "setting_consistency",
  "pacing",
  "narrative_perspective",
  "information_density",
  "style_drift",
]);

export const ReaderIssueStatusSchema = z.enum([
  "open",
  "injected",
  "resolved",
  "ignored",
  "deferred",
]);

export const ReaderIssueSchema = z.object({
  id: z.string().min(1),
  chapterNo: z.number().int().positive(),
  type: ReaderIssueTypeSchema,
  severity: z.enum(["warning", "critical"]),
  note: z.string().min(1),
  evidence: z.string().nullable(),
  suggestedAction: z.string().nullable(),
  status: ReaderIssueStatusSchema,
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

export type ImportSourceType = z.infer<typeof ImportSourceTypeSchema>;
export type ImportReport = z.infer<typeof ImportReportSchema>;
export type ImportArtifact = z.infer<typeof ImportArtifactSchema>;
export type PromptPreset = z.infer<typeof PromptPresetSchema>;
export type PromptBlock = z.infer<typeof PromptBlockSchema>;
export type PromptRole = z.infer<typeof PromptRoleSchema>;
export type ReaderIssue = z.infer<typeof ReaderIssueSchema>;
export type ReaderIssueType = z.infer<typeof ReaderIssueTypeSchema>;
export type ReaderIssueStatus = z.infer<typeof ReaderIssueStatusSchema>;
```

Modify `packages/shared/src/index.ts`:

```ts
export * from "./types/sillytavern-import.js";
```

- [ ] **Step 4: Add workspace migration**

Create `packages/server/src/db/migrations/workspace/0009_sillytavern_imports.sql`:

```sql
CREATE TABLE import_artifacts (
  id                 TEXT PRIMARY KEY,
  book_id            TEXT NOT NULL,
  source_type        TEXT NOT NULL,
  source_name        TEXT NOT NULL,
  source_filename    TEXT NOT NULL,
  raw_json           TEXT NOT NULL,
  raw_hash           TEXT NOT NULL,
  import_report_json TEXT NOT NULL,
  imported_at        INTEGER NOT NULL
);

CREATE INDEX idx_import_artifacts_book
  ON import_artifacts(book_id, imported_at DESC);

CREATE TABLE prompt_presets (
  id                       TEXT PRIMARY KEY,
  book_id                  TEXT NOT NULL,
  name                     TEXT NOT NULL,
  enabled                  INTEGER NOT NULL,
  source_import_id         TEXT,
  generation_settings_json TEXT NOT NULL,
  extensions_json          TEXT NOT NULL,
  created_at               INTEGER NOT NULL,
  updated_at               INTEGER NOT NULL
);

CREATE INDEX idx_prompt_presets_book_enabled
  ON prompt_presets(book_id, enabled, updated_at DESC);

CREATE TABLE prompt_blocks (
  id                    TEXT PRIMARY KEY,
  preset_id             TEXT NOT NULL,
  source_identifier     TEXT NOT NULL,
  name                  TEXT NOT NULL,
  role                  TEXT NOT NULL,
  content               TEXT NOT NULL,
  enabled               INTEGER NOT NULL,
  stack_index           INTEGER,
  injection_position    INTEGER,
  injection_depth       INTEGER,
  injection_order       INTEGER,
  system_prompt         INTEGER NOT NULL,
  marker                INTEGER NOT NULL,
  forbid_overrides      INTEGER NOT NULL,
  injection_trigger_json TEXT NOT NULL,
  source_prompt_enabled INTEGER,
  source_order_enabled  INTEGER,
  metadata_json         TEXT NOT NULL,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL
);

CREATE INDEX idx_prompt_blocks_preset_stack
  ON prompt_blocks(preset_id, stack_index, source_identifier);

CREATE TABLE reader_issues (
  id               TEXT PRIMARY KEY,
  chapter_no       INTEGER NOT NULL,
  type             TEXT NOT NULL,
  severity         TEXT NOT NULL,
  note             TEXT NOT NULL,
  evidence         TEXT,
  suggested_action TEXT,
  status           TEXT NOT NULL,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

CREATE INDEX idx_reader_issues_status_chapter
  ON reader_issues(status, chapter_no);
```

- [ ] **Step 5: Run GREEN**

Run:

```bash
pnpm --filter @scribe/shared test -- sillytavern-import.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/types/sillytavern-import.ts packages/shared/src/index.ts packages/shared/tests/sillytavern-import.test.ts packages/server/src/db/migrations/workspace/0009_sillytavern_imports.sql
git commit -m "feat: add sillytavern import shared types"
```

## Task 2: Import, Preset, And Reader-Issue Repositories

**Files:**
- Create: `packages/server/src/db/repositories/import-artifacts.ts`
- Create: `packages/server/src/db/repositories/prompt-presets.ts`
- Create: `packages/server/src/db/repositories/reader-issues.ts`
- Modify: `packages/server/src/http/book-registry.ts`
- Test: `packages/server/tests/unit/db/repositories/import-artifacts.test.ts`
- Test: `packages/server/tests/unit/db/repositories/prompt-presets.test.ts`
- Test: `packages/server/tests/unit/db/repositories/reader-issues.test.ts`

- [ ] **Step 1: Write failing repository tests**

Create `packages/server/tests/unit/db/repositories/import-artifacts.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { openWorkspaceDb } from "../../../../src/db/workspace.js";
import { createImportArtifactsRepo } from "../../../../src/db/repositories/import-artifacts.js";

const roots: string[] = [];

function openRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scribe-import-artifacts-"));
  roots.push(root);
  const db = openWorkspaceDb(path.join(root, "workspace.db"));
  return { db, repo: createImportArtifactsRepo(db, "book-1") };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("import artifacts repository", () => {
  it("creates and lists raw import artifacts", () => {
    const { db, repo } = openRepo();
    try {
      const artifact = repo.create({
        sourceType: "sillytavern_preset",
        sourceName: "Izumi 0503",
        sourceFilename: "Izumi 0503.json",
        rawJson: "{\"prompts\":[]}",
        rawHash: "abc",
        importReport: { warnings: [], stats: { promptCount: 0 } },
      });

      expect(artifact.bookId).toBe("book-1");
      expect(artifact.importReport.stats.promptCount).toBe(0);
      expect(repo.list()).toHaveLength(1);
      expect(repo.get(artifact.id)?.rawJson).toContain("prompts");
    } finally {
      db.close();
    }
  });
});
```

Create `packages/server/tests/unit/db/repositories/prompt-presets.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { openWorkspaceDb } from "../../../../src/db/workspace.js";
import { createPromptPresetsRepo } from "../../../../src/db/repositories/prompt-presets.js";

const roots: string[] = [];

function openRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scribe-prompt-presets-"));
  roots.push(root);
  const db = openWorkspaceDb(path.join(root, "workspace.db"));
  return { db, repo: createPromptPresetsRepo(db, "book-1") };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("prompt presets repository", () => {
  it("creates presets with ordered blocks and toggles blocks", () => {
    const { db, repo } = openRepo();
    try {
      const preset = repo.createPreset({
        name: "Izumi",
        enabled: true,
        sourceImportId: "imp-1",
        generationSettings: { temperature: 1 },
        extensions: { regex_scripts: [] },
      });

      const block = repo.createBlock({
        presetId: preset.id,
        sourceIdentifier: "main",
        name: "Main prompt",
        role: "system",
        content: "Write vivid prose.",
        enabled: true,
        stackIndex: 0,
        injectionPosition: 0,
        injectionDepth: 4,
        injectionOrder: 100,
        systemPrompt: false,
        marker: false,
        forbidOverrides: false,
        injectionTrigger: [],
        sourcePromptEnabled: false,
        sourceOrderEnabled: true,
        metadata: {},
      });

      expect(repo.listPresets()).toHaveLength(1);
      expect(repo.listBlocks(preset.id).map((item) => item.sourceIdentifier)).toEqual(["main"]);

      repo.updateBlock(block.id, { enabled: false });
      expect(repo.listBlocks(preset.id)[0]!.enabled).toBe(false);
    } finally {
      db.close();
    }
  });
});
```

Create `packages/server/tests/unit/db/repositories/reader-issues.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { openWorkspaceDb } from "../../../../src/db/workspace.js";
import { createReaderIssuesRepo } from "../../../../src/db/repositories/reader-issues.js";

const roots: string[] = [];

function openRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scribe-reader-issues-"));
  roots.push(root);
  const db = openWorkspaceDb(path.join(root, "workspace.db"));
  return { db, repo: createReaderIssuesRepo(db) };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("reader issues repository", () => {
  it("creates open issues and updates their status", () => {
    const { db, repo } = openRepo();
    try {
      const issue = repo.create({
        chapterNo: 4,
        type: "continuity",
        severity: "warning",
        note: "A character disappears without explanation.",
        evidence: "Chapter 3 says he joins the team.",
        suggestedAction: "Explain the absence before moving on.",
        status: "open",
      });

      expect(repo.listOpen()).toHaveLength(1);
      repo.update(issue.id, { status: "resolved" });
      expect(repo.listOpen()).toEqual([]);
      expect(repo.listAll()[0]!.status).toBe("resolved");
    } finally {
      db.close();
    }
  });
});
```

- [ ] **Step 2: Run RED**

Run:

```bash
pnpm --filter @scribe/server test -- import-artifacts.test.ts prompt-presets.test.ts reader-issues.test.ts
```

Expected: FAIL because the repositories do not exist.

- [ ] **Step 3: Implement repositories**

Implement repository functions using the same style as `packages/server/src/db/repositories/worldbook.ts`.

Required APIs:

```ts
// import-artifacts.ts
export function createImportArtifactsRepo(db: Database, bookId: string) {
  return {
    create(input: {
      sourceType: ImportSourceType;
      sourceName: string;
      sourceFilename: string;
      rawJson: string;
      rawHash: string;
      importReport: ImportReport;
    }): ImportArtifact;
    get(id: string): ImportArtifact | undefined;
    list(): ImportArtifact[];
  };
}

// prompt-presets.ts
export function createPromptPresetsRepo(db: Database, bookId: string) {
  return {
    createPreset(input: {
      name: string;
      enabled?: boolean;
      sourceImportId?: string | null;
      generationSettings?: Record<string, unknown>;
      extensions?: Record<string, unknown>;
    }): PromptPreset;
    listPresets(opts?: { enabledOnly?: boolean }): PromptPreset[];
    getPreset(id: string): PromptPreset | undefined;
    updatePreset(id: string, patch: Partial<Pick<PromptPreset, "name" | "enabled" | "generationSettings" | "extensions">>): PromptPreset;
    createBlock(input: Omit<PromptBlock, "id" | "createdAt" | "updatedAt">): PromptBlock;
    listBlocks(presetId: string, opts?: { enabledOnly?: boolean }): PromptBlock[];
    updateBlock(id: string, patch: Partial<Pick<PromptBlock, "enabled" | "stackIndex" | "content" | "name">>): PromptBlock;
  };
}

// reader-issues.ts
export function createReaderIssuesRepo(db: Database) {
  return {
    create(input: Omit<ReaderIssue, "id" | "createdAt" | "updatedAt">): ReaderIssue;
    listAll(): ReaderIssue[];
    listOpen(): ReaderIssue[];
    update(id: string, patch: Partial<Pick<ReaderIssue, "status" | "suggestedAction" | "evidence">>): ReaderIssue;
  };
}
```

- [ ] **Step 4: Wire repositories into registry**

Modify `packages/server/src/http/book-registry.ts`:

```ts
import { createImportArtifactsRepo } from "../db/repositories/import-artifacts.js";
import { createPromptPresetsRepo } from "../db/repositories/prompt-presets.js";
import { createReaderIssuesRepo } from "../db/repositories/reader-issues.js";
```

Add to `BookHandle`:

```ts
importArtifactsRepo: ReturnType<typeof createImportArtifactsRepo>;
promptPresetsRepo: ReturnType<typeof createPromptPresetsRepo>;
readerIssuesRepo: ReturnType<typeof createReaderIssuesRepo>;
```

Add to `handle` construction:

```ts
importArtifactsRepo: createImportArtifactsRepo(ws, bookId),
promptPresetsRepo: createPromptPresetsRepo(ws, bookId),
readerIssuesRepo: createReaderIssuesRepo(ws),
```

- [ ] **Step 5: Run GREEN**

Run:

```bash
pnpm --filter @scribe/server test -- import-artifacts.test.ts prompt-presets.test.ts reader-issues.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/db/repositories/import-artifacts.ts packages/server/src/db/repositories/prompt-presets.ts packages/server/src/db/repositories/reader-issues.ts packages/server/src/http/book-registry.ts packages/server/tests/unit/db/repositories/import-artifacts.test.ts packages/server/tests/unit/db/repositories/prompt-presets.test.ts packages/server/tests/unit/db/repositories/reader-issues.test.ts
git commit -m "feat: persist imported presets and reader issues"
```

## Task 3: SillyTavern Detection And Normalization

**Files:**
- Create: `packages/server/src/ai/import/sillytavern-detect.ts`
- Create: `packages/server/src/ai/import/sillytavern-preset.ts`
- Create: `packages/server/src/ai/import/sillytavern-worldbook.ts`
- Test: `packages/server/tests/unit/ai/import/sillytavern-detect.test.ts`
- Test: `packages/server/tests/unit/ai/import/sillytavern-preset.test.ts`
- Test: `packages/server/tests/unit/ai/import/sillytavern-worldbook.test.ts`

- [ ] **Step 1: Write failing detection tests**

Create `packages/server/tests/unit/ai/import/sillytavern-detect.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { detectSillyTavernJson } from "../../../../src/ai/import/sillytavern-detect.js";

describe("detectSillyTavernJson", () => {
  it("detects preset and worldbook shapes", () => {
    expect(detectSillyTavernJson({
      prompts: [],
      prompt_order: [],
      temperature: 1,
    })).toBe("sillytavern_preset");

    expect(detectSillyTavernJson({
      entries: {
        "0": { key: ["world"], comment: "World", content: "Rules" },
      },
      originalData: { name: "Worldbook" },
    })).toBe("sillytavern_worldbook");

    expect(detectSillyTavernJson({ hello: "world" })).toBe("unknown_json");
  });
});
```

- [ ] **Step 2: Write failing preset normalization tests**

Create `packages/server/tests/unit/ai/import/sillytavern-preset.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeSillyTavernPreset } from "../../../../src/ai/import/sillytavern-preset.js";

describe("normalizeSillyTavernPreset", () => {
  it("uses prompt_order enabled state and preserves mismatches", () => {
    const result = normalizeSillyTavernPreset({
      temperature: 1,
      top_p: 0.99,
      extensions: { regex_scripts: [{ scriptName: "r" }] },
      prompts: [
        {
          identifier: "main",
          name: "Main",
          enabled: false,
          role: "system",
          content: "Write with continuity.",
          injection_position: 0,
          injection_depth: 4,
          injection_order: 100,
          system_prompt: false,
          marker: false,
          forbid_overrides: false,
          injection_trigger: [],
        },
        {
          identifier: "unused",
          name: "Unused",
          enabled: true,
          role: "system",
          content: "Unused content.",
        },
      ],
      prompt_order: [{
        character_id: 100001,
        order: [{ identifier: "main", enabled: true }],
      }],
    }, "Izumi 0503.json");

    expect(result.preset.name).toBe("Izumi 0503");
    expect(result.preset.generationSettings.temperature).toBe(1);
    expect(result.preset.extensions.regex_scripts).toHaveLength(1);
    expect(result.blocks).toHaveLength(2);

    const main = result.blocks.find((block) => block.sourceIdentifier === "main")!;
    expect(main.enabled).toBe(true);
    expect(main.stackIndex).toBe(0);
    expect(main.sourcePromptEnabled).toBe(false);
    expect(main.sourceOrderEnabled).toBe(true);

    const unused = result.blocks.find((block) => block.sourceIdentifier === "unused")!;
    expect(unused.enabled).toBe(false);
    expect(unused.stackIndex).toBeNull();
    expect(result.report.warnings.map((warning) => warning.code)).toContain("prompt_enabled_mismatch");
  });
});
```

- [ ] **Step 3: Write failing worldbook normalization tests**

Create `packages/server/tests/unit/ai/import/sillytavern-worldbook.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeSillyTavernWorldbook } from "../../../../src/ai/import/sillytavern-worldbook.js";

describe("normalizeSillyTavernWorldbook", () => {
  it("maps native worldbook fields and preserves raw SillyTavern metadata", () => {
    const result = normalizeSillyTavernWorldbook({
      entries: {
        "0": {
          key: ["capture", "pet ball"],
          keysecondary: ["system"],
          comment: "Capture rules",
          content: "Capture must roll probability.",
          constant: false,
          selective: true,
          selectiveLogic: 1,
          order: 88,
          position: 0,
          disable: false,
          ignoreBudget: true,
          preventRecursion: false,
          delayUntilRecursion: false,
          probability: 100,
          useProbability: true,
          depth: 4,
          role: "system",
          extensions: { depth: 4, role: "system" },
        },
        "1": {
          key: ["core"],
          keysecondary: [],
          comment: "Core world",
          content: "Always include this.",
          constant: true,
          order: 100,
          depth: 0,
          disable: false,
          role: "system",
        },
      },
      originalData: { name: "Pet worldbook" },
    });

    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]!.title).toBe("Capture rules");
    expect(result.entries[0]!.activation).toBe("triggered");
    expect(result.entries[0]!.keys).toEqual(["capture", "pet ball"]);
    expect(result.entries[0]!.secondaryKeys).toEqual(["system"]);
    expect(result.entries[0]!.priority).toBe(88);
    expect(result.entries[0]!.insertionDepth).toBe(4);
    expect(result.entries[0]!.metadata.sillytavern).toMatchObject({
      uid: "0",
      role: "system",
      position: 0,
    });
    expect((result.entries[0]!.metadata.sillytavern as any).rawEntry.selective).toBe(true);

    expect(result.entries[1]!.activation).toBe("constant");
    expect(result.report.stats.entryCount).toBe(2);
    expect(result.report.stats.constantCount).toBe(1);
  });
});
```

- [ ] **Step 4: Run RED**

Run:

```bash
pnpm --filter @scribe/server test -- sillytavern-detect.test.ts sillytavern-preset.test.ts sillytavern-worldbook.test.ts
```

Expected: FAIL because import modules do not exist.

- [ ] **Step 5: Implement detection and normalizers**

Implement `detectSillyTavernJson`:

```ts
import type { ImportSourceType } from "@scribe/shared";

export function detectSillyTavernJson(value: unknown): ImportSourceType {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "unknown_json";
  const obj = value as Record<string, unknown>;
  if (Array.isArray(obj.prompts) && Array.isArray(obj.prompt_order)) {
    return "sillytavern_preset";
  }
  if (obj.entries && typeof obj.entries === "object") {
    const entries = obj.entries as Record<string, unknown>;
    const first = Object.values(entries)[0] as Record<string, unknown> | undefined;
    if (first && typeof first === "object" && ("content" in first || "comment" in first)) {
      return "sillytavern_worldbook";
    }
  }
  return "unknown_json";
}
```

Implement `normalizeSillyTavernPreset` with this public return shape:

```ts
export interface NormalizedPresetImport {
  preset: {
    name: string;
    enabled: boolean;
    sourceImportId: string | null;
    generationSettings: Record<string, unknown>;
    extensions: Record<string, unknown>;
  };
  blocks: Array<Omit<PromptBlock, "id" | "presetId" | "createdAt" | "updatedAt">>;
  report: ImportReport;
}
```

Implementation rules:

- derive `name` from filename by removing `.json`;
- copy non-object top-level generation settings except `prompts`, `prompt_order`, and `extensions`;
- preserve `extensions`;
- build ordered blocks from the first `prompt_order` group;
- use `order.enabled` as the block `enabled` value;
- import unreferenced prompts as disabled blocks with `stackIndex: null`;
- warn with `code: "prompt_enabled_mismatch"` when prompt enabled and order enabled disagree;
- warn with `code: "empty_prompt_content"` for enabled blocks with empty content.

Implement `normalizeSillyTavernWorldbook` with this public return shape:

```ts
export interface NormalizedWorldbookImport {
  entries: NewWorldbookEntryInput[];
  report: ImportReport;
}
```

Implementation rules:

- accept object-shaped `entries`;
- map fields exactly as specified in the design doc;
- set `metadata.sillytavern.rawEntry` to the original raw entry;
- set `metadata.sillytavern.uid` to the map key;
- warn with `code: "empty_trigger_keys"` when a non-constant entry has no primary or secondary keys;
- warn with `code: "large_worldbook_entry"` when content length exceeds 3,000 characters.

- [ ] **Step 6: Run GREEN**

Run:

```bash
pnpm --filter @scribe/server test -- sillytavern-detect.test.ts sillytavern-preset.test.ts sillytavern-worldbook.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/ai/import/sillytavern-detect.ts packages/server/src/ai/import/sillytavern-preset.ts packages/server/src/ai/import/sillytavern-worldbook.ts packages/server/tests/unit/ai/import
git commit -m "feat: normalize sillytavern preset and worldbook exports"
```

## Task 4: Import Service And HTTP Routes

**Files:**
- Create: `packages/server/src/ai/import/import-service.ts`
- Create: `packages/server/src/http/routes/imports.ts`
- Modify: `packages/server/src/http/server.ts`
- Test: `packages/server/tests/integration/import-routes.test.ts`

- [ ] **Step 1: Write failing import route tests**

Create `packages/server/tests/integration/import-routes.test.ts` using the same temp registry style as `worldbook-routes.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createBookRegistry } from "../../src/http/book-registry.js";
import { createApp } from "../../src/http/server.js";

const json = <T>(res: Response): Promise<T> => res.json() as Promise<T>;

let tmp: string;
let registry: ReturnType<typeof createBookRegistry>;
let app: ReturnType<typeof createApp>;
let bookId: string;

function makePaths(root: string) {
  return {
    appRoot: root,
    libraryDb: path.posix.join(root, "library.db"),
    booksDir: path.posix.join(root, "books"),
    backupsDir: path.posix.join(root, "backups"),
    secretsEnv: path.posix.join(root, "secrets.env"),
    configJson: path.posix.join(root, "config.json"),
    bookDir: (id: string) => path.posix.join(root, "books", id),
    workspaceDb: (id: string) => path.posix.join(root, "books", id, "workspace.db"),
    chaptersDir: (id: string) => path.posix.join(root, "books", id, "chapters"),
    rulesMd: (id: string) => path.posix.join(root, "books", id, "rules.md"),
    exportsDir: (id: string) => path.posix.join(root, "books", id, "exports"),
    bookBackupsDir: (id: string) => path.posix.join(root, "backups", id),
  };
}

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scribe-import-routes-"));
  const paths = makePaths(tmp);
  fs.mkdirSync(paths.booksDir, { recursive: true });
  registry = createBookRegistry({ paths });
  app = createApp({ bookRegistry: registry });
  const create = await app.request("/api/books", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Import test" }),
  });
  bookId = ((await create.json()) as { id: string }).id;
});

afterEach(() => {
  registry.closeAll();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("sillytavern import routes", () => {
  it("previews and imports a preset using prompt_order state", async () => {
    const payload = {
      filename: "Izumi 0503.json",
      json: {
        temperature: 1,
        prompts: [{
          identifier: "main",
          name: "Main",
          enabled: false,
          role: "system",
          content: "Write with continuity.",
        }],
        prompt_order: [{ character_id: 100001, order: [{ identifier: "main", enabled: true }] }],
      },
    };

    const preview = await app.request(`/api/books/${bookId}/imports/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(preview.status).toBe(200);
    const previewJson = await json<{ sourceType: string; stats: Record<string, unknown> }>(preview);
    expect(previewJson.sourceType).toBe("sillytavern_preset");
    expect(previewJson.stats.promptCount).toBe(1);

    const imported = await app.request(`/api/books/${bookId}/imports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(imported.status).toBe(201);
    const importedJson = await json<{ sourceType: string; imported: { promptBlocks: number } }>(imported);
    expect(importedJson.imported.promptBlocks).toBe(1);
    expect(registry.open(bookId).promptPresetsRepo.listPresets()).toHaveLength(1);
    expect(registry.open(bookId).promptPresetsRepo.listBlocks(
      registry.open(bookId).promptPresetsRepo.listPresets()[0]!.id,
    )[0]!.enabled).toBe(true);
  });

  it("imports a worldbook into native worldbook entries", async () => {
    const imported = await app.request(`/api/books/${bookId}/imports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "worldbook.json",
        json: {
          entries: {
            "0": {
              key: ["capture"],
              keysecondary: [],
              comment: "Capture rules",
              content: "Capture must roll probability.",
              constant: false,
              order: 88,
              depth: 4,
              disable: false,
              role: "system",
            },
          },
        },
      }),
    });

    expect(imported.status).toBe(201);
    expect(registry.open(bookId).worldbookRepo.list().map((entry) => entry.title))
      .toContain("Capture rules");
    expect(registry.open(bookId).worldbookRepo.list()[0]!.metadata).toMatchObject({
      sillytavern: { uid: "0" },
    });
  });
});
```

- [ ] **Step 2: Run RED**

Run:

```bash
pnpm --filter @scribe/server test -- import-routes.test.ts
```

Expected: FAIL with 404 for import routes.

- [ ] **Step 3: Implement import service**

Create `packages/server/src/ai/import/import-service.ts`.

Required public API:

```ts
import { createHash } from "node:crypto";
import type { BookHandle } from "../../http/book-registry.js";

export interface ImportJsonInput {
  filename: string;
  json: unknown;
}

export function previewSillyTavernImport(input: ImportJsonInput): {
  sourceType: ImportSourceType;
  sourceName: string;
  stats: Record<string, unknown>;
  warnings: ImportReport["warnings"];
};

export function importSillyTavernJson(handle: BookHandle, input: ImportJsonInput): {
  artifact: ImportArtifact;
  sourceType: ImportSourceType;
  imported: { promptPresets: number; promptBlocks: number; worldbookEntries: number };
};
```

Implementation requirements:

- stringify raw JSON with `JSON.stringify(input.json)`;
- hash raw JSON with SHA-256;
- save an `import_artifacts` row before writing normalized rows;
- for preset: create one prompt preset and all prompt blocks;
- for worldbook: create native worldbook entries via `handle.worldbookRepo.create`;
- set `metadata.sourceImportId` on imported worldbook entries;
- return counts.

- [ ] **Step 4: Implement routes**

Create `packages/server/src/http/routes/imports.ts`:

```ts
import { Hono } from "hono";
import type { BookRegistry } from "../book-registry.js";
import { importSillyTavernJson, previewSillyTavernImport } from "../../ai/import/import-service.js";

export function importRoutes(deps: { registry: BookRegistry }) {
  const app = new Hono();

  function openHandle(bookId: string) {
    const book = deps.registry.booksRepo.get(bookId);
    return book ? deps.registry.open(bookId) : undefined;
  }

  app.post("/api/books/:bookId/imports/preview", async (c) => {
    const handle = openHandle(c.req.param("bookId"));
    if (!handle) return c.json({ error: "book_not_found" }, 404);
    const body = await c.req.json().catch(() => undefined) as { filename?: unknown; json?: unknown } | undefined;
    if (!body || typeof body.filename !== "string") return c.json({ error: "invalid_import_payload" }, 400);
    return c.json(previewSillyTavernImport({ filename: body.filename, json: body.json }));
  });

  app.post("/api/books/:bookId/imports", async (c) => {
    const handle = openHandle(c.req.param("bookId"));
    if (!handle) return c.json({ error: "book_not_found" }, 404);
    const body = await c.req.json().catch(() => undefined) as { filename?: unknown; json?: unknown } | undefined;
    if (!body || typeof body.filename !== "string") return c.json({ error: "invalid_import_payload" }, 400);
    const result = importSillyTavernJson(handle, { filename: body.filename, json: body.json });
    if (result.sourceType === "unknown_json") return c.json({ error: "unsupported_import_json" }, 400);
    return c.json(result, 201);
  });

  return app;
}
```

Modify `packages/server/src/http/server.ts`:

```ts
import { importRoutes } from "./routes/imports.js";
```

Inside `if (deps.bookRegistry)`:

```ts
app.route("/", importRoutes({ registry: deps.bookRegistry }));
```

- [ ] **Step 5: Run GREEN**

Run:

```bash
pnpm --filter @scribe/server test -- import-routes.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/ai/import/import-service.ts packages/server/src/http/routes/imports.ts packages/server/src/http/server.ts packages/server/tests/integration/import-routes.test.ts
git commit -m "feat: import sillytavern json into books"
```

## Task 5: Preset Rendering And Context Integration

**Files:**
- Create: `packages/server/src/ai/presets/macros.ts`
- Create: `packages/server/src/ai/presets/render.ts`
- Modify: `packages/server/src/ai/context-builder/snapshot.ts`
- Modify: `packages/server/src/ai/context-builder/builder.ts`
- Test: `packages/server/tests/unit/ai/presets/render.test.ts`
- Test: `packages/server/tests/unit/ai/presets/macros.test.ts`
- Test: `packages/server/tests/unit/ai/context-builder/preset-context.test.ts`

- [ ] **Step 1: Write failing macro tests**

Create `packages/server/tests/unit/ai/presets/macros.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  createMacroScope,
  expandSillyTavernMacros,
} from "../../../../src/ai/presets/macros.js";

function scope() {
  return createMacroScope({
    user: "Lin",
    char: "Tide Book",
    lastUserMessage: "Continue",
    date: "2026-06-16",
    time: "12:00",
  });
}

describe("SillyTavern macro engine", () => {
  it("evaluates setvar and getvar in order without leaking scopes", () => {
    const first = scope();
    expect(expandSillyTavernMacros(
      "{{setvar::tone::quiet}}Tone={{getvar::tone}}",
      first,
    )).toBe("Tone=quiet");
    expect(expandSillyTavernMacros("User={{user}}, Char={{char}}", first))
      .toBe("User=Lin, Char=Tide Book");

    const fresh = scope();
    expect(expandSillyTavernMacros("Tone={{getvar::tone}}", fresh)).toBe("Tone=");
  });

  it("preserves unknown macros and records diagnostics", () => {
    const s = scope();
    expect(expandSillyTavernMacros("{{random::a,b}}", s)).toBe("{{random::a,b}}");
    expect(s.diagnostics.map((item) => item.code)).toContain("unknown_macro");
  });
});
```

- [ ] **Step 2: Write failing render tests**

Create `packages/server/tests/unit/ai/presets/render.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { PromptBlock } from "@scribe/shared";
import { renderPromptPresetBlocks } from "../../../../src/ai/presets/render.js";

function block(patch: Partial<PromptBlock>): PromptBlock {
  return {
    id: patch.id ?? "b",
    presetId: patch.presetId ?? "p",
    sourceIdentifier: patch.sourceIdentifier ?? "main",
    name: patch.name ?? "Main",
    role: patch.role ?? "system",
    content: patch.content ?? "",
    enabled: patch.enabled ?? true,
    stackIndex: patch.stackIndex ?? 0,
    injectionPosition: patch.injectionPosition ?? 0,
    injectionDepth: patch.injectionDepth ?? 4,
    injectionOrder: patch.injectionOrder ?? 100,
    systemPrompt: patch.systemPrompt ?? false,
    marker: patch.marker ?? false,
    forbidOverrides: patch.forbidOverrides ?? false,
    injectionTrigger: patch.injectionTrigger ?? [],
    sourcePromptEnabled: patch.sourcePromptEnabled ?? true,
    sourceOrderEnabled: patch.sourceOrderEnabled ?? true,
    metadata: patch.metadata ?? {},
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("preset rendering", () => {
  it("renders enabled blocks in stack order, keeps roles, and shares macro scope across blocks", () => {
    const messages = renderPromptPresetBlocks([
      block({ id: "b2", role: "assistant", content: "Tone={{getvar::tone}}", stackIndex: 1 }),
      block({ id: "b1", role: "system", content: "{{setvar::tone::quiet}}System.", stackIndex: 0 }),
      block({ id: "b3", enabled: false, content: "Skip.", stackIndex: 2 }),
    ], {
      user: "Lin",
      char: "Book",
      lastUserMessage: "",
      date: "2026-06-16",
      time: "12:00",
    });

    expect(messages).toEqual([
      { role: "system", content: "System." },
      { role: "assistant", content: "Tone=quiet" },
    ]);
  });
});
```

- [ ] **Step 3: Write failing context test**

Create `packages/server/tests/unit/ai/context-builder/preset-context.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { BookSnapshot } from "../../../../src/ai/context-builder/snapshot.js";
import { buildWriteContext } from "../../../../src/ai/context-builder/builder.js";

describe("preset context integration", () => {
  it("places enabled preset blocks before worldbook and dynamic context", () => {
    const snapshot: BookSnapshot = {
      bookId: "book-1",
      meta: { title: "Tide Book", premise: "", genre: "fantasy" },
      rulesMd: "",
      characters: [],
      outline: [],
      activeForeshadowing: [],
      paidForeshadowing: [],
      recentSummaries: [],
      allSummaries: [],
      genreSections: [],
      worldbookEntries: [{
        id: "w1",
        title: "Harbor",
        content: "The harbor has bells.",
        enabled: true,
        activation: "constant",
        keys: [],
        secondaryKeys: [],
        constant: true,
        priority: 1,
        insertionDepth: 0,
        recursive: false,
        recursionLimit: 0,
        tokenBudget: null,
        category: null,
        metadata: {},
        createdAt: 1,
        updatedAt: 1,
      }],
      promptBlocks: [{
        id: "p1",
        presetId: "preset",
        sourceIdentifier: "style",
        name: "Style",
        role: "system",
        content: "Use close third person.",
        enabled: true,
        stackIndex: 0,
        injectionPosition: 0,
        injectionDepth: 4,
        injectionOrder: 100,
        systemPrompt: false,
        marker: false,
        forbidOverrides: false,
        injectionTrigger: [],
        sourcePromptEnabled: true,
        sourceOrderEnabled: true,
        metadata: {},
        createdAt: 1,
        updatedAt: 1,
      }],
      readerIssues: [],
    };

    const result = buildWriteContext({
      snapshot,
      currentChapterNo: 1,
      intent: { characters: [], foreshadowing: [], userMessage: "Continue." },
    });

    const joined = result.messages.map((m) => String(m.content)).join("\n---\n");
    expect(joined.indexOf("Use close third person.")).toBeLessThan(joined.indexOf("The harbor has bells."));
  });
});
```

- [ ] **Step 4: Run RED**

Run:

```bash
pnpm --filter @scribe/server test -- macros.test.ts render.test.ts preset-context.test.ts
```

Expected: FAIL because preset render module and snapshot fields do not exist.

- [ ] **Step 5: Implement scoped macro expansion and rendering**

Create `packages/server/src/ai/presets/macros.ts`:

```ts
export interface PresetMacroContext {
  user: string;
  char: string;
  lastUserMessage: string;
  date: string;
  time: string;
}

export interface MacroDiagnostic {
  code: "unknown_macro";
  macro: string;
}

export interface MacroScope {
  context: PresetMacroContext;
  variables: Map<string, string>;
  diagnostics: MacroDiagnostic[];
}

export function createMacroScope(context: PresetMacroContext): MacroScope {
  return { context, variables: new Map(), diagnostics: [] };
}

export function expandSillyTavernMacros(text: string, scope: MacroScope): string {
  return text.replace(/\{\{([^{}]+)\}\}/g, (full, body: string) => {
    if (body === "user") return scope.context.user;
    if (body === "char") return scope.context.char;
    if (body === "lastUserMessage") return scope.context.lastUserMessage;
    if (body === "date") return scope.context.date;
    if (body === "time") return scope.context.time;
    if (body.startsWith("setvar::")) {
      const [, name, ...rest] = body.split("::");
      scope.variables.set(name ?? "", rest.join("::"));
      return "";
    }
    if (body.startsWith("getvar::")) {
      const [, name] = body.split("::");
      return scope.variables.get(name ?? "") ?? "";
    }
    scope.diagnostics.push({ code: "unknown_macro", macro: full });
    return full;
  });
}
```

Create `packages/server/src/ai/presets/render.ts`:

```ts
import type { CoreMessage } from "ai";
import type { PromptBlock } from "@scribe/shared";
import {
  createMacroScope,
  expandSillyTavernMacros,
  type PresetMacroContext,
} from "./macros.js";

export function renderPromptPresetBlocks(
  blocks: PromptBlock[],
  macroContext: PresetMacroContext,
): CoreMessage[] {
  const scope = createMacroScope(macroContext);
  return [...blocks]
    .filter((block) => block.enabled && block.stackIndex !== null)
    .sort((a, b) => (a.stackIndex ?? 0) - (b.stackIndex ?? 0))
    .filter((block) => block.content.trim().length > 0)
    .map((block) => ({
      role: block.role,
      content: expandSillyTavernMacros(block.content, scope),
    }));
}
```

- [ ] **Step 6: Extend snapshot and builder**

Modify `packages/server/src/ai/context-builder/snapshot.ts`:

```ts
import type { PromptBlock, ReaderIssue } from "@scribe/shared";
```

Add to `BookSnapshot`:

```ts
promptBlocks: PromptBlock[];
readerIssues: ReaderIssue[];
```

Add optional repos to `SnapshotRepos`:

```ts
promptPresetsRepo?: {
  listPresets(opts?: { enabledOnly?: boolean }): { id: string }[];
  listBlocks(presetId: string, opts?: { enabledOnly?: boolean }): PromptBlock[];
};
readerIssuesRepo?: {
  listOpen(): ReaderIssue[];
};
```

In `loadBookSnapshot`, compute:

```ts
const activePreset = repos.promptPresetsRepo?.listPresets({ enabledOnly: true })[0];
const promptBlocks = activePreset
  ? repos.promptPresetsRepo?.listBlocks(activePreset.id, { enabledOnly: true }) ?? []
  : [];
```

Return:

```ts
promptBlocks,
readerIssues: repos.readerIssuesRepo?.listOpen() ?? [],
```

Modify `packages/server/src/ai/context-builder/builder.ts`:

- import `renderPromptPresetBlocks`;
- call it before fitting static/worldbook/dynamic sections;
- create current local date/time with `new Date()`;
- prepend rendered preset messages after `SYSTEM_PROMPT` and before fitted context messages.

Use this message order:

```ts
const messages: CoreMessage[] = [
  { role: "system", content: SYSTEM_PROMPT },
  ...presetMessages,
  ...orderedKept.map((s) => ({ role: "user" as const, content: s.text })),
];
```

- [ ] **Step 7: Run GREEN**

Run:

```bash
pnpm --filter @scribe/server test -- macros.test.ts render.test.ts preset-context.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/ai/presets packages/server/src/ai/context-builder/snapshot.ts packages/server/src/ai/context-builder/builder.ts packages/server/tests/unit/ai/presets/macros.test.ts packages/server/tests/unit/ai/presets/render.test.ts packages/server/tests/unit/ai/context-builder/preset-context.test.ts
git commit -m "feat: compile imported prompt presets into writing context"
```

## Task 5B: Regex Scripts And Advanced Worldbook Matching

**Files:**
- Create: `packages/server/src/ai/presets/regex-scripts.ts`
- Modify: `packages/server/src/ai/worldbook/retrieval.ts`
- Test: `packages/server/tests/unit/ai/presets/regex-scripts.test.ts`
- Test: `packages/server/tests/unit/ai/worldbook/sillytavern-retrieval.test.ts`

- [ ] **Step 1: Write failing regex script tests**

Create `packages/server/tests/unit/ai/presets/regex-scripts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { applySillyTavernRegexScripts } from "../../../../src/ai/presets/regex-scripts.js";

describe("SillyTavern regex scripts", () => {
  it("applies enabled prompt scripts and skips disabled scripts", () => {
    const result = applySillyTavernRegexScripts("bad phrase and keep", [{
      id: "r1",
      scriptName: "ban phrase",
      findRegex: "/bad phrase/g",
      replaceString: "better phrase",
      disabled: false,
      promptOnly: true,
      markdownOnly: false,
      minDepth: null,
      maxDepth: null,
    }, {
      id: "r2",
      scriptName: "disabled",
      findRegex: "/keep/g",
      replaceString: "drop",
      disabled: true,
      promptOnly: true,
    }], { target: "prompt", depth: 0 });

    expect(result.text).toBe("better phrase and keep");
    expect(result.applied.map((item) => item.scriptName)).toEqual(["ban phrase"]);
  });

  it("respects depth bounds", () => {
    const result = applySillyTavernRegexScripts("alpha", [{
      id: "r1",
      scriptName: "too deep",
      findRegex: "/alpha/g",
      replaceString: "beta",
      disabled: false,
      promptOnly: true,
      minDepth: 2,
      maxDepth: 4,
    }], { target: "prompt", depth: 1 });
    expect(result.text).toBe("alpha");
    expect(result.applied).toEqual([]);
  });
});
```

- [ ] **Step 2: Write failing advanced retrieval tests**

Create `packages/server/tests/unit/ai/worldbook/sillytavern-retrieval.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { WorldbookEntry } from "@scribe/shared";
import { retrieveWorldbookEntries } from "../../../../src/ai/worldbook/retrieval.js";

function entry(
  id: string,
  patch: Partial<WorldbookEntry> & Pick<WorldbookEntry, "title" | "content">,
): WorldbookEntry {
  return {
    id,
    title: patch.title,
    content: patch.content,
    enabled: patch.enabled ?? true,
    activation: patch.activation ?? "triggered",
    keys: patch.keys ?? [],
    secondaryKeys: patch.secondaryKeys ?? [],
    constant: patch.constant ?? false,
    priority: patch.priority ?? 0,
    insertionDepth: patch.insertionDepth ?? 0,
    recursive: patch.recursive ?? false,
    recursionLimit: patch.recursionLimit ?? 0,
    tokenBudget: patch.tokenBudget ?? null,
    category: patch.category ?? null,
    metadata: patch.metadata ?? {},
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("SillyTavern-compatible worldbook retrieval", () => {
  it("requires secondary keys for selective entries", () => {
    const result = retrieveWorldbookEntries({
      entries: [entry("sel", {
        title: "Selective",
        content: "Only with both keys.",
        keys: ["capture"],
        secondaryKeys: ["boss"],
        metadata: { sillytavern: { selective: true } },
      })],
      query: "capture",
      extraText: [],
    });
    expect(result.selected).toEqual([]);

    const both = retrieveWorldbookEntries({
      entries: [entry("sel", {
        title: "Selective",
        content: "Only with both keys.",
        keys: ["capture"],
        secondaryKeys: ["boss"],
        metadata: { sillytavern: { selective: true } },
      })],
      query: "capture the boss",
    });
    expect(both.selected.map((item) => item.entry.id)).toEqual(["sel"]);
  });

  it("supports whole-word and case-sensitive matching", () => {
    const result = retrieveWorldbookEntries({
      entries: [entry("case", {
        title: "Case",
        content: "Case sensitive.",
        keys: ["AAB"],
        metadata: { sillytavern: { caseSensitive: true, matchWholeWords: true } },
      })],
      query: "aab AABX",
    });
    expect(result.selected).toEqual([]);

    const exact = retrieveWorldbookEntries({
      entries: [entry("case", {
        title: "Case",
        content: "Case sensitive.",
        keys: ["AAB"],
        metadata: { sillytavern: { caseSensitive: true, matchWholeWords: true } },
      })],
      query: "AAB arrived",
    });
    expect(exact.selected.map((item) => item.entry.id)).toEqual(["case"]);
  });

  it("returns trigger diagnostics explaining matches", () => {
    const result = retrieveWorldbookEntries({
      entries: [entry("w", { title: "World", content: "Rules.", keys: ["world"] })],
      query: "world",
    });
    expect(result.selected[0]!.matchedKeys).toEqual(["world"]);
    expect(result.selected[0]!.reason).toBe("trigger");
  });
});
```

- [ ] **Step 3: Run RED**

Run:

```bash
pnpm --filter @scribe/server test -- regex-scripts.test.ts sillytavern-retrieval.test.ts
```

Expected: FAIL because regex script module and advanced matching are missing.

- [ ] **Step 4: Implement regex scripts**

Create `packages/server/src/ai/presets/regex-scripts.ts`:

```ts
export interface SillyTavernRegexScript {
  id?: string;
  scriptName?: string;
  findRegex?: string;
  replaceString?: string;
  disabled?: boolean;
  promptOnly?: boolean;
  markdownOnly?: boolean;
  minDepth?: number | null;
  maxDepth?: number | null;
}

export function parseRegex(value: string | undefined): RegExp | undefined {
  if (!value) return undefined;
  const match = value.match(/^\/(.+)\/([a-z]*)$/i);
  if (match) return new RegExp(match[1]!, match[2] ?? "");
  return new RegExp(value, "g");
}

export function applySillyTavernRegexScripts(
  text: string,
  scripts: SillyTavernRegexScript[],
  opts: { target: "prompt" | "output"; depth: number },
): { text: string; applied: Array<{ id?: string; scriptName?: string }> } {
  let next = text;
  const applied: Array<{ id?: string; scriptName?: string }> = [];
  for (const script of scripts) {
    if (script.disabled) continue;
    if (opts.target === "output" && script.promptOnly) continue;
    if (script.minDepth != null && opts.depth < script.minDepth) continue;
    if (script.maxDepth != null && opts.depth > script.maxDepth) continue;
    const regex = parseRegex(script.findRegex);
    if (!regex) continue;
    const replaced = next.replace(regex, script.replaceString ?? "");
    if (replaced !== next) applied.push({ id: script.id, scriptName: script.scriptName });
    next = replaced;
  }
  return { text: next, applied };
}
```

- [ ] **Step 5: Extend worldbook retrieval**

Modify `packages/server/src/ai/worldbook/retrieval.ts`:

- read `entry.metadata.sillytavern` as a record;
- when `selective === true`, require at least one primary key and one secondary key match;
- when `caseSensitive === true`, skip lowercasing;
- when `matchWholeWords === true`, use ASCII word boundaries for ASCII keys and exact substring for non-ASCII keys;
- preserve `matchedKeys` and `reason` diagnostics already returned;
- if `useProbability === true` and `probability < 100`, use deterministic hash of `entry.id + query` to decide inclusion so tests are stable;
- keep existing constant, trigger, recursion, priority, and budget behavior passing.

- [ ] **Step 6: Run GREEN**

Run:

```bash
pnpm --filter @scribe/server test -- regex-scripts.test.ts sillytavern-retrieval.test.ts retrieval.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/ai/presets/regex-scripts.ts packages/server/src/ai/worldbook/retrieval.ts packages/server/tests/unit/ai/presets/regex-scripts.test.ts packages/server/tests/unit/ai/worldbook/sillytavern-retrieval.test.ts
git commit -m "feat: support sillytavern regex and advanced worldbook matching"
```

## Task 6: Reader Continuity Issues In Audit And Writing Context

**Files:**
- Modify: `packages/server/src/ai/orchestrator/audit-persist.ts`
- Modify: `packages/server/src/ai/context-builder/builder.ts`
- Test: `packages/server/tests/unit/ai/context-builder/reader-issues-context.test.ts`
- Test: `packages/server/tests/integration/audit-persistence.test.ts`

- [ ] **Step 1: Write failing reader issue context test**

Create `packages/server/tests/unit/ai/context-builder/reader-issues-context.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { BookSnapshot } from "../../../../src/ai/context-builder/snapshot.js";
import { buildWriteContext } from "../../../../src/ai/context-builder/builder.js";

describe("reader issue context", () => {
  it("injects open reader-continuity issues into later writing context", () => {
    const snapshot: BookSnapshot = {
      bookId: "book-1",
      meta: { title: "Tide Book", premise: "" },
      rulesMd: "",
      characters: [],
      outline: [],
      activeForeshadowing: [],
      paidForeshadowing: [],
      recentSummaries: [],
      allSummaries: [],
      genreSections: [],
      worldbookEntries: [],
      promptBlocks: [],
      readerIssues: [{
        id: "issue-1",
        chapterNo: 4,
        type: "continuity",
        severity: "warning",
        note: "Old Wei agreed to travel with them but vanished in the next chapter.",
        evidence: "Chapter 3 joins; chapter 4 omits him.",
        suggestedAction: "Explain where he went or show him present.",
        status: "open",
        createdAt: 1,
        updatedAt: 1,
      }],
    };

    const result = buildWriteContext({
      snapshot,
      currentChapterNo: 5,
      intent: { characters: [], foreshadowing: [], userMessage: "Continue." },
    });

    const joined = result.messages.map((m) => String(m.content)).join("\n");
    expect(joined).toContain("Reader Continuity Issues");
    expect(joined).toContain("Old Wei agreed");
    expect(joined).toContain("Explain where he went");
  });
});
```

- [ ] **Step 2: Add failing audit persistence assertion**

Modify `packages/server/tests/integration/audit-persistence.test.ts` or add a focused unit test if the integration fixture is large. The test should call `persistAuditResult` with a warning issue and assert `readerIssuesRepo.listOpen()` contains one issue.

Use this issue shape:

```ts
{
  dimension: "character_behavior",
  severity: "warning",
  score: 6,
  note: "The protagonist uses a credential trick that has not been prepared.",
  excerpt: "He showed the expired credential.",
}
```

Expected reader issue:

```ts
expect(handle.readerIssuesRepo.listOpen()[0]).toMatchObject({
  chapterNo: 12,
  type: "character_behavior",
  severity: "warning",
  status: "open",
});
```

- [ ] **Step 3: Run RED**

Run:

```bash
pnpm --filter @scribe/server test -- reader-issues-context.test.ts audit-persistence.test.ts
```

Expected: context test FAIL because issues are not rendered; audit test FAIL because persistence ignores reader issues.

- [ ] **Step 4: Render reader issue block**

Modify `packages/server/src/ai/context-builder/builder.ts`:

```ts
function renderReaderIssues(issues: BookSnapshot["readerIssues"]): string {
  const open = issues.filter((issue) => issue.status === "open" || issue.status === "injected");
  if (!open.length) return "";
  const parts = ["## Reader Continuity Issues"];
  parts.push("These are reader-facing continuity or quality debts. Address them on page, explicitly defer them, or avoid worsening them.");
  for (const issue of open) {
    parts.push(`- [${issue.severity}/${issue.type}] Chapter ${issue.chapterNo}: ${issue.note}`);
    if (issue.evidence) parts.push(`  Evidence: ${issue.evidence}`);
    if (issue.suggestedAction) parts.push(`  Suggested action: ${issue.suggestedAction}`);
  }
  return parts.join("\n");
}
```

Add a high-priority section after worldbook and before dynamic:

```ts
const readerIssueBlock = renderReaderIssues(opts.snapshot.readerIssues);
...
...(readerIssueBlock ? [{ id: "reader-issues", priority: 94, text: readerIssueBlock }] : []),
```

- [ ] **Step 5: Persist audit warnings**

Modify `packages/server/src/ai/orchestrator/audit-persist.ts` so `persistAuditResult` accepts an optional `readerIssuesRepo` or extend the existing call sites to pass the repo.

Mapping:

```ts
const typeMap = {
  setting_consistency: "setting_consistency",
  character_behavior: "character_behavior",
  pacing: "pacing",
  narrative_coherence: "narrative_perspective",
  foreshadowing: "foreshadowing",
  hook_strength: "pacing",
  aesthetic_quality: "style_drift",
} as const;
```

For each audit issue with `severity !== "ok"`, create a reader issue:

```ts
readerIssuesRepo.create({
  chapterNo,
  type: typeMap[issue.dimension] ?? "continuity",
  severity: issue.severity,
  note: issue.note,
  evidence: issue.excerpt ?? null,
  suggestedAction: null,
  status: "open",
});
```

- [ ] **Step 6: Run GREEN**

Run:

```bash
pnpm --filter @scribe/server test -- reader-issues-context.test.ts audit-persistence.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/ai/context-builder/builder.ts packages/server/src/ai/orchestrator/audit-persist.ts packages/server/tests/unit/ai/context-builder/reader-issues-context.test.ts packages/server/tests/integration/audit-persistence.test.ts
git commit -m "feat: feed reader continuity issues into writing"
```

## Task 7: Preset And Import HTTP Management

**Files:**
- Create: `packages/server/src/http/routes/presets.ts`
- Modify: `packages/server/src/http/server.ts`
- Test: `packages/server/tests/integration/preset-routes.test.ts`

- [ ] **Step 1: Write failing route tests**

Create `packages/server/tests/integration/preset-routes.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createBookRegistry } from "../../src/http/book-registry.js";
import { createApp } from "../../src/http/server.js";

const json = <T>(res: Response): Promise<T> => res.json() as Promise<T>;
let tmp: string;
let registry: ReturnType<typeof createBookRegistry>;
let app: ReturnType<typeof createApp>;
let bookId: string;

function makePaths(root: string) {
  return {
    appRoot: root,
    libraryDb: path.posix.join(root, "library.db"),
    booksDir: path.posix.join(root, "books"),
    backupsDir: path.posix.join(root, "backups"),
    secretsEnv: path.posix.join(root, "secrets.env"),
    configJson: path.posix.join(root, "config.json"),
    bookDir: (id: string) => path.posix.join(root, "books", id),
    workspaceDb: (id: string) => path.posix.join(root, "books", id, "workspace.db"),
    chaptersDir: (id: string) => path.posix.join(root, "books", id, "chapters"),
    rulesMd: (id: string) => path.posix.join(root, "books", id, "rules.md"),
    exportsDir: (id: string) => path.posix.join(root, "books", id, "exports"),
    bookBackupsDir: (id: string) => path.posix.join(root, "backups", id),
  };
}

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scribe-preset-routes-"));
  const paths = makePaths(tmp);
  fs.mkdirSync(paths.booksDir, { recursive: true });
  registry = createBookRegistry({ paths });
  app = createApp({ bookRegistry: registry });
  const create = await app.request("/api/books", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Preset routes" }),
  });
  bookId = ((await create.json()) as { id: string }).id;
});

afterEach(() => {
  registry.closeAll();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("preset routes", () => {
  it("lists presets and toggles prompt blocks", async () => {
    const preset = registry.open(bookId).promptPresetsRepo.createPreset({ name: "Imported", enabled: true });
    const block = registry.open(bookId).promptPresetsRepo.createBlock({
      presetId: preset.id,
      sourceIdentifier: "main",
      name: "Main",
      role: "system",
      content: "Write well.",
      enabled: true,
      stackIndex: 0,
      injectionPosition: 0,
      injectionDepth: 4,
      injectionOrder: 100,
      systemPrompt: false,
      marker: false,
      forbidOverrides: false,
      injectionTrigger: [],
      sourcePromptEnabled: true,
      sourceOrderEnabled: true,
      metadata: {},
    });

    const list = await app.request(`/api/books/${bookId}/presets`);
    expect(list.status).toBe(200);
    const listJson = await json<{ presets: Array<{ id: string; blocks: Array<{ id: string }> }> }>(list);
    expect(listJson.presets[0]!.blocks[0]!.id).toBe(block.id);

    const update = await app.request(`/api/books/${bookId}/presets/${preset.id}/blocks/${block.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    expect(update.status).toBe(200);
    expect(registry.open(bookId).promptPresetsRepo.listBlocks(preset.id)[0]!.enabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run RED**

Run:

```bash
pnpm --filter @scribe/server test -- preset-routes.test.ts
```

Expected: FAIL with 404.

- [ ] **Step 3: Implement preset routes**

Create `packages/server/src/http/routes/presets.ts`:

```ts
import { Hono } from "hono";
import type { BookRegistry } from "../book-registry.js";

export function presetRoutes(deps: { registry: BookRegistry }) {
  const app = new Hono();

  function openHandle(bookId: string) {
    const book = deps.registry.booksRepo.get(bookId);
    return book ? deps.registry.open(bookId) : undefined;
  }

  app.get("/api/books/:bookId/presets", async (c) => {
    const handle = openHandle(c.req.param("bookId"));
    if (!handle) return c.json({ error: "book_not_found" }, 404);
    const presets = handle.promptPresetsRepo.listPresets().map((preset) => ({
      ...preset,
      blocks: handle.promptPresetsRepo.listBlocks(preset.id),
    }));
    return c.json({ presets });
  });

  app.put("/api/books/:bookId/presets/:presetId", async (c) => {
    const handle = openHandle(c.req.param("bookId"));
    if (!handle) return c.json({ error: "book_not_found" }, 404);
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const patch: { enabled?: boolean; name?: string } = {};
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
    if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
    return c.json({ preset: handle.promptPresetsRepo.updatePreset(c.req.param("presetId"), patch) });
  });

  app.put("/api/books/:bookId/presets/:presetId/blocks/:blockId", async (c) => {
    const handle = openHandle(c.req.param("bookId"));
    if (!handle) return c.json({ error: "book_not_found" }, 404);
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const patch: { enabled?: boolean; stackIndex?: number; name?: string; content?: string } = {};
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
    if (typeof body.stackIndex === "number") patch.stackIndex = body.stackIndex;
    if (typeof body.name === "string") patch.name = body.name;
    if (typeof body.content === "string") patch.content = body.content;
    return c.json({ block: handle.promptPresetsRepo.updateBlock(c.req.param("blockId"), patch) });
  });

  return app;
}
```

Mount in `server.ts`:

```ts
import { presetRoutes } from "./routes/presets.js";
...
app.route("/", presetRoutes({ registry: deps.bookRegistry }));
```

- [ ] **Step 4: Run GREEN**

Run:

```bash
pnpm --filter @scribe/server test -- preset-routes.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/http/routes/presets.ts packages/server/src/http/server.ts packages/server/tests/integration/preset-routes.test.ts
git commit -m "feat: expose prompt preset management api"
```

## Task 8: Frontend Import, Preset, And Worldbook Control Panels

**Files:**
- Modify: `packages/client/src/api/client.ts`
- Create: `packages/client/src/components/import/import-dialog.tsx`
- Create: `packages/client/src/components/presets/preset-panel.tsx`
- Modify: `packages/client/src/components/sidebar/side-panel.tsx`
- Test: `packages/client/tests/components/import-dialog.test.tsx`
- Test: `packages/client/tests/components/preset-panel.test.tsx`

- [ ] **Step 1: Write failing import dialog test**

Create `packages/client/tests/components/import-dialog.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ImportDialog } from "../../src/components/import/import-dialog.js";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

function jsonResponse(data: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => data } as Response;
}

describe("ImportDialog", () => {
  it("previews and imports a SillyTavern worldbook JSON file", async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      calls.push([String(url), init]);
      if (String(url).endsWith("/preview")) {
        return jsonResponse({
          sourceType: "sillytavern_worldbook",
          sourceName: "Worldbook",
          stats: { entryCount: 38, constantCount: 7 },
          warnings: [],
        });
      }
      return jsonResponse({
        sourceType: "sillytavern_worldbook",
        imported: { worldbookEntries: 38, promptPresets: 0, promptBlocks: 0 },
      }, 201);
    });

    render(<ImportDialog bookId="book-1" onImported={() => undefined} />);
    const file = new File([JSON.stringify({ entries: {} })], "worldbook.json", { type: "application/json" });
    fireEvent.change(screen.getByTestId("import-file"), { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText("sillytavern_worldbook")).toBeInTheDocument());
    expect(screen.getByText(/38/)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("import-confirm"));
    await waitFor(() => {
      expect(calls.some(([url]) => url.endsWith("/imports"))).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Write failing preset panel test**

Create `packages/client/tests/components/preset-panel.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PresetPanel } from "../../src/components/presets/preset-panel.js";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

function jsonResponse(data: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => data } as Response;
}

describe("PresetPanel", () => {
  it("lists imported prompt blocks and toggles a block", async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      calls.push([String(url), init]);
      if (init?.method === "PUT") {
        return jsonResponse({ block: { id: "b1", enabled: false } });
      }
      return jsonResponse({
        presets: [{
          id: "p1",
          name: "Izumi",
          enabled: true,
          blocks: [{
            id: "b1",
            name: "Main",
            sourceIdentifier: "main",
            role: "system",
            enabled: true,
            stackIndex: 0,
            content: "Write well.",
            sourcePromptEnabled: false,
            sourceOrderEnabled: true,
          }],
        }],
      });
    });

    render(<PresetPanel bookId="book-1" />);
    await waitFor(() => expect(screen.getByText("Izumi")).toBeInTheDocument());
    expect(screen.getByText("Main")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("preset-block-toggle-b1"));
    await waitFor(() => {
      const put = calls.find((call) => call[1]?.method === "PUT");
      expect(put).toBeTruthy();
      expect(JSON.parse(put![1]!.body as string).enabled).toBe(false);
    });
  });
});
```

- [ ] **Step 3: Run RED**

Run:

```bash
pnpm --filter @scribe/client test -- import-dialog.test.tsx preset-panel.test.tsx
```

Expected: FAIL because the components and API helpers do not exist.

- [ ] **Step 4: Add client API types and calls**

Modify `packages/client/src/api/client.ts`:

```ts
export interface ImportPreview {
  sourceType: string;
  sourceName: string;
  stats: Record<string, unknown>;
  warnings: Array<{ code: string; message: string; path?: string }>;
}

export interface ImportResult {
  sourceType: string;
  imported: { promptPresets: number; promptBlocks: number; worldbookEntries: number };
}

export interface PromptBlock {
  id: string;
  name: string;
  sourceIdentifier: string;
  role: "system" | "user" | "assistant";
  content: string;
  enabled: boolean;
  stackIndex: number | null;
  sourcePromptEnabled: boolean | null;
  sourceOrderEnabled: boolean | null;
}

export interface PromptPreset {
  id: string;
  name: string;
  enabled: boolean;
  blocks: PromptBlock[];
}
```

Add API methods:

```ts
async previewImport(bookId: string, input: { filename: string; json: unknown }): Promise<ImportPreview> {
  return jsonFetch<ImportPreview>(`/api/books/${encodeURIComponent(bookId)}/imports/preview`, {
    method: "POST",
    body: JSON.stringify(input),
  });
},
async importJson(bookId: string, input: { filename: string; json: unknown }): Promise<ImportResult> {
  return jsonFetch<ImportResult>(`/api/books/${encodeURIComponent(bookId)}/imports`, {
    method: "POST",
    body: JSON.stringify(input),
  });
},
async listPresets(bookId: string): Promise<PromptPreset[]> {
  const r = await jsonFetch<{ presets: PromptPreset[] }>(`/api/books/${encodeURIComponent(bookId)}/presets`);
  return r.presets;
},
async updatePromptBlock(bookId: string, presetId: string, blockId: string, patch: Partial<PromptBlock>): Promise<PromptBlock> {
  const r = await jsonFetch<{ block: PromptBlock }>(
    `/api/books/${encodeURIComponent(bookId)}/presets/${encodeURIComponent(presetId)}/blocks/${encodeURIComponent(blockId)}`,
    { method: "PUT", body: JSON.stringify(patch) },
  );
  return r.block;
},
```

- [ ] **Step 5: Implement import dialog**

Create `packages/client/src/components/import/import-dialog.tsx`:

```tsx
import { useState } from "react";
import { api, type ImportPreview } from "../../api/client.js";

export function ImportDialog(props: { bookId: string; onImported: () => void }) {
  const [filename, setFilename] = useState("");
  const [json, setJson] = useState<unknown>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File | undefined) {
    setError(null);
    setPreview(null);
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      setFilename(file.name);
      setJson(parsed);
      setPreview(await api.previewImport(props.bookId, { filename: file.name, json: parsed }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function confirm() {
    if (!filename) return;
    await api.importJson(props.bookId, { filename, json });
    props.onImported();
  }

  return (
    <section data-testid="import-dialog">
      {error && <p role="alert">{error}</p>}
      <input
        data-testid="import-file"
        type="file"
        accept="application/json,.json"
        onChange={(event) => void onFile(event.target.files?.[0])}
      />
      {preview && (
        <div>
          <strong>{preview.sourceType}</strong>
          <p>{preview.sourceName}</p>
          <pre>{JSON.stringify(preview.stats, null, 2)}</pre>
          {preview.warnings.map((warning) => (
            <p key={`${warning.code}-${warning.path ?? ""}`}>{warning.code}: {warning.message}</p>
          ))}
          <button data-testid="import-confirm" onClick={() => void confirm()}>
            Import
          </button>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 6: Implement preset panel**

Create `packages/client/src/components/presets/preset-panel.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { api, type PromptPreset } from "../../api/client.js";

export function PresetPanel(props: { bookId: string }) {
  const [presets, setPresets] = useState<PromptPreset[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setPresets(await api.listPresets(props.bookId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [props.bookId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function toggleBlock(presetId: string, blockId: string, enabled: boolean) {
    await api.updatePromptBlock(props.bookId, presetId, blockId, { enabled });
    await reload();
  }

  return (
    <section data-testid="preset-panel">
      {error && <p role="alert">{error}</p>}
      <strong>Prompt Presets</strong>
      {presets.map((preset) => (
        <div key={preset.id}>
          <h3>{preset.name}</h3>
          {preset.blocks
            .slice()
            .sort((a, b) => (a.stackIndex ?? 999999) - (b.stackIndex ?? 999999))
            .map((block) => (
              <article key={block.id}>
                <label>
                  <input
                    data-testid={`preset-block-toggle-${block.id}`}
                    type="checkbox"
                    checked={block.enabled}
                    onChange={(event) => void toggleBlock(preset.id, block.id, event.target.checked)}
                  />
                  {block.name}
                </label>
                <p>{block.role} / {block.sourceIdentifier}</p>
                {block.sourcePromptEnabled !== block.sourceOrderEnabled && (
                  <p>prompt/order enabled mismatch</p>
                )}
                <pre>{block.content.slice(0, 500)}</pre>
              </article>
            ))}
        </div>
      ))}
    </section>
  );
}
```

- [ ] **Step 7: Add edit and debug controls**

Extend `PresetPanel` and the existing `WorldbookPanel` so users can:

- edit prompt block content;
- toggle prompt blocks;
- inspect source identifier, role, stack index, prompt enabled/order enabled mismatch;
- inspect imported generation settings and regex script count;
- edit worldbook keys, secondary keys, priority, insertion depth, recursion,
  probability metadata, and matching behavior metadata;
- run worldbook preview and show `matchedKeys`, `reason`, and `recursionDepth`.

Add focused assertions to `preset-panel.test.tsx` and `worldbook-panel.test.tsx`
that verify an edited prompt block and edited worldbook trigger metadata are sent
to the API.

- [ ] **Step 8: Add sidebar access**

Modify `packages/client/src/components/sidebar/side-panel.tsx` to include:

- an import section that renders `ImportDialog`;
- a preset section that renders `PresetPanel`;
- preserve the existing worldbook panel.

Use labels consistent with the existing UI language. Keep the UI dense and utilitarian.

- [ ] **Step 9: Run GREEN**

Run:

```bash
pnpm --filter @scribe/client test -- import-dialog.test.tsx preset-panel.test.tsx worldbook-panel.test.tsx
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/client/src/api/client.ts packages/client/src/components/import/import-dialog.tsx packages/client/src/components/presets/preset-panel.tsx packages/client/src/components/sidebar/side-panel.tsx packages/client/tests/components/import-dialog.test.tsx packages/client/tests/components/preset-panel.test.tsx
git commit -m "feat: add sillytavern import and control ui"
```

## Task 9: Real Sample And Long-Form Continuity Verification

**Files:**
- Create: `packages/server/tools/verify-sillytavern-import.ts`
- Create: `packages/server/tools/monitor-sillytavern-longform.ts`

- [ ] **Step 1: Write verification tool**

Create `packages/server/tools/verify-sillytavern-import.ts`:

```ts
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createBookRegistry } from "../src/http/book-registry.js";
import { createApp } from "../src/http/server.js";
import { buildWriteContext } from "../src/ai/context-builder/builder.js";
import { loadBookSnapshot } from "../src/ai/context-builder/snapshot.js";

const presetPath = process.argv[2] ?? "C:/Users/Administrator/Desktop/novel/Izumi 0503.json";
const worldbookPath = process.argv[3] ?? "C:/Users/Administrator/Desktop/novel/宠物捕捉系统-世界书.json";

function makePaths(root: string) {
  return {
    appRoot: root,
    libraryDb: path.posix.join(root, "library.db"),
    booksDir: path.posix.join(root, "books"),
    backupsDir: path.posix.join(root, "backups"),
    secretsEnv: path.posix.join(root, "secrets.env"),
    configJson: path.posix.join(root, "config.json"),
    bookDir: (id: string) => path.posix.join(root, "books", id),
    workspaceDb: (id: string) => path.posix.join(root, "books", id, "workspace.db"),
    chaptersDir: (id: string) => path.posix.join(root, "books", id, "chapters"),
    rulesMd: (id: string) => path.posix.join(root, "books", id, "rules.md"),
    exportsDir: (id: string) => path.posix.join(root, "books", id, "exports"),
    bookBackupsDir: (id: string) => path.posix.join(root, "backups", id),
  };
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scribe-sillytavern-verify-"));
  const paths = makePaths(root);
  fs.mkdirSync(paths.booksDir, { recursive: true });
  const registry = createBookRegistry({ paths });
  const app = createApp({ bookRegistry: registry });
  try {
    const create = await app.request("/api/books", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "SillyTavern Import Verification", genre: "verification" }),
    });
    const book = await create.json() as { id: string };

    for (const file of [presetPath, worldbookPath]) {
      const json = JSON.parse(fs.readFileSync(file, "utf8"));
      const res = await app.request(`/api/books/${book.id}/imports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: path.basename(file), json }),
      });
      if (res.status !== 201) throw new Error(`${file} import failed: ${res.status} ${await res.text()}`);
    }

    const handle = registry.open(book.id);
    const presets = handle.promptPresetsRepo.listPresets();
    const blocks = presets.flatMap((preset) => handle.promptPresetsRepo.listBlocks(preset.id));
    const worldbook = handle.worldbookRepo.list();

    const snapshot = loadBookSnapshot(book.id, {
      charactersRepo: handle.charactersRepo,
      outlineRepo: handle.outlineRepo,
      foreshadowingRepo: handle.foreshadowingRepo,
      chaptersRepo: handle.chaptersRepo,
      genreSectionsRepo: handle.genreSectionsRepo,
      worldbookRepo: handle.worldbookRepo,
      promptPresetsRepo: handle.promptPresetsRepo,
      readerIssuesRepo: handle.readerIssuesRepo,
      bookMetaRepo: handle.bookMetaRepo,
    }, { rulesMd: handle.rulesMdPath });

    const context = buildWriteContext({
      snapshot,
      currentChapterNo: 1,
      intent: { characters: [], foreshadowing: [], records: [], userMessage: "写一章涉及捕捉、天界和状态栏的开篇。" },
    });

    const output = {
      bookId: book.id,
      presetCount: presets.length,
      promptBlockCount: blocks.length,
      enabledPromptBlockCount: blocks.filter((block) => block.enabled && block.stackIndex !== null).length,
      worldbookEntryCount: worldbook.length,
      constantWorldbookCount: worldbook.filter((entry) => entry.constant).length,
      hasPresetContext: context.messages.some((message) => String(message.content).includes("Write") || String(message.content).includes("创作")),
      hasWorldbookContext: context.messages.some((message) => String(message.content).includes("Worldbook")),
      messageCount: context.messages.length,
    };
    console.log(JSON.stringify(output, null, 2));
  } finally {
    registry.closeAll();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Run focused tests and typechecks**

Run:

```bash
pnpm --filter @scribe/shared test -- sillytavern-import.test.ts
pnpm --filter @scribe/server test -- sillytavern-detect.test.ts sillytavern-preset.test.ts sillytavern-worldbook.test.ts import-routes.test.ts preset-routes.test.ts macros.test.ts regex-scripts.test.ts render.test.ts preset-context.test.ts reader-issues-context.test.ts sillytavern-retrieval.test.ts
pnpm --filter @scribe/client test -- import-dialog.test.tsx preset-panel.test.tsx worldbook-panel.test.tsx
pnpm --filter @scribe/server typecheck
pnpm --filter @scribe/client typecheck
```

Expected: all PASS.

- [ ] **Step 3: Run real sample verification**

Run:

```bash
pnpm --filter @scribe/server exec tsx tools/verify-sillytavern-import.ts "C:/Users/Administrator/Desktop/novel/Izumi 0503.json" "C:/Users/Administrator/Desktop/novel/宠物捕捉系统-世界书.json"
```

Expected JSON:

```json
{
  "presetCount": 1,
  "promptBlockCount": 203,
  "enabledPromptBlockCount": 52,
  "worldbookEntryCount": 38,
  "constantWorldbookCount": 7,
  "hasPresetContext": true,
  "hasWorldbookContext": true
}
```

- [ ] **Step 4: Write and run long-form monitor**

Create `packages/server/tools/monitor-sillytavern-longform.ts`.

Required behavior:

- create a new book;
- import both real sample files;
- use the imported preset and worldbook;
- generate at least 15 chapters through the real auto/write flow;
- after each chapter, capture:
  - selected worldbook entries and their trigger reasons;
  - whether preset prompt blocks were included;
  - audit verdict and reader issues;
  - chapter summaries and generic records;
- write a JSON report under `packages/server/tmp/sillytavern-longform-<timestamp>.json`;
- fail the process if fewer than 15 chapters are generated, if imported preset
  blocks are absent from writing context, if zero worldbook entries trigger
  across the run, or if reader issues are not injected after being created.

Run:

```bash
pnpm --filter @scribe/server exec tsx tools/monitor-sillytavern-longform.ts "C:/Users/Administrator/Desktop/novel/Izumi 0503.json" "C:/Users/Administrator/Desktop/novel/宠物捕捉系统-世界书.json"
```

Expected: PASS report with `chapterCount >= 15`, `presetInjected: true`,
`worldbookTriggerCount > 0`, and `readerIssueInjectionCount > 0` when audit
produces warning/critical issues.

- [ ] **Step 5: Run broader regression**

Run:

```bash
pnpm --filter @scribe/server test
pnpm --filter @scribe/client test
pnpm -r exec tsc --noEmit
```

Expected: all PASS.

- [ ] **Step 5: Commit**
- [ ] **Step 6: Commit**

```bash
git add packages/server/tools/verify-sillytavern-import.ts packages/server/tools/monitor-sillytavern-longform.ts
git commit -m "test: verify sillytavern imports in longform writing"
```

## Self-Review

Spec coverage:

- Raw import preservation is covered by Tasks 1, 2, and 4.
- Prompt preset stack is covered by Tasks 1, 2, 3, 5, 7, and 8.
- `prompt_order` as source of active enablement is covered by Tasks 3 and 4.
- Worldbook import and metadata preservation is covered by Tasks 3 and 4.
- Writing context injection is covered by Tasks 5 and 6.
- Reader-continuity writing-quality loop is covered by Task 6.
- UI import/preset/worldbook management is covered by Task 8.
- Real sample and 15+ chapter continuity validation is covered by Task 9.

Placeholder scan:

- The plan contains no `TBD`, no `TODO`, and no unspecified test step.
- Regex execution, scoped macros, advanced worldbook matching, and long-form
  continuity verification are in scope for this plan.

Type consistency:

- Shared names are consistent: `ImportArtifact`, `PromptPreset`, `PromptBlock`, `ReaderIssue`.
- Repository names are consistent: `importArtifactsRepo`, `promptPresetsRepo`, `readerIssuesRepo`.
- Context names are consistent: `promptBlocks`, `readerIssues`, `renderPromptPresetBlocks`.
