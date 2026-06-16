# Worldbook-Driven Writing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a generic worldbook layer that lets AI and users refine stable novel settings before drafting, retrieves always-on and triggered entries with bounded recursion before each AI call, and keeps chapter-end runtime state recording separate from stable settings.

**Architecture:** Add a per-book `worldbook_entries` store in the workspace DB, expose CRUD and AI-assisted setting chat APIs, and add a retrieval engine that selects always-on entries plus keyword-triggered entries with priority, depth, recursion, and token limits. Writing context will inject retrieved worldbook entries before dynamic chapter context; chapter-end record-state remains the runtime state recorder.

**Tech Stack:** TypeScript, Hono, SQLite/better-sqlite3 migrations and repositories, Vercel AI SDK tools, React, Vitest.

---

## File Structure

- Create `packages/shared/src/types/worldbook.ts`: shared zod schemas and TypeScript types for entries, activation modes, recursion settings, and retrieval results.
- Modify `packages/shared/src/index.ts`: export worldbook types.
- Create `packages/server/src/db/migrations/workspace/0008_worldbook.sql`: workspace table for worldbook entries.
- Create `packages/server/src/db/repositories/worldbook.ts`: CRUD, list, upsert, and timestamp handling.
- Modify `packages/server/src/http/book-registry.ts`: attach `worldbookRepo` to `BookHandle`.
- Create `packages/server/src/ai/worldbook/retrieval.ts`: deterministic retrieval engine with always-on entries, trigger matching, recursive expansion, priority sorting, depth buckets, and token budget trimming.
- Create `packages/server/src/ai/worldbook/render.ts`: render retrieved entries into prompt sections by insertion depth.
- Create `packages/server/src/ai/tools/worldbook-tools.ts`: AI tools for creating/updating worldbook entries during setting chat.
- Modify `packages/server/src/ai/tools/registry.ts`: include worldbook tools where setting/onboard conversations need them.
- Create `packages/server/src/ai/prompts/worldbook-chat.ts`: prompt for setting-only conversation that writes worldbook entries, not prose.
- Create `packages/server/src/ai/orchestrator/worldbook-chat.ts`: SSE orchestrator for setting chat persistence and worldbook tool calls.
- Create `packages/server/src/http/routes/worldbook.ts`: CRUD, retrieval preview, and setting chat endpoints.
- Modify `packages/server/src/http/server.ts`: mount worldbook routes.
- Modify `packages/server/src/ai/context-builder/snapshot.ts`: include worldbook entries in `BookSnapshot`.
- Modify `packages/server/src/ai/context-builder/builder.ts`: render retrieved worldbook context into writing messages.
- Modify `packages/server/src/ai/context-builder/book-context.ts`: call worldbook retrieval for each chapter using user intent, latest summaries, characters, foreshadowing, and record labels.
- Modify `packages/server/src/http/routes/books.ts`: initialize `book_meta.title/genre` and seed a minimal always-on worldbook entry from create-book input.
- Modify `packages/server/src/http/routes/auto.ts`: reject `/auto` when neither sufficient worldbook nor structured onboarding context exists.
- Create `packages/client/src/components/worldbook/worldbook-panel.tsx`: minimal list/edit/create UI for entries.
- Modify `packages/client/src/components/sidebar/side-panel.tsx`: add a built-in “世界书” tab.
- Create or modify client API helpers in `packages/client/src/api/client.ts`: worldbook CRUD types and calls.
- Tests:
  - `packages/server/tests/unit/db/repositories/worldbook.test.ts`
  - `packages/server/tests/unit/ai/worldbook/retrieval.test.ts`
  - `packages/server/tests/integration/worldbook-routes.test.ts`
  - `packages/server/tests/unit/ai/context-builder/worldbook-context.test.ts`
  - `packages/client/tests/components/worldbook-panel.test.tsx`

## Task 1: Shared Types And Workspace Persistence

