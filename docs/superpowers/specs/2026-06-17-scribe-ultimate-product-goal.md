# Scribe Ultimate Product Goal

Last updated: 2026-06-17

## Purpose

Scribe is a local-first AI long-form novel creation workspace. Its final purpose is to help a user turn a complex story idea, imported creative assets, scattered notes, and ongoing editorial intent into a complete long novel with stable continuity, inspectable memory, controllable style, revision history, and exportable deliverables.

Scribe is not merely a chapter generator, a chat wrapper, or a SillyTavern clone. SillyTavern compatibility is one important asset-ingestion path. The larger product goal is a durable writing system where the user controls creative direction and taste, while the software handles context organization, generation orchestration, continuity protection, state recording, quality review, revision workflow, and project packaging.

## One-Sentence Goal

Scribe should become a local AI novel studio that lets users reliably write, revise, manage, and finish long-form fiction by combining conversation-driven creation, editable knowledge bases, imported writing assets, long-term memory, generic quality gates, and auditable generation workflows.

## Final User Experience

A user should be able to open Scribe and complete this workflow:

```text
create or import a book
-> import or write settings, characters, worldbooks, presets, notes, and existing chapters
-> talk to the AI like an editor about the next creative move
-> generate chapter prose
-> inspect quality, continuity, used context, and model diagnostics
-> repair, rewrite, or manually edit weak sections
-> approve only the final chapter state into durable memory
-> continue for many chapters without repeatedly reminding the AI of basic facts
-> export the finished manuscript and project materials
```

The user should not need to write a full prompt from scratch for every chapter. The system should remember what has already happened, retrieve the relevant setting material, enforce hard continuity, and show the user what it used.

## Product Identity

Scribe should behave like a private local writing studio:

- The user is the author and final decision-maker.
- The AI is an editor, drafter, continuity assistant, and archivist.
- The application is the project workspace that stores, explains, and protects the work.
- Every generated chapter is part of a long-running book project, not an isolated response.

This identity drives all design decisions. A feature is valuable only if it helps the user create, control, repair, continue, or deliver a long-form work.

## Core Product Outcomes

### 1. Creative Asset Ingestion

Users may begin with many kinds of existing material:

- SillyTavern presets.
- SillyTavern worldbooks.
- Character cards.
- Existing chapters.
- Markdown notes.
- Rules, style guides, and taboo lists.
- Manual worldbuilding documents.
- Scattered plot ideas.

Scribe must preserve the raw source, normalize it into editable runtime structures, and prove whether it affected a writing call.

The system must distinguish four forms of imported material:

1. Raw artifact: the original source file or text, preserved for audit and re-import.
2. Normalized model: editable Scribe-native records.
3. Runtime context: the subset selected for a specific writing or audit call.
4. Diagnostics: evidence of what was selected, ignored, transformed, or dropped.

### 2. Conversation-Driven Creation

The primary control surface is conversation. The user should be able to give natural instructions such as:

- write the next chapter around a specific event;
- slow down the emotional pacing;
- keep a character from confessing too early;
- lock a world rule;
- rewrite a scene in a lower-key style;
- continue for five chapters but stop on serious continuity errors;
- make a setting permanent memory;
- remove a wrong memory;
- explain why a worldbook entry did not trigger.

Scribe must translate these instructions into concrete operations: context assembly, chapter generation, revision, record updates, worldbook edits, audit requests, memory locks, or workflow controls.

### 3. Long-Term Novel Memory

The central product requirement is long-form continuity. Scribe must maintain durable, editable memory for:

- characters and current character states;
- relationships;
- locations and spatial state;
- timeline and story time;
- inventory, resources, quantities, cooldowns, and task progress;
- contracts, promises, rules, and obligations;
- injuries, transformations, powers, ranks, statuses, and constraints;
- plot arcs and outline state;
- foreshadowing and unresolved setups;
- world rules and setting facts;
- chapter summaries and key events;
- open reader/audit issues;
- user style preferences and project-specific writing constraints.

Memory must be inspectable and editable. The user must be able to correct, lock, delete, or annotate recorded facts. Memory that cannot be inspected cannot be trusted.

### 4. Chapter Generation As A Workflow

Chapter generation must be an orchestrated pipeline, not a single model call.

