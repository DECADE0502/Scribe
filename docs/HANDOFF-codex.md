# Scribe Handoff

Last updated: 2026-06-22 01:10 Asia/Shanghai

## Project

Scribe is a local-first AI long-form novel writing workspace. The user is using it as an authoring tool, not a generic chat app. The core product promise is:

- books have isolated chat history and durable state;
- the writer can create books, outlines, characters, worldbook entries, prompt presets, style references, and chapters;
- chapter prose should be written into the editor/workspace, not dumped into the chat stream;
- AI progress should be visible while workflows run;
- accepted chapters update structured memory only after writing, audit, repair, and acceptance checks;
- SillyTavern-like presets/worldbooks should be editable and should affect later writing;
- continuity and hard facts matter more than superficial green tests.

Repo root:

```text
D:\DESKTOP\Scribe
```

Runtime data is outside the repo:

```text
%APPDATA%\scribe\
```

Do not commit runtime DBs, `secrets.env`, API keys, or unrelated private exports.

## Repository Layout

- `packages/shared`: shared TypeScript contracts and schemas.
- `packages/server`: Hono backend, SQLite repositories, AI providers, orchestration, prompts, tools, import/runtime logic, quality gates.
- `packages/client`: Vite + React authoring UI.
- `docs`: specs, implementation plans, handoff documents, and SDD artifacts.
- `docs/superpowers/sdd/2026-06-21-agent-workflow-execution`: moved subtask/review artifacts from the old hidden `.superpowers/sdd` directory.
- `samples`: import/fixture samples.
- `reports`: live-run evidence and verification reports.
- `e2e`: Playwright end-to-end tests.

## Current Git State

Active branch:

```text
codex/generic-record-architecture
```

Remote URL before final push:

```text
https://github.com/DECADE0502/Scribe.git
```

The local remote was renamed from `origin` to `scribe` during the final cleanup so the remote alias matches the product/repository name. If a future tool expects `origin`, either use `scribe` explicitly or add an additional alias.

## Recent Major Work

### Book-bound conversation history

Conversation state is now expected to be scoped by book. Switching books should load that book's messages instead of reusing another book's chat history.

Important files:

- `packages/client/src/components/conversation/conversation-pane.tsx`
- `packages/server/src/http/routes/conversation.ts`
- `packages/server/tests/integration/chat-streaming.test.ts`
- `packages/client/tests/components/conversation-pane.test.tsx`

### Workflow execution UX

Natural-language requests now go through a workflow contract: intent, execution plan, tool/action steps, read-back, and acceptance. The UI has execution mode controls for different autonomy levels.

Important behavior:

- prose is suppressed from ordinary chat stream;
- progress and tool feedback are visible;
- execution mode is sent with conversation requests;
- acceptance summaries are displayed.

Important files:

- `packages/shared/src/types/agent-workflow.ts`
- `packages/server/src/ai/orchestrator/workflow-contract.ts`
- `packages/server/src/ai/orchestrator/conversation-orchestrator.ts`
- `packages/client/src/components/conversation/conversation-pane.tsx`
- `packages/client/src/components/conversation/message.tsx`
- `packages/client/tests/components/conversation-writing-intent.test.tsx`
- `packages/client/tests/components/conversation-tool-feedback.test.tsx`

### Chapter writing and audit flow

The intended loop remains:

```text
write / revise chapter
  -> hidden prose output into editor
  -> audit and hard-fact checks
  -> optional repair
  -> state recording with tools
  -> side panels refresh
```

Important files:

- `packages/server/src/ai/orchestrator/write-chapter.ts`
- `packages/server/src/ai/orchestrator/repair-chapter.ts`
- `packages/server/src/ai/prompts/write-chapter.ts`
- `packages/server/src/ai/prompts/repair-chapter.ts`
- `packages/server/src/ai/prompts/audit-summarize.ts`
- `packages/server/src/ai/prompts/serialized-chapter-ending.ts`
- `packages/server/src/http/routes/chapters.ts`
- `packages/client/src/components/editor/editor-pane.tsx`

### Serialized chapter ending guard

Continuous novels should not end every chapter with generic "to be continued", artificial suspense, or empty aftertaste sentences. The current prompt work includes a serialized-ending guard to keep chapter endings concrete and tied to the scene.

Important file:

- `packages/server/src/ai/prompts/serialized-chapter-ending.ts`

### Active full audit button

The product direction includes an author-triggered full audit/repair pass across existing book assets, not just the current chapter. Audit prompts should not be inserted into normal chat history; chat should only show that an active audit was triggered and then show workflow progress.

Important files to inspect:

