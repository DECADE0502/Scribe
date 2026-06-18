# Scribe Final Roadmap

This roadmap decomposes `docs/superpowers/specs/2026-06-17-scribe-ultimate-product-goal.md` into implementation phases.

## Phase 1: Generic Continuity Gates

Goal: prevent bad chapters from poisoning durable memory.

Deliverables:

- generic hard-fact claim schema;
- archive hard-fact extraction;
- quality gate pipeline;
- state-recording guard;
- multi-genre tests.

Status: implemented by `docs/superpowers/plans/2026-06-17-scribe-phase1-generic-continuity-gates.md`.

## Phase 2: Model-Assisted Hard-Fact Extraction

Goal: extract current chapter claims from prose using a genre-neutral schema.

Deliverables:

- prompt and parser for hard-fact claim extraction;
- deterministic fallback for structured status panels;
- evidence spans;
- confidence thresholds;
- repair loop integration.

## Phase 3: SillyTavern Runtime Compatibility

Goal: finish preset and worldbook runtime compatibility as an asset/runtime layer.

Deliverables:

- prompt stack compiler diagnostics;
- macro compatibility;
- regex placement and safety;
- worldbook retrieval semantics;
- trigger preview.

## Phase 4: Memory And Diagnostics UI

Goal: make memory inspectable and correctable by the user.

Deliverables:

- hard facts panel;
- quality gate report panel;
- memory lock/delete/correction actions;
- chapter diagnostics view.

## Phase 5: Workspace Completion

Goal: turn the app into a complete long-form writing workspace.

Deliverables:

- improved book setup;
- version/diff workflows;
- export package;
- backup/restore UX;
- cost diagnostics.

## Phase 6: Acceptance Harness

Goal: prove long-form quality across genres.

Deliverables:

- urban/system fixture;
- xianxia fixture;
- mystery fixture;
- sci-fi fixture;
- 5-chapter smoke runs;
- 15-chapter acceptance runs;
- manual skim checklist.
