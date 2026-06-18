# SillyTavern Import Design

## Goal

Support complete SillyTavern preset and worldbook compatibility inside Scribe.
Users must be able to import, inspect, edit, reorder, enable, disable, and tune
SillyTavern presets and worldbooks. Imported content must truly affect writing,
not merely be stored. Long-form generation must use preset behavior, worldbook
retrieval, dynamic memory records, and reader-continuity quality issues together
so plot, character behavior, setting rules, and foreshadowing stay continuous.

The compatibility target is practical equivalence rather than byte-for-byte UI
cloning: the same preset/worldbook should produce the same kind of writing
pressure and knowledge recall in Scribe, while using Scribe's chapter, audit,
and record systems for long novel continuity.

This feature serves writing quality and continuity, not code aesthetics. The
system should let users bring rich prompt presets, style rules, world rules,
triggered knowledge, regex transformations, macro-based prompt composition, and
depth/recursion behavior into the local novel engine, then combine them with
Scribe's own dynamic records and reader-continuity quality issues before each
writing call.

## Sample Findings

Two real exports were inspected:

- `samples\sillytavern\Izumi 0503.json`
- `samples\sillytavern\宠物捕捉系统-世界书.json`

### Preset File

`Izumi 0503.json` is a SillyTavern/OpenAI preset-style file.

Important observed facts:

- Top-level generation settings include `temperature`, `top_p`, `top_k`,
  `top_a`, `min_p`, `repetition_penalty`, `openai_max_context`,
  `openai_max_tokens`, `reasoning_effort`, `verbosity`, `show_thoughts`,
  `enable_web_search`, `stream_openai`, and related fields.
- It contains 203 `prompts`.
- It contains one `prompt_order` group with 172 ordered prompt references.
- The ordered stack enables 52 prompt references.
- The ordered enabled stack contains 49 system prompts, 2 assistant prompts, and
  1 user prompt.
- `prompts[].enabled` and `prompt_order[].order[].enabled` disagree in 27
  cases. Therefore prompt assembly must use `prompt_order` as the active stack
  source, then look up content by `identifier`.
- Prompt fields observed: `identifier`, `name`, `enabled`,
  `injection_position`, `injection_depth`, `injection_order`, `role`, `content`,
  `system_prompt`, `marker`, `forbid_overrides`, `injection_trigger`.
- Extensions include `SPreset`, `tavern_helper`, and `regex_scripts`.
- `regex_scripts` contains 26 entries with fields such as `findRegex`,
  `replaceString`, `placement`, `disabled`, `markdownOnly`, `promptOnly`,
  `runOnEdit`, `substituteRegex`, `minDepth`, and `maxDepth`.

The preset contains multiple kinds of writing controls: core prompts, variable
initialization macros, style blocks, narrative perspective switches, pacing
switches, anti-pattern bans, summary format prompts, assistant prefill blocks,
and regex transformations. These are prompt behavior, not world knowledge, so
they must not be imported as worldbook entries.

### Worldbook File

`宠物捕捉系统-世界书.json` is a SillyTavern worldbook export.

Important observed facts:

- Top-level keys are `entries` and `originalData`.
- `originalData` contains a second copy of the original export data.
- It has 38 worldbook entries.
- All 38 entries are enabled.
- 7 entries are constant.
- 31 entries are trigger-based.
- 1 entry uses selective behavior.
- Total worldbook content is about 51,007 characters.
- It has 320 primary trigger keys in the inspected export.
- Secondary key fields exist even when most entries leave them empty.
- Important per-entry fields include `key`, `keysecondary`, `comment`,
  `content`, `constant`, `vectorized`, `selective`, `selectiveLogic`, `addMemo`,
  `order`, `position`, `disable`, `ignoreBudget`, `excludeRecursion`,
  `preventRecursion`, `matchPersonaDescription`, `matchCharacterDescription`,
  `matchCharacterPersonality`, `matchCharacterDepthPrompt`, `matchScenario`,
  `matchCreatorNotes`, `delayUntilRecursion`, `probability`, `useProbability`,
  `depth`, `outletName`, `group`, `groupOverride`, `groupWeight`, `scanDepth`,
  `caseSensitive`, `matchWholeWords`, `useGroupScoring`, `automationId`, `role`,
  `sticky`, `cooldown`, `delay`, `triggers`, `displayIndex`, `extensions`, and
  `characterFilter`.

Current Scribe worldbook fields cover only the core subset:

- `title`
- `content`
- `enabled`
- `activation`
- `keys`
- `secondaryKeys`
- `constant`
- `priority`
- `insertionDepth`
- `recursive`
- `recursionLimit`
- `tokenBudget`
- `category`
- `metadata`