- `packages/server/src/ai/prompts/audit-summarize.ts`
- `packages/server/src/ai/prompts/repair-chapter.ts`
- `packages/server/src/http/routes/books.ts`
- `packages/client/src/components/sidebar/*`
- `packages/client/src/components/conversation/conversation-pane.tsx`

### Style references

Global style references are configurable on the settings page and can be selected per book. They are injected into the writing agent to constrain prose style. The user expects add/edit/delete globally, then per-book selection that persists.

Important files:

- `packages/client/src/pages/settings.tsx`
- `packages/server/src/config/load.ts`
- `packages/server/src/http/routes/usage.ts`
- `packages/server/src/http/routes/books.ts`
- `packages/server/src/ai/context-builder/book-context.ts`
- `packages/server/src/ai/prompts/write-chapter.ts`

### Provider configuration

Providers now include AnyRouter by default, DeepSeek as optional, MiMo, and user-defined OpenAI-compatible providers.

Important details:

- API keys are stored per provider using `providerSecretName(providerId)`.
- Switching provider should switch visible/masked key state.
- A custom provider can be added from the UI with name, Base URL, request format, auth mode, and default models.
- Model list refresh first syncs current settings, then calls `/api/models`.
- `Bearer Key` must send `Authorization: Bearer <key>`.
- `api-key Header` must send `api-key: <key>`.
- Base URLs ending in `/v1` must not become `/v1/v1/models`.
- If model loading fails, the error should include the actual provider request URL/cause, without exposing keys.

Important files:

- `packages/server/src/ai/providers/anyrouter.ts`
- `packages/server/src/ai/providers/custom-openai-compatible.ts`
- `packages/server/src/ai/providers/openai-compatible.ts`
- `packages/server/src/ai/model-manager.ts`
- `packages/server/src/config/load.ts`
- `packages/server/src/config/secrets.ts`
- `packages/server/src/http/routes/usage.ts`
- `packages/client/src/pages/settings.tsx`

Latest runtime state verified on 2026-06-22:

- provider: `xiongmao`
- base URL: `https://api520.pro/v1`
- auth: Bearer
- write/audit model: `gemini-2.5-pro`
- `/api/models` successfully returned model IDs.

The API key was exposed in chat by the user. It is not committed, but the user should rotate it.

## Important Recent Bug Fixes

### Custom provider with Chinese name

Bug:

If the user filled a Chinese provider name such as "熊猫" but did not provide a valid ASCII provider ID, the dialog silently failed or the provider did not become active. The key then got saved to the current built-in provider, making model refresh call the wrong endpoint.

Fix:

- `packages/client/src/pages/settings.tsx` now generates a stable `custom-...` provider ID from provider name + Base URL when the ID field is blank or invalid.
- Added a client test proving Chinese name + blank ID still saves a custom provider with `auth: "bearer"`.

### Better model list diagnostics

Bug:

The UI only showed `fetch failed`, which hid whether the app used the right provider URL/auth mode.

Fix:

- `packages/server/src/ai/providers/openai-compatible.ts` wraps list-model failures with requested URL and underlying cause.
- Added tests for URL/cause visibility and custom provider auth behavior.

## Verification Completed On 2026-06-22

```powershell
pnpm --filter @scribe/server typecheck
pnpm --filter @scribe/client typecheck
pnpm --filter @scribe/server exec vitest run
pnpm --filter @scribe/client exec vitest run
```

Results:

```text
server typecheck: passed
client typecheck: passed
server tests: 92 files / 529 tests passed
client tests: 24 files / 110 tests passed
```

Runtime verification:

```text
GET http://127.0.0.1:6789/api/settings
  provider: xiongmao
  hasApiKey: true

GET http://127.0.0.1:6789/api/models
  returned model IDs successfully
```

## Known Risks / Next Work

- Some older Chinese files render as mojibake in PowerShell. Avoid unnecessary large rewrites of Chinese docs/comments.
- The settings page has accumulated many controls; keep layout compact and Chinese UI labels consistent.
- Active audit should be full-book/selectable-asset scope, not just current chapter.
- Intent checker and acceptance checker standards should align: first agent defines criteria, final checker verifies those plus additional consistency issues.
- Tool execution should be robust against no-op/failed tool calls and should surface progress clearly.
- Do not use regex-only command matching for user instructions; route through the workflow.
- Hard-fact continuity remains central: do not let bad chapters poison durable memory.
- Keep generated chapter prose out of chat deltas by default.

## What Not To Do

- Do not hardcode for one user book or one genre.
- Do not reset or discard dirty files without explicit permission.
- Do not commit `%APPDATA%\scribe\secrets.env`, runtime DBs, or local private exports.
- Do not treat green tests as proof of writing quality.
- Do not silently save a key under the wrong provider.
- Do not show full active-audit prompt text in chat history.
