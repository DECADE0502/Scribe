# Issue: long-context continuity and POV drift

Date: 2026-06-23

## User-visible Problem

During an actual book-writing run, the user explicitly asked for first-person narration. Chapter 1 followed the requested POV, but Chapter 2 drifted away from it.

This strongly suggests that the writing agent is not reliably seeing enough of the prior prose and durable style contract when generating later chapters. For a continuous novel, this is a core product bug: the author expects later chapters to inherit the same POV, diction, pacing, character voice, and scene continuity unless explicitly changed.

## Evidence Observed

- Latest `logs/backend.log` only shows HTTP-level traces. It confirms Chapter 2 was generated after Chapter 1, but it does not log the final prompt/messages sent to the model.
- `packages/server/src/ai/context-builder/snapshot.ts` already has a `recentFullChapters` field intended to hold the latest 10 chapters as full text.
- `packages/server/src/ai/context-builder/builder.ts` currently builds the write prompt from:
  - core setting/rules;
  - foreshadowing;
  - records;
  - characters;
  - worldbook;
  - reader issues;
  - recalled summaries;
  - `recentSummaries.slice(0, 3)`;
  - latest user instruction.
- `builder.ts` does not currently include `snapshot.recentFullChapters` in the final section list, even though `snapshot.ts` loads it.
- The active write-context budget is still around `32_000` estimated tokens, which is far below a 1M-context model's practical capacity.

Therefore the most likely failure mode is:

1. Chapter 1 is generated correctly because the user instruction is fresh.
2. Chapter 2 is generated mostly from summaries/state, not Chapter 1 full prose.
3. The summary/audit layer may not preserve narrative POV strongly enough.
4. The model falls back to a generic chapter style instead of continuing the exact prior narrative contract.

## Product Requirement

The writing agent must understand all content it reasonably should know for a continuous novel. The desired memory layout is:

- latest 10 chapters: full prose;
- chapters 11-20 before the current chapter: per-chapter summaries;
- chapters older than that: larger arc/book-level digests;
- always include durable writing contracts such as POV, tense, style reference, ending rules, character voice, and active user rules;
- always include current chapter outline/plan and latest user instruction at the highest priority.

The goal is not merely factual continuity. The model must preserve:

- narrative POV, especially first-person vs third-person;
- tense and narrative distance;
- protagonist voice;
- recurring wording/style constraints;
- chapter-to-chapter scene carryover;
- unresolved beats from the previous chapter;
- durable hard facts and structured state.

## Recommended 1M Context Strategy

Use a large-context writing profile when the selected model supports it. Do not keep the write prompt capped at 32k for 1M models.

### Context Layers

1. Contract Layer, highest priority
   - system prompt;
   - deepest prompt if enabled;
   - book rules;
   - selected style reference;
   - explicit narrative contract extracted from user/book settings: POV, tense, narrator identity, prose constraints, banned endings, chapter length preference.

2. Current Task Layer
   - target chapter number;
   - precise chapter outline node;
   - latest user instruction;
   - rewrite/current draft if rewriting.

3. Immediate Prose Layer
   - full text of the latest 10 chapters before the target chapter, ordered oldest to newest.
   - This layer is essential for POV and prose rhythm. It should be above generic records/character archives in priority.

4. Mid-range Memory Layer
   - chapters 11-20 before the target chapter as oneLiner + paragraph + key events.
   - Include enough detail to keep arcs, relationship changes, and unresolved setups coherent.

5. Long-range Digest Layer
   - chapters older than 20 compressed into arc-level and book-level digests.
   - This should be maintained explicitly, not improvised from scattered summaries every time.

6. Structured State Layer
   - characters with currentState;
   - active foreshadowing;
   - timeline hard facts;
   - generic record collections;
   - reader continuity issues.

7. Retrieval Layer
   - targeted recalled chapters, worldbook entries, and records based on current chapter plan and user instruction.
   - Retrieval supplements the fixed sliding window; it must not replace the latest 10 full chapters.

### Budget Policy

For 1M-capable models, reserve budget approximately like this:

- 20k-50k: contract, rules, style, current task;
- 300k-600k: latest 10 full chapters, depending on chapter length;
- 50k-120k: mid-range summaries and long-range digest;
- 50k-150k: structured state, worldbook, records, reader issues;
- 50k-150k: retrieved historical material and safety margin;
- remaining budget: generation output.

If a model has a smaller context window, degrade gracefully:

1. keep contract + current task;
2. keep latest 1-3 full chapters;
3. summarize the rest;
4. keep structured state;
5. drop broad records before dropping immediate prior prose.

### Audit and State Recording Changes Needed Later

Future implementation should make audit output explicitly preserve narrative contract:

- `summary` should include `pov`, `tense`, `narrator`, `styleFingerprint`, and `continuityCarryover`.
- `readerIssues` should record POV drift as a durable warning if a chapter violates the previous narrative contract.
- `recordChapterState` should not be the only source of writing continuity; it is good for facts, not enough for prose voice.

### Diagnostics Needed Later

Add non-secret prompt diagnostics for write calls:

- kept/dropped context section IDs;
- token estimates per section;
- included full chapter numbers;
- included summary chapter numbers;
- model context profile used;
- whether narrative contract was present.

Do not log full prose by default. A debug switch may write prompt snapshots to local ignored files for development only.

## Acceptance Criteria For Future Fix

- If Chapter 1 is first-person and the user does not request a POV change, Chapter 2 remains first-person.
- A test can seed Chapter 1 full prose containing first-person markers, generate/build Chapter 2 context, and assert Chapter 1 full text is included in messages.
- A test can assert `recentFullChapters` is not silently loaded and then dropped from the write prompt.
- A budget test can assert 1M-capable models use a large write-context budget instead of the legacy 32k cap.
- The UI/debug trace can show which chapter texts/summaries were included without exposing secrets.

