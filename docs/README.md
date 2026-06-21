# Scribe Documentation

This directory contains project specs, implementation plans, handoff notes, and development evidence.

Recommended reading order for a new agent:

1. `docs/HANDOFF-codex.md`
   - Current canonical handoff. Start here.
2. `docs/HANDOFF-2026-06-22.md`
   - Dated snapshot of the latest cleanup/push state.
3. `docs/superpowers/specs/2026-06-17-scribe-ultimate-product-goal.md`
   - Product goal and writing-quality bar.
4. `docs/superpowers/specs/2026-06-21-agent-workflow-execution-design.md`
   - Workflow execution design.
5. `docs/superpowers/plans/2026-06-21-agent-workflow-execution.md`
   - Implementation plan for the workflow execution work.
6. `docs/superpowers/plans/2026-06-17-scribe-phase1-generic-continuity-gates.md`
   - Generic hard-fact continuity plan.
7. `docs/superpowers/plans/2026-06-17-scribe-final-roadmap.md`
   - Broader roadmap.

Directory boundaries:

- `specs/`: product goals and design principles.
- `plans/`: implementation plans.
- `sdd/`: subtask, review, and execution artifacts from subagent-driven development sessions.
- `_backups/`: historical archive only.
- `HANDOFF-codex.md`: current state and next-agent instructions.
- `HANDOFF-*.md`: dated handoff snapshots.

Do not commit secrets, runtime DBs, or private local exports. Runtime data normally lives under `%APPDATA%\scribe\`, outside this repository.