The target pipeline is:

```text
load book state
-> compile runtime context
-> generate chapter draft
-> sanitize non-prose contamination
-> audit prose quality and continuity
-> run generic quality gates
-> repair if needed
-> re-audit and re-run gates
-> stop if still unsafe for continuity
-> persist approved chapter version
-> record durable state from the approved text
-> produce diagnostics for the user
```

A chapter that fails continuity or quality gates must not update durable memory. Bad memory is worse than missing memory because it poisons later chapters.

### 5. Generic Quality Gates

Quality gates must be generic and cross-genre. They must not be built around one sample story, one worldbook, or one keyword set.

The gate layer should protect against:

- hard fact contradictions: quantities, location, ownership, status, time, task progress, injuries, cooldowns;
- world rule contradictions: changed mechanics, broken ability limits, inconsistent constraints;
- character continuity drift: behavior, relationship, knowledge, speech, motivation;
- plot continuity errors: repeated events, missing consequences, unresolved cause/effect;
- required output structure failures: imported preset-required panels or chapter structures;
- meta-output contamination: chat logs, progress labels, task notes, hidden reasoning tags, execution traces;
- style drift: repeated AI phrasing, over-explanation, loss of the user's chosen prose style;
- long-form degradation: forgetting open issues, dropping foreshadowing, restarting arcs.

A sample novel may expose a failure, but fixes must land in these abstractions. Sample-specific terms such as a particular item name, character name, faction, or system mechanic must not define the architecture.

### 6. User-Controlled Workspace

The final UI should be a writing workspace, not a single text box.

The workspace should expose:

- book library;
- onboarding and book setup;
- conversation with AI editor;
- chapter editor with version history and diff/rewrite tools;
- characters;
- worldbook and imported knowledge;
- outline, arcs, and chapter plans;
- timeline;
- foreshadowing;
- generic records and hard facts;
- reader/audit issues;
- prompt presets and model settings;
- runtime diagnostics;
- cost and token usage;
- backups and exports.

Users must be able to view, edit, lock, delete, restore, and export the project state. The system should not hide important decisions inside prompts or opaque logs.

### 7. Project Durability And Deliverables

Each book is a durable project, not a transient chat session.

A finished Scribe book should include:

- chapter Markdown files;
- workspace database;
- raw imported artifacts;
- normalized settings and knowledge records;
- rules and style guides;
- version history;
- automatic snapshots;
- audit and repair history;
- runtime diagnostics;
- token/cost records;
- exportable manuscript package.

The project must survive interrupted runs, failed model calls, network problems, and user corrections.

## Scope Boundaries

Scribe should not become:

- a generic chatbot;
- a pure prompt playground;
- a one-shot story generator;
- a SillyTavern UI clone;
- a sample-specific automation script;
- a tool whose tests pass while the generated novel is unreadable;
- a system that records model mistakes as long-term truth.

Scribe should be:

- local-first;
- author-controlled;
- asset-compatible;
- memory-aware;
- continuity-protecting;
- inspectable;
- resumable;
- exportable;
- genre-neutral.

## Strategic Architecture

The final architecture should be organized around stable layers.

### 1. Asset Layer

Stores raw imports and source materials. It preserves original files and tracks import reports, hashes, warnings, and unsupported fields.

### 2. Normalized Knowledge Layer

Converts raw assets into Scribe-native editable structures: prompt presets, prompt blocks, regex scripts, worldbook entries, character records, outline records, timeline events, foreshadowing, generic hard facts, and reader issues.

### 3. Runtime Context Layer

Builds the actual model context for a specific operation. It selects relevant normalized knowledge, applies prompt stacks, retrieves worldbook entries, injects recent memory, applies user intent, and emits diagnostics.

### 4. Writing Orchestration Layer

Controls write, audit, repair, revise, rewrite, auto-run, and stop conditions. It owns the generation lifecycle and guarantees that model output moves through gates before it affects durable state.

### 5. Generic Quality Gate Layer

Runs deterministic and model-assisted checks over draft and repaired chapters. It produces structured issues that can trigger repair, block state recording, or ask the user for a decision.

### 6. Durable Memory Layer

Records approved story state only after gates pass. It stores memory in editable structured repositories and keeps links back to chapter evidence.