That is enough for a first native retrieval layer, but not enough for direct
SillyTavern import unless all unmapped fields are preserved in metadata or a raw
import table.

## Product Model

Scribe should have three distinct context sources:

1. **Prompt presets**
   Imported preset files that define behavior, style, formatting, generation
   preferences, and prompt stack order.

2. **Worldbook entries**
   Imported or locally created knowledge entries that define stable world facts,
   rules, locations, factions, character facts, mechanics, and style contracts
   that are retrieved by constant inclusion, keyword trigger, and bounded
   recursion.

3. **Runtime continuity state**
   Scribe-generated dynamic records: chapter summaries, characters,
   foreshadowing, generic records, timeline events, and reader-continuity
   quality issues discovered during audit.

The key design boundary is that presets control how the AI writes, worldbook
controls what the AI must know, and runtime continuity controls what the AI must
not forget after the story has begun.

## Import Architecture

### Raw Import Records

Every imported JSON file should be saved as an import artifact before any
normalization.

Suggested fields:

- `id`
- `bookId`
- `sourceType`: `sillytavern_preset` or `sillytavern_worldbook`
- `sourceName`
- `sourceFilename`
- `rawJson`
- `rawHash`
- `importedAt`
- `importReportJson`

The raw record makes import auditable and lets future migrations re-interpret
fields that are not supported in the first implementation.

### Preset Normalization

Create a native prompt preset model separate from worldbook.

Suggested preset fields:

- `id`
- `bookId`
- `name`
- `enabled`
- `sourceImportId`
- `generationSettingsJson`
- `extensionsJson`
- `createdAt`
- `updatedAt`

Suggested prompt block fields:

- `id`
- `presetId`
- `sourceIdentifier`
- `name`
- `role`: `system`, `user`, or `assistant`
- `content`
- `enabled`
- `stackIndex`
- `injectionPosition`
- `injectionDepth`
- `injectionOrder`
- `systemPrompt`
- `marker`
- `forbidOverrides`
- `injectionTriggerJson`
- `sourcePromptEnabled`
- `sourceOrderEnabled`
- `metadataJson`

Normalization rules:

- If `prompt_order` exists, build the active stack from
  `prompt_order[].order[]`.
- For each ordered item, look up the prompt by `identifier`.
- `enabled` for writing must come from the order item, not from
  `prompts[].enabled`.
- Store both values as `sourcePromptEnabled` and `sourceOrderEnabled` so the UI
  can explain mismatches.
- Prompts not referenced by `prompt_order` should still be imported as inactive
  library blocks with no active `stackIndex`.
- Empty marker prompts are preserved because they often bracket prompt sections.
- Assistant and user role blocks are preserved. Version 1 sends them as role
  messages when the provider supports mixed-role prompt stacks; otherwise it
  folds them into a system compatibility block while keeping the original role
  in metadata.
- `regex_scripts`, `SPreset`, and other extensions are preserved under
  `extensionsJson`; regex execution is not enabled in the first version.

### Worldbook Normalization

Import SillyTavern worldbook entries into Scribe's worldbook table and preserve
the full raw entry in metadata.

Mapping rules:

- `comment` -> `title`
- `content` -> `content`
- `disable` -> `enabled = !disable`
- `constant` -> `constant`
- `constant === true` -> `activation = "constant"`
- `constant === false` -> `activation = "triggered"`
- `key` -> `keys`
- `keysecondary` -> `secondaryKeys`
- `order` -> `priority`
- `depth` -> `insertionDepth`
- `role` -> `metadata.sillytavern.role`
- `position` -> `metadata.sillytavern.position`
- unsupported fields -> `metadata.sillytavern.rawEntry`
- original entry id/uid -> `metadata.sillytavern.uid`
- import artifact id -> `metadata.sourceImportId`

Fields to preserve even before native behavior is implemented:

- selective logic
- probability and probability enablement
- recursion controls
- scan depth
- case sensitivity
- whole-word matching
- group scoring
- sticky/cooldown/delay
- character filters
- regex/use_regex/extensions
- ignore budget
- matching source flags such as persona, scenario, character description, and
  creator notes

Core behavior must support:

- enabled/disabled
- constant inclusion
- primary and secondary keys
- priority/order
- insertion depth
- bounded recursive retrieval
- token budget trimming
- probability-based trigger selection
- selective key logic
- group scoring
- sticky/cooldown/delay behavior
- case-sensitive and whole-word matching
- scan-depth behavior against recent history windows

## Writing Context Assembly

Before each writing call, Scribe should assemble context in this order:

1. Scribe's own non-negotiable system constraints.
2. Enabled prompt preset blocks for the selected preset, ordered by stack index.
3. Imported preset generation preferences translated into provider options where
   safe and supported.
4. Always-on worldbook entries.
5. Triggered worldbook entries selected from the current chapter goal, recent
   summaries, active characters, active record labels, foreshadowing, and user
   instruction.
6. Recursively triggered worldbook entries, bounded by each entry's recursion
   settings and a global token budget.
7. Runtime continuity context: summaries, current characters, timeline,
   foreshadowing, generic records, and unresolved reader-continuity issues.
8. The immediate chapter writing task.

Preset prompt blocks should not replace Scribe's quality controls. If an imported
preset asks for behavior that conflicts with Scribe's continuity requirements,
Scribe's continuity requirement wins for chapter generation.

## Reader-Continuity Quality Layer

SillyTavern imports improve the input context, but they do not by themselves
guarantee long-form quality. The writing-quality loop needs a separate
continuity layer.

Audit should emit structured reader issues:

- `type`: continuity, character_behavior, foreshadowing, setting_consistency,
  pacing, narrative_perspective, information_density, style_drift
- `severity`: warning or critical
- `chapterNo`
- `note`
- `evidence`
- `suggestedAction`
- `status`: open, injected, resolved, ignored, deferred

Before writing the next chapter, open issues should be injected after worldbook
and runtime records. This tells the writer model what a reader is currently
worried about. The next audit can mark an issue resolved, keep it open, or
escalate it.

This layer is intentionally separate from imported worldbook. A worldbook entry
says what is true about the world. A reader issue says what the current draft
has made confusing or unconvincing.

## UI Requirements

The UI should support three import-facing surfaces.

### Import Dialog

Users can upload or choose a local JSON file. The server detects:

- SillyTavern preset
- SillyTavern worldbook
- unknown JSON

The preview shows:

- source type
- entry or prompt count
- enabled count
- constant count for worldbooks
- active stack count for presets
- unsupported-but-preserved field count
- warnings such as prompt enabled/order enabled mismatches

### Preset Manager

Users can:

- enable or disable a preset
- inspect ordered blocks
- toggle blocks
- reorder blocks
- search by block name/content
- see role and original identifier
- see generation settings imported from the preset
- see warnings for risky or unsupported blocks

The first implementation may support editing enablement and viewing content
without full rich editing.

### Worldbook Manager

Users can:

- list imported entries
- edit title/content/keys/secondary keys
- toggle constant versus triggered
- edit priority, insertion depth, recursion, and token budget
- inspect preserved SillyTavern metadata
- preview retrieval against a query

Existing manual worldbook editing should remain compatible with imported
entries.

## Error Handling

Import should fail with clear errors for:

- invalid JSON
- unsupported top-level shape
- preset prompt missing an identifier
- ordered prompt reference missing a matching prompt
- worldbook entry missing both title/comment and content

Import should warn but continue for:

- prompt blocks with empty content
- enabled mismatches between prompt and prompt_order
- unsupported SillyTavern fields
- duplicated trigger keys
- empty trigger arrays on non-constant entries
- very large entries that may exceed retrieval budget

Warnings are saved in the import report.

## Compatibility Engines

### Macro Engine

Scribe must implement a compatible macro layer for the prompt features used by
the imported preset. Required behavior:

- `{{user}}` -> configured protagonist/user name when available
- `{{char}}` -> book title or active narrator label when available
- `{{lastUserMessage}}` -> current writing instruction when used in a writing
  call
- `{{date}}` and `{{time}}` -> current local date/time
- `{{setvar::name::value}}` -> set a scoped prompt variable and emit no text
- `{{getvar::name}}` -> read the scoped prompt variable or emit an empty string
- unknown macros -> preserve literally and report in diagnostics

Macro variables are scoped per prompt assembly call. They should not leak across
books or chapters unless a future setting explicitly asks for persistent
variables.

### Regex Script Engine

Scribe must import and expose SillyTavern regex scripts. Execution should be
supported behind an explicit per-preset toggle because regex can rewrite prompts
and generated text. Required behavior:

- preserve every regex script field
- let users enable/disable each script
- support prompt-only transformations before the model call
- support output transformations after generation when explicitly enabled
- respect `disabled`, `promptOnly`, `markdownOnly`, `minDepth`, and `maxDepth`
  where applicable to Scribe's available context depth
- log which scripts ran during a writing call

### Prompt Stack Compiler