**Files:**
- Create: `packages/shared/src/types/worldbook.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `packages/server/src/db/migrations/workspace/0008_worldbook.sql`
- Create: `packages/server/src/db/repositories/worldbook.ts`
- Modify: `packages/server/src/http/book-registry.ts`
- Test: `packages/server/tests/unit/db/repositories/worldbook.test.ts`

- [ ] **Step 1: Write failing repository tests**

Add tests that create, list, update, and delete entries, including JSON trigger arrays and recursion fields.

- [ ] **Step 2: Run tests to verify RED**

Run: `pnpm --filter @scribe/server test -- db/repositories/worldbook.test.ts`

Expected: FAIL because `worldbook.ts` repository does not exist.

- [ ] **Step 3: Implement shared schemas**

Define `WorldbookEntrySchema` with fields:
`id`, `bookId`, `title`, `content`, `enabled`, `activation`, `keys`, `secondaryKeys`, `constant`, `priority`, `insertionDepth`, `recursive`, `recursionLimit`, `tokenBudget`, `category`, `metadata`, `createdAt`, `updatedAt`.

- [ ] **Step 4: Add migration and repository**

Create `worldbook_entries` with JSON text columns for arrays/metadata and a repository that parses/serializes through shared schemas.

- [ ] **Step 5: Wire registry**

Attach `worldbookRepo` to `BookHandle`.

- [ ] **Step 6: Run repository tests**

Run: `pnpm --filter @scribe/server test -- db/repositories/worldbook.test.ts`

Expected: PASS.

## Task 2: Retrieval Engine With Triggering And Recursion

**Files:**
- Create: `packages/server/src/ai/worldbook/retrieval.ts`
- Create: `packages/server/src/ai/worldbook/render.ts`
- Test: `packages/server/tests/unit/ai/worldbook/retrieval.test.ts`

- [ ] **Step 1: Write failing retrieval tests**

Cover:
- constant entries are always included.
- keyword entries trigger from user intent and latest summary text.
- disabled entries are ignored.
- higher priority sorts first.
- recursive entries can trigger secondary entries from their content.
- recursion stops at `recursionLimit`.
- budget trimming drops lower priority entries first.

- [ ] **Step 2: Run tests to verify RED**

Run: `pnpm --filter @scribe/server test -- ai/worldbook/retrieval.test.ts`

Expected: FAIL because retrieval module does not exist.

- [ ] **Step 3: Implement retrieval**

Use simple deterministic matching first: case-insensitive substring for ASCII and direct substring for Chinese. Return selected entries with `matchedKeys`, `reason`, `recursionDepth`, and `insertionDepth`.

- [ ] **Step 4: Implement rendering**

Render grouped markdown:
`## 世界书(常驻/触发)` then `### [category] title` and content. Preserve depth grouping so later prompt assembly can place deeper entries later if needed.

- [ ] **Step 5: Run retrieval tests**

Run: `pnpm --filter @scribe/server test -- ai/worldbook/retrieval.test.ts`

Expected: PASS.

## Task 3: Worldbook HTTP API And Preview

**Files:**
- Create: `packages/server/src/http/routes/worldbook.ts`
- Modify: `packages/server/src/http/server.ts`
- Test: `packages/server/tests/integration/worldbook-routes.test.ts`

- [ ] **Step 1: Write failing route tests**

Cover:
- `GET /api/books/:bookId/worldbook`
- `POST /api/books/:bookId/worldbook`
- `PUT /api/books/:bookId/worldbook/:entryId`
- `DELETE /api/books/:bookId/worldbook/:entryId`
- `POST /api/books/:bookId/worldbook/preview` returns matched entries for input text.

- [ ] **Step 2: Run tests to verify RED**

Run: `pnpm --filter @scribe/server test -- integration/worldbook-routes.test.ts`

Expected: FAIL with 404.

- [ ] **Step 3: Implement routes**

Use repository methods only. Validate request bodies with shared zod schemas. Return `400` for invalid payloads, `404` for missing book or entry.

- [ ] **Step 4: Mount routes**

Add `app.route("/", worldbookRoutes({ registry: deps.bookRegistry }))` in `server.ts`.

- [ ] **Step 5: Run route tests**

Run: `pnpm --filter @scribe/server test -- integration/worldbook-routes.test.ts`

Expected: PASS.

## Task 4: Write Context Integration

**Files:**
- Modify: `packages/server/src/ai/context-builder/snapshot.ts`
- Modify: `packages/server/src/ai/context-builder/builder.ts`
- Modify: `packages/server/src/ai/context-builder/book-context.ts`
- Test: `packages/server/tests/unit/ai/context-builder/worldbook-context.test.ts`

- [ ] **Step 1: Write failing context tests**

Build a fake snapshot with constant and triggered worldbook entries. Assert `buildChapterWriteMessages` includes matching worldbook content and excludes non-matching trigger-only entries.

- [ ] **Step 2: Run tests to verify RED**

Run: `pnpm --filter @scribe/server test -- ai/context-builder/worldbook-context.test.ts`

Expected: FAIL because snapshot has no worldbook entries and builder does not render them.

- [ ] **Step 3: Extend snapshot**

Add `worldbookEntries` to `BookSnapshot` and `SnapshotRepos`.

- [ ] **Step 4: Retrieve before rendering**

In `buildChapterWriteMessages`, build trigger text from `userIntent`, latest summaries, active characters, active foreshadowing labels, and record labels; call `retrieveWorldbookEntries`.

- [ ] **Step 5: Render worldbook block**

Insert rendered worldbook block after story meta/rules and before dynamic recent-history context.

- [ ] **Step 6: Run context tests**

Run: `pnpm --filter @scribe/server test -- ai/context-builder/worldbook-context.test.ts`

Expected: PASS.

## Task 5: Setting-Only AI Chat

**Files:**
- Create: `packages/server/src/ai/prompts/worldbook-chat.ts`
- Create: `packages/server/src/ai/tools/worldbook-tools.ts`
- Create: `packages/server/src/ai/orchestrator/worldbook-chat.ts`
- Modify: `packages/server/src/http/routes/worldbook.ts`
- Test: `packages/server/tests/integration/worldbook-routes.test.ts`

- [ ] **Step 1: Write failing SSE setting chat test**

Use a stub model that calls `create_worldbook_entry`, then emits text. Assert the entry exists and the SSE stream contains tool events.