### 7. Workspace UI Layer

Gives the author control surfaces for writing, editing, memory correction, diagnostics, imports, settings, versions, and exports.

### 8. Acceptance Harness

Runs multi-genre, multi-chapter verification workflows. It proves that the system works across different story types and does not depend on one sample.

## Acceptance Criteria For The Whole Project

The whole product is acceptable only when these outcomes are true.

### Functional Acceptance

- A user can create a new book from scratch.
- A user can import SillyTavern preset and worldbook assets without losing unsupported fields.
- Imported assets are editable and affect writing runtime.
- A user can generate, revise, approve, and export chapters.
- A user can inspect and correct memory.
- The system can run automatic multi-chapter generation and stop on serious failures.
- The system can export a usable manuscript and project package.

### Continuity Acceptance

- Generated chapters preserve prior hard facts unless the chapter explicitly changes them.
- State recording is blocked when unresolved contradictions remain.
- The user can see which facts were recorded from which chapter evidence.
- Reader/audit issues carry forward until resolved or dismissed.
- Long-running stories do not silently reset resources, relationships, locations, deadlines, or character states.

### Compatibility Acceptance

- SillyTavern preset prompt order, enabled state, generation settings, macros, regex scripts, and prompt blocks are preserved and diagnosable.
- SillyTavern worldbook entries, keys, secondary keys, constants, priorities, depth, recursion, probability, grouping, cooldown, delay, scan depth, and matching settings are preserved and where supported affect retrieval.
- Unknown imported fields are preserved in raw metadata instead of discarded.
- Users can preview why an entry triggered or did not trigger.

### Quality Acceptance

- The system detects non-prose contamination before accepting a chapter.
- The system detects missing required output sections before accepting a chapter.
- The system detects or escalates hard-fact contradictions before recording memory.
- Repair is attempted when appropriate and re-checked before acceptance.
- If repair fails, the run stops and explains why.

### Verification Acceptance

- Unit and integration tests cover import, runtime context, retrieval, gates, state recording, and UI edit flows.
- Multi-genre fixtures verify the same quality gate abstractions across at least urban/system, xianxia, mystery, and sci-fi scenarios.
- A 5-chapter live run acts as a fast smoke test.
- A 15-chapter live run acts as the full long-form acceptance test.
- Human skim points are required at chapters 1, 5, 10, and 15 for reader-visible continuity and prose quality.

## Multi-Genre Requirement

No final quality claim is valid if it is proven only on one sample book.

The acceptance harness must include at least these scenario families:

- Urban/system: money, inventory, quest progress, cooldowns, status panels.
- Xianxia: realm level, injuries, spirit stones, sect rules, artifacts.
- Mystery: evidence location, alibi windows, witness knowledge, chronology.
- Sci-fi: fuel, ammunition, ship damage, coordinates, mission state.

The same interfaces should handle all four. Genre fixtures may provide vocabulary, but product logic must remain generic.

## Design Principles

1. User authority is final.
2. Raw user assets must be preserved.
3. Runtime behavior must be diagnosable.
4. Memory must be editable and evidence-linked.
5. Bad chapters must not poison durable memory.
6. Sample failures should produce generic architecture, not sample patches.
7. Tests must protect writing quality and continuity, not only TypeScript correctness.
8. Local data must be recoverable, exportable, and safe from accidental overwrite.
9. The system should prefer clear stop conditions over silently continuing a broken run.
10. Every major feature should answer: how does this help the user finish a long novel?

## Immediate Strategic Correction

The current project direction must stop treating a single live pet-capture run as the implementation target. That run is useful evidence, but it is not the product definition.

The next implementation work should be planned from this product goal downward:

1. Define generic continuity and hard-fact interfaces.
2. Build a gate pipeline that can block state recording.
3. Prove the gate with multi-genre tests.
4. Complete SillyTavern compatibility as an asset/runtime layer.
5. Expose memory and diagnostics to the user.
6. Run long-form acceptance only after the generic layer exists.

## Final Definition Of Success

Scribe succeeds when a user can trust it with a real long-form project: import their creative assets, talk through the story, generate and revise chapters, inspect what the AI remembered, correct what it got wrong, continue for many chapters, and export a coherent manuscript without constantly fighting AI amnesia or hidden context drift.