The prompt compiler is responsible for turning imported preset blocks,
SillyTavern macros, regex scripts, Scribe base constraints, worldbook entries,
runtime records, and reader issues into final model messages. It must be
inspectable: users should be able to preview the final prompt stack for a
chapter before generation.

### Worldbook Matching Engine

Scribe's worldbook retrieval must implement SillyTavern-style behavior where it
matters for writing:

- constant entries
- primary keys
- secondary key/selective logic
- recursion and recursion exclusion/prevention
- delayed recursion
- insertion depth
- priority/order
- probability gates
- scan depth
- case-sensitive and whole-word matching
- grouping and group scoring
- sticky/cooldown/delay controls
- matching against configured sources such as user instruction, recent chapter
  summaries, character data, scenario/book premise, and creator notes/rules

Every trigger decision should be explainable in a preview/debug view.

## Safety Boundaries

Imported adult or unsafe prompt blocks are not specially rewritten by the
importer. The application should mark categories as imported content and allow
the existing model/provider safety behavior to handle output constraints.

## Testing Strategy

Unit tests:

- detect SillyTavern preset shape
- detect SillyTavern worldbook shape
- normalize preset using `prompt_order` enabled state
- preserve prompt/order enabled mismatches in the import report
- evaluate `setvar`/`getvar` macros in prompt order
- preserve unknown macros and report diagnostics
- run enabled prompt regex scripts
- skip disabled regex scripts
- normalize worldbook entries into Scribe worldbook entries
- preserve unsupported worldbook fields in metadata
- retrieve constant, triggered, selective, probabilistic, grouped, scan-depth,
  and recursive worldbook entries
- render preset plus worldbook context in deterministic order

Integration tests:

- import `Izumi 0503.json` into a test book and verify prompt counts, enabled
  stack count, role counts, generation settings, extensions, and mismatch report
- import `宠物捕捉系统-世界书.json` into a test book and verify 38 entries, 7
  constant entries, trigger keys, priorities, insertion depths, and metadata
- preview retrieval for terms such as `捕捉`, `天界`, `状态栏`, and `观测者`
- build a writing context that includes enabled preset blocks, constant
  worldbook entries, triggered worldbook entries, and runtime continuity issues

Live workflow verification:

- create a new book
- import the preset
- import the worldbook
- preview retrieval
- generate several chapters
- inspect whether triggered worldbook entries appear in the writing context
- inspect whether audit-discovered reader issues are injected into subsequent chapter
  context
- run at least one 15+ chapter live flow using imported preset/worldbook and
  verify memory retrieval, worldbook triggers, and reader issues across the run

## Acceptance Criteria

The feature is acceptable when:

- Users can import both sample files without losing unsupported fields.
- Preset import respects `prompt_order` rather than only `prompts[].enabled`.
- The preset is visible as an ordered, toggleable writing prompt stack.
- Users can freely edit, reorder, enable, disable, and inspect prompt blocks.
- Imported macro variables such as `setvar`/`getvar` affect the compiled prompt.
- Imported regex scripts can be inspected, toggled, and run when explicitly
  enabled.
- Worldbook import creates 38 native entries from the sample worldbook.
- The 7 constant entries are always available in writing context.
- Triggered worldbook entries can be retrieved by keyword, selective matching,
  scan depth, probability, group scoring, and recursive matching.
- Users can freely edit worldbook content, keys, secondary keys, constant mode,
  depth, priority, recursion, probability, and matching behavior.
- Import reports clearly show warnings and preserved unsupported fields.
- Writing context can combine preset, worldbook, Scribe runtime records, and
  unresolved reader-continuity issues.
- Users can preview why a worldbook entry triggered and where it was inserted.
- A 15+ chapter verification run shows that imported preset/worldbook context,
  dynamic memory, and reader-continuity issues influence later chapters.
- No genre-specific or sample-specific logic is required for the import path.

## Open Design Decisions

1. **Preset scope**
   Presets must be usable book-locally. A global reusable preset library is
   desirable and can share the same data model with a nullable `bookId`.

2. **Macro engine**
   `setvar`, `getvar`, and the common template variables are required for the
   target. Rare or extension-specific macros can be preserved with diagnostics
   until encountered in real imports.

3. **Regex scripts**
   Regex execution is required for full effect, but must be explicitly toggled
   on per preset and per script.

4. **Prompt role handling**
   The first version should preserve role blocks. If provider behavior becomes
   unstable with imported assistant/user blocks, Scribe can offer a compatibility
   mode that folds non-system preset blocks into a system-labeled compatibility
   section while keeping the original roles in metadata.

5. **Quality debt implementation**
   Reader-continuity issue persistence is part of the target, because the final
   goal is long-form continuity, not only SillyTavern file compatibility.