- [ ] **Step 2: Run test to verify RED**

Run: `pnpm --filter @scribe/server test -- integration/worldbook-routes.test.ts`

Expected: FAIL because chat endpoint/tools do not exist.

- [ ] **Step 3: Implement prompt and tools**

Prompt must explicitly say: “do not write prose chapters; refine settings and persist stable knowledge to worldbook entries.”

- [ ] **Step 4: Implement orchestrator**

Endpoint: `POST /api/books/:bookId/worldbook/chat`. Persist conversation metadata as `{ kind: "worldbook" }`.

- [ ] **Step 5: Run setting chat tests**

Run: `pnpm --filter @scribe/server test -- integration/worldbook-routes.test.ts`

Expected: PASS.

## Task 6: Create-Book Initialization And Auto Guard

**Files:**
- Modify: `packages/server/src/http/routes/books.ts`
- Modify: `packages/server/src/http/routes/auto.ts`
- Test: `packages/server/tests/integration/books-routes.test.ts`
- Test: `packages/server/tests/integration/auto-mode.test.ts`

- [ ] **Step 1: Write or repair failing tests**

Assert create book writes `book_meta.title/genre` and creates an always-on seed worldbook entry from title/genre. Assert `/auto` returns `409` if both worldbook and structured onboarding are insufficient.

- [ ] **Step 2: Run tests to verify RED**

Run: `pnpm --filter @scribe/server test -- integration/books-routes.test.ts integration/auto-mode.test.ts`

Expected: FAIL on missing initialization and guard.

- [ ] **Step 3: Initialize metadata and seed entry**

After creating a book, open handle and set book meta. If title or genre exists, create/update a constant worldbook entry named “核心书籍设定”.

- [ ] **Step 4: Add guard**

Before `/auto`, load snapshot. Allow if `isOnboardComplete(snapshot).ok` or worldbook has at least one enabled constant entry with non-empty content. Otherwise return `409` with missing reasons and `errorClass: "onboarding_incomplete"`.

- [ ] **Step 5: Run route tests**

Run: `pnpm --filter @scribe/server test -- integration/books-routes.test.ts integration/auto-mode.test.ts`

Expected: PASS.

## Task 7: Minimal Frontend Worldbook Panel

**Files:**
- Create: `packages/client/src/components/worldbook/worldbook-panel.tsx`
- Modify: `packages/client/src/components/sidebar/side-panel.tsx`
- Modify: `packages/client/src/api/client.ts`
- Test: `packages/client/tests/components/worldbook-panel.test.tsx`

- [ ] **Step 1: Write failing component test**

Mock fetch. Assert panel lists entries, creates a new entry, and toggles constant/trigger mode.

- [ ] **Step 2: Run test to verify RED**

Run: `pnpm --filter @scribe/client test -- worldbook-panel.test.tsx`

Expected: FAIL because component does not exist.

- [ ] **Step 3: Implement API helpers**

Add list/create/update/delete worldbook calls.

- [ ] **Step 4: Implement panel**

Keep UI utilitarian: list entries, edit title/content/keys/constant/enabled/priority/recursionLimit. No decorative landing UI.

- [ ] **Step 5: Add sidebar tab**

Add built-in “世界书” tab before “写作规则”.

- [ ] **Step 6: Run client tests**

Run: `pnpm --filter @scribe/client test -- worldbook-panel.test.tsx`

Expected: PASS.

## Task 8: End-To-End Verification

**Files:**
- Create: `packages/server/tools/monitor-worldbook-flow.ts`
- Output: `tmp/worldbook-monitor-<timestamp>.json`

- [ ] **Step 1: Write monitor script**

Script creates 2 books with different genres, creates worldbook entries through API or repository, previews retrieval, writes 1 chapter each, and records which worldbook entries were injected.

- [ ] **Step 2: Run focused typechecks**

Run: `pnpm --filter @scribe/shared test`
Run: `pnpm --filter @scribe/server typecheck`
Run: `pnpm --filter @scribe/client typecheck`

- [ ] **Step 3: Run focused tests**

Run server worldbook/context/auto tests and client worldbook panel test.

- [ ] **Step 4: Run monitor**

Run: `pnpm --filter @scribe/server exec tsx tools/monitor-worldbook-flow.ts`

Expected: PASS report with triggered entries, recursive entries, and chapter-end state updates.

- [ ] **Step 5: Browser check**

Open `http://localhost:5173/library`, enter a book, confirm the “世界书” tab lists/edit entries and chapters still render.

## Self-Review

Spec coverage:
- Stable settings layer: Tasks 1, 3, 5, 7.
- Always-on/trigger/priority/depth/recursion: Tasks 1 and 2.
- Writing-time retrieval injection: Task 4.
- Chapter-end runtime records remain separate: Task 4 keeps record-state unchanged; Task 8 verifies both.
- Auto guard: Task 6.
- Multi-genre validation: Task 8.

Placeholder scan: no “TBD” or unspecified implementation steps remain.

Type consistency: plan uses `WorldbookEntry`, `worldbookRepo`, `retrieveWorldbookEntries`, and `worldbookEntries` consistently.
