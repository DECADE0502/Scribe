# Scribe Phase 1 Generic Continuity Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first product-critical foundation from the ultimate goal: a generic, cross-genre hard-fact quality gate that can detect unresolved continuity contradictions, trigger repair, and block durable state recording.

**Architecture:** Keep this phase server-side and focused. Add a small hard-fact domain module that represents prior facts, current chapter claims, and contradictions without genre-specific keywords; add deterministic comparison for structured facts; add a quality gate adapter that feeds contradictions into `writeWithAudit()` repair; and prevent `recordChapterState()` from running when unresolved gate failures remain. This phase intentionally does not finish UI, export, or all SillyTavern compatibility.

**Tech Stack:** TypeScript, Vitest, existing Hono server, existing `writeWithAudit()`, `recordChapterState()`, SQLite-backed repos, existing `RepairContext["issues"]` shape, and current Scribe context-builder patterns.

---

## Scope Boundary

The ultimate product goal covers many subsystems. This plan implements only Phase 1:

- Generic hard-fact schema.
- Deterministic hard-fact contradiction checks for structured facts.
- Quality gate adapter for `writeWithAudit()`.
- Safe state-recording guard.
- Multi-genre tests proving the gate is not sample-specific.
- Documentation that later phases must build on this layer.

This plan does not implement full SillyTavern runtime compatibility, preset/worldbook UI, export UX, model-assisted prose extraction, or 15-chapter live acceptance. Those become later phase plans after this foundation is stable.

## File Structure

- Create `packages/server/src/ai/quality-gates/hard-facts.ts`: hard-fact types, normalization, comparison, and repair issue conversion.
- Create `packages/server/src/ai/quality-gates/pipeline.ts`: a gate pipeline that returns repair issues and blocking issues.
- Create `packages/server/src/ai/quality-gates/archive-hard-facts.ts`: extraction from character state, timeline events, and generic records.
- Modify `packages/server/src/ai/orchestrator/record-state.ts`: add a preflight guard so failed gates block durable memory writes.
- Modify or verify `packages/server/src/ai/orchestrator/write-with-audit.ts`: keep the generic `qualityGate` hook and ensure repair results expose unresolved gate issues.
- Modify `docs/HANDOFF-codex.md`: make the ultimate product goal and Phase 1 plan the controlling direction.
- Create `docs/superpowers/plans/2026-06-17-scribe-final-roadmap.md`: decomposes the full product goal into phases.

## Task 1: Add Generic Hard-Fact Domain Model

**Files:**
- Create: `packages/server/src/ai/quality-gates/hard-facts.ts`
- Test: `packages/server/tests/unit/ai/quality-gates/hard-facts.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/server/tests/unit/ai/quality-gates/hard-facts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  compareHardFacts,
  hardFactContradictionsToRepairIssues,
  type HardFactClaim,
} from "../../../../src/ai/quality-gates/hard-facts.js";

function fact(input: Partial<HardFactClaim> & Pick<HardFactClaim, "entity" | "attribute" | "value">): HardFactClaim {
  return {
    entity: input.entity,
    attribute: input.attribute,
    value: input.value,
    factType: input.factType ?? "state",
    scope: input.scope ?? "book",
    source: input.source ?? "prior_state",
    evidence: input.evidence ?? "test evidence",
    confidence: input.confidence ?? 1,
    chapterNo: input.chapterNo,
    operation: input.operation,
    cause: input.cause,
  };
}

describe("compareHardFacts", () => {
  it("detects an urban resource quantity contradiction", () => {
    const result = compareHardFacts({
      priorFacts: [fact({ entity: "wallet", attribute: "cash", value: { quantity: 1200, unit: "yuan" } })],
      currentClaims: [fact({ entity: "wallet", attribute: "cash", value: { quantity: 300, unit: "yuan" }, source: "chapter_claim" })],
    });

    expect(result.passed).toBe(false);
    expect(result.contradictions).toContainEqual(expect.objectContaining({
      kind: "quantity_changed_without_cause",
      entity: "wallet",
      attribute: "cash",
    }));
  });

  it("allows a quantity change when the chapter claim carries an explicit cause", () => {
    const result = compareHardFacts({
      priorFacts: [fact({ entity: "wallet", attribute: "cash", value: { quantity: 1200, unit: "yuan" } })],
      currentClaims: [fact({
        entity: "wallet",
        attribute: "cash",
        value: { quantity: 300, unit: "yuan" },
        operation: "decrease",
        cause: "paid 900 yuan for medicine",
        source: "chapter_claim",
      })],
    });

    expect(result.passed).toBe(true);
    expect(result.contradictions).toEqual([]);
  });

  it("detects a xianxia status contradiction", () => {
    const result = compareHardFacts({
      priorFacts: [fact({ entity: "Lin Chen", attribute: "realm", value: "Qi Refining 3" })],
      currentClaims: [fact({ entity: "Lin Chen", attribute: "realm", value: "Foundation Establishment", source: "chapter_claim" })],
    });

    expect(result.contradictions[0]).toMatchObject({
      kind: "state_changed_without_cause",
      entity: "Lin Chen",
      attribute: "realm",
    });
  });

  it("detects a mystery evidence location contradiction", () => {
    const result = compareHardFacts({
      priorFacts: [fact({ entity: "bloody knife", attribute: "location", value: "locked drawer" })],
      currentClaims: [fact({ entity: "bloody knife", attribute: "location", value: "riverbank", source: "chapter_claim" })],
    });

    expect(result.contradictions[0]).toMatchObject({
      kind: "state_changed_without_cause",
      entity: "bloody knife",
      attribute: "location",
    });
  });

  it("detects a sci-fi resource contradiction", () => {
    const result = compareHardFacts({
      priorFacts: [fact({ entity: "ship", attribute: "fuel", value: { quantity: 18, unit: "percent" } })],
      currentClaims: [fact({ entity: "ship", attribute: "fuel", value: { quantity: 72, unit: "percent" }, source: "chapter_claim" })],
    });

    expect(result.contradictions[0]).toMatchObject({
      kind: "quantity_changed_without_cause",
      entity: "ship",
      attribute: "fuel",
    });
  });

  it("converts contradictions into repair issues", () => {
    const result = compareHardFacts({
      priorFacts: [fact({ entity: "ship", attribute: "fuel", value: { quantity: 18, unit: "percent" } })],
      currentClaims: [fact({ entity: "ship", attribute: "fuel", value: { quantity: 72, unit: "percent" }, source: "chapter_claim" })],
    });

    const issues = hardFactContradictionsToRepairIssues(result.contradictions);
    expect(issues).toContainEqual(expect.objectContaining({
      severity: "critical",
      category: "continuity",
    }));
    expect(issues[0]!.note).toContain("ship.fuel");
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
pnpm --filter @scribe/server test -- hard-facts.test.ts
```

Expected: fail because `quality-gates/hard-facts.ts` does not exist.

- [ ] **Step 3: Implement `hard-facts.ts`**

Create `packages/server/src/ai/quality-gates/hard-facts.ts`:

```ts
import type { RepairContext } from "../prompts/repair-chapter.js";

export type HardFactValue =
  | string
  | number
  | boolean
  | null
  | { quantity: number; unit?: string; raw?: string };

export type HardFactType =
  | "state"
  | "quantity"
  | "location"
  | "ownership"
  | "relationship"
  | "deadline"
  | "cooldown"
  | "injury"
  | "task";

export interface HardFactClaim {
  entity: string;
  attribute: string;
  value: HardFactValue;
  factType: HardFactType;
  scope: "book" | "character" | "location" | "chapter" | "scene";
  source: "prior_state" | "chapter_claim" | "timeline" | "generic_record" | "character_state" | "manual";
  evidence: string;
  confidence: number;
  chapterNo?: number;
  operation?: "set" | "increase" | "decrease" | "move" | "transfer" | "resolve" | "damage" | "heal";
  cause?: string;
}

export type HardFactContradictionKind =
  | "quantity_changed_without_cause"
  | "state_changed_without_cause"
  | "unit_mismatch"
  | "type_mismatch";

export interface HardFactContradiction {
  kind: HardFactContradictionKind;
  entity: string;
  attribute: string;
  prior: HardFactClaim;
  current: HardFactClaim;
  message: string;
}

export interface HardFactGateInput {
  priorFacts: HardFactClaim[];
  currentClaims: HardFactClaim[];
}

export interface HardFactGateResult {
  passed: boolean;
  contradictions: HardFactContradiction[];
}

export function normalizeFactValue(value: HardFactValue): string {
  if (value === null) return "null";
  if (typeof value === "object") {
    const unit = value.unit ? ` ${value.unit}` : "";
    return `${value.quantity}${unit}`.trim();
  }
  return String(value).trim();
}

export function factIdentityKey(fact: Pick<HardFactClaim, "entity" | "attribute" | "scope">): string {
  return [fact.scope, fact.entity.trim().toLowerCase(), fact.attribute.trim().toLowerCase()].join("::");
}

function isQuantityValue(value: HardFactValue): value is { quantity: number; unit?: string; raw?: string } {
  return typeof value === "object" && value !== null && "quantity" in value && typeof value.quantity === "number";
}

function hasExplicitCause(claim: HardFactClaim): boolean {
  return Boolean(claim.cause?.trim() || claim.operation);
}

function valuesEqual(a: HardFactValue, b: HardFactValue): boolean {
  if (isQuantityValue(a) && isQuantityValue(b)) {
    return a.quantity === b.quantity && (a.unit ?? "") === (b.unit ?? "");
  }
  return normalizeFactValue(a) === normalizeFactValue(b);
}

export function compareHardFacts(input: HardFactGateInput): HardFactGateResult {
  const priorByKey = new Map<string, HardFactClaim>();
  for (const fact of input.priorFacts) priorByKey.set(factIdentityKey(fact), fact);

  const contradictions: HardFactContradiction[] = [];
  for (const current of input.currentClaims) {
    const prior = priorByKey.get(factIdentityKey(current));
    if (!prior || valuesEqual(prior.value, current.value) || hasExplicitCause(current)) continue;

    if (isQuantityValue(prior.value) && isQuantityValue(current.value)) {
      if ((prior.value.unit ?? "") !== (current.value.unit ?? "")) {
        contradictions.push({
          kind: "unit_mismatch",
          entity: current.entity,
          attribute: current.attribute,
          prior,
          current,
          message: `${current.entity}.${current.attribute} unit changed from ${prior.value.unit ?? "none"} to ${current.value.unit ?? "none"} without cause`,
        });
      } else {
        contradictions.push({
          kind: "quantity_changed_without_cause",
          entity: current.entity,
          attribute: current.attribute,
          prior,
          current,
          message: `${current.entity}.${current.attribute} changed from ${normalizeFactValue(prior.value)} to ${normalizeFactValue(current.value)} without an explicit in-chapter cause`,
        });
      }
      continue;
    }

    if (isQuantityValue(prior.value) !== isQuantityValue(current.value)) {
      contradictions.push({
        kind: "type_mismatch",
        entity: current.entity,
        attribute: current.attribute,
        prior,
        current,
        message: `${current.entity}.${current.attribute} changed value type from ${normalizeFactValue(prior.value)} to ${normalizeFactValue(current.value)} without cause`,
      });
      continue;
    }

    contradictions.push({
      kind: "state_changed_without_cause",
      entity: current.entity,
      attribute: current.attribute,
      prior,
      current,
      message: `${current.entity}.${current.attribute} changed from ${normalizeFactValue(prior.value)} to ${normalizeFactValue(current.value)} without an explicit in-chapter cause`,
    });
  }

  return { passed: contradictions.length === 0, contradictions };
}

export function hardFactContradictionsToRepairIssues(
  contradictions: HardFactContradiction[],
): RepairContext["issues"] {
  return contradictions.map((contradiction) => ({
    severity: "critical" as const,
    category: "continuity" as const,
    note: contradiction.message,
    evidence: [
      `prior: ${contradiction.prior.evidence}`,
      `current: ${contradiction.current.evidence}`,
    ].join("\n"),
    suggestion: `Revise the chapter so ${contradiction.entity}.${contradiction.attribute} either keeps the prior value (${normalizeFactValue(contradiction.prior.value)}) or clearly shows the cause of changing to ${normalizeFactValue(contradiction.current.value)}.`,
  }));
}
```

- [ ] **Step 4: Run the hard-fact tests**

Run:

```bash
pnpm --filter @scribe/server test -- hard-facts.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add packages/server/src/ai/quality-gates/hard-facts.ts packages/server/tests/unit/ai/quality-gates/hard-facts.test.ts
git commit -m "Add generic hard fact gate model"
```

## Task 2: Extract Prior Hard Facts From Existing Archive State

**Files:**
- Create: `packages/server/src/ai/quality-gates/archive-hard-facts.ts`
- Test: `packages/server/tests/unit/ai/quality-gates/archive-hard-facts.test.ts`

- [ ] **Step 1: Write the failing extraction tests**

Create `packages/server/tests/unit/ai/quality-gates/archive-hard-facts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { extractArchiveHardFacts } from "../../../../src/ai/quality-gates/archive-hard-facts.js";

describe("extractArchiveHardFacts", () => {
  it("extracts character current state as hard facts", () => {
    const facts = extractArchiveHardFacts({
      characters: [{ name: "Lin Chen", currentState: { location: "east gate", realm: "Qi Refining 3" } }],
      timelineEvents: [],
      genericRecords: [],
    });

    expect(facts).toContainEqual(expect.objectContaining({
      entity: "Lin Chen",
      attribute: "location",
      value: "east gate",
      source: "character_state",
    }));
    expect(facts).toContainEqual(expect.objectContaining({
      entity: "Lin Chen",
      attribute: "realm",
      value: "Qi Refining 3",
    }));
  });

  it("extracts generic record fields with identity and evidence", () => {
    const facts = extractArchiveHardFacts({
      characters: [],
      timelineEvents: [],
      genericRecords: [{
        collectionName: "Ship State",
        identity: "ship",
        data: { fuel: { quantity: 18, unit: "percent" }, location: "Europa orbit" },
      }],
    });

    expect(facts).toContainEqual(expect.objectContaining({
      entity: "ship",
      attribute: "fuel",
      value: { quantity: 18, unit: "percent" },
      source: "generic_record",
    }));
    expect(facts).toContainEqual(expect.objectContaining({
      entity: "ship",
      attribute: "location",
      value: "Europa orbit",
    }));
  });

  it("extracts timeline events as evidence facts without inventing attributes", () => {
    const facts = extractArchiveHardFacts({
      characters: [],
      timelineEvents: [{ chapterNo: 4, storyTime: "23:10", event: "The knife was locked in the drawer.", participants: ["Detective"] }],
      genericRecords: [],
    });

    expect(facts).toContainEqual(expect.objectContaining({
      entity: "timeline",
      attribute: "event",
      value: "The knife was locked in the drawer.",
      source: "timeline",
      chapterNo: 4,
    }));
  });
});
```

- [ ] **Step 2: Run the failing extraction tests**

Run:

```bash
pnpm --filter @scribe/server test -- archive-hard-facts.test.ts
```

Expected: fail because the module does not exist.

- [ ] **Step 3: Implement `archive-hard-facts.ts`**

Create `packages/server/src/ai/quality-gates/archive-hard-facts.ts`:

```ts
import type { HardFactClaim, HardFactValue } from "./hard-facts.js";

export interface ArchiveHardFactSources {
  characters: Array<{ name: string; currentState: Record<string, unknown> }>;
  timelineEvents: Array<{ chapterNo: number; storyTime: string | null; event: string; participants: string[] }>;
  genericRecords: Array<{ collectionName: string; identity: string; data: Record<string, unknown> }>;
}

function isFactValue(value: unknown): value is HardFactValue {
  if (value === null) return true;
  if (["string", "number", "boolean"].includes(typeof value)) return true;
  if (typeof value === "object" && value !== null && "quantity" in value) {
    const maybe = value as { quantity?: unknown; unit?: unknown; raw?: unknown };
    return typeof maybe.quantity === "number" &&
      (maybe.unit === undefined || typeof maybe.unit === "string") &&
      (maybe.raw === undefined || typeof maybe.raw === "string");
  }
  return false;
}

function coerceFactValue(value: unknown): HardFactValue | undefined {
  if (isFactValue(value)) return value;
  if (Array.isArray(value)) return value.length ? value.join(", ") : undefined;
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return undefined;
}

function inferFactType(attribute: string, value: HardFactValue): HardFactClaim["factType"] {
  const lower = attribute.toLowerCase();
  if (typeof value === "object" && value !== null && "quantity" in value) return "quantity";
  if (["location", "position", "where", "地点", "位置"].some((term) => lower.includes(term.toLowerCase()))) return "location";
  if (["owner", "holder", "belong", "归属", "持有者"].some((term) => lower.includes(term.toLowerCase()))) return "ownership";
  if (["deadline", "timer", "cooldown", "倒计时", "期限", "冷却"].some((term) => lower.includes(term.toLowerCase()))) return "deadline";
  if (["injury", "wound", "伤", "伤势"].some((term) => lower.includes(term.toLowerCase()))) return "injury";
  if (["relation", "relationship", "关系", "契约"].some((term) => lower.includes(term.toLowerCase()))) return "relationship";
  return "state";
}

export function extractArchiveHardFacts(src: ArchiveHardFactSources): HardFactClaim[] {
  const facts: HardFactClaim[] = [];

  for (const character of src.characters) {
    for (const [attribute, rawValue] of Object.entries(character.currentState ?? {})) {
      const value = coerceFactValue(rawValue);
      if (value === undefined) continue;
      facts.push({
        entity: character.name,
        attribute,
        value,
        factType: inferFactType(attribute, value),
        scope: "character",
        source: "character_state",
        evidence: `${character.name}.${attribute}=${typeof value === "object" ? JSON.stringify(value) : String(value)}`,
        confidence: 1,
      });
    }
  }

  for (const record of src.genericRecords) {
    for (const [attribute, rawValue] of Object.entries(record.data ?? {})) {
      const value = coerceFactValue(rawValue);
      if (value === undefined) continue;
      facts.push({
        entity: record.identity,
        attribute,
        value,
        factType: inferFactType(attribute, value),
        scope: "book",
        source: "generic_record",
        evidence: `${record.collectionName}:${record.identity}.${attribute}=${typeof value === "object" ? JSON.stringify(value) : String(value)}`,
        confidence: 1,
      });
    }
  }

  for (const event of src.timelineEvents) {
    facts.push({
      entity: "timeline",
      attribute: "event",
      value: event.event,
      factType: "state",
      scope: "book",
      source: "timeline",
      evidence: event.storyTime ? `${event.storyTime}: ${event.event}` : event.event,
      confidence: 0.7,
      chapterNo: event.chapterNo,
    });
  }

  return facts;
}
```

- [ ] **Step 4: Run extraction tests**

Run:

```bash
pnpm --filter @scribe/server test -- archive-hard-facts.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add packages/server/src/ai/quality-gates/archive-hard-facts.ts packages/server/tests/unit/ai/quality-gates/archive-hard-facts.test.ts
git commit -m "Extract generic hard facts from archive state"
```

## Task 3: Add A Quality Gate Pipeline Adapter

**Files:**
- Create: `packages/server/src/ai/quality-gates/pipeline.ts`
- Test: `packages/server/tests/unit/ai/quality-gates/pipeline.test.ts`

- [ ] **Step 1: Write failing pipeline tests**

Create `packages/server/tests/unit/ai/quality-gates/pipeline.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { runQualityGatePipeline } from "../../../../src/ai/quality-gates/pipeline.js";

const priorFuel = {
  entity: "ship",
  attribute: "fuel",
  value: { quantity: 18, unit: "percent" },
  factType: "quantity" as const,
  scope: "book" as const,
  source: "prior_state" as const,
  evidence: "ship fuel 18%",
  confidence: 1,
};

describe("runQualityGatePipeline", () => {
  it("returns passed when no hard fact contradictions exist", () => {
    const result = runQualityGatePipeline({
      priorFacts: [priorFuel],
      currentClaims: [{ ...priorFuel, source: "chapter_claim" }],
    });

    expect(result.passed).toBe(true);
    expect(result.repairIssues).toEqual([]);
    expect(result.blockingIssues).toEqual([]);
  });

  it("returns repair and blocking issues for hard fact contradictions", () => {
    const result = runQualityGatePipeline({
      priorFacts: [priorFuel],
      currentClaims: [{ ...priorFuel, value: { quantity: 72, unit: "percent" }, source: "chapter_claim", evidence: "ship fuel 72%" }],
    });

    expect(result.passed).toBe(false);
    expect(result.repairIssues).toHaveLength(1);
    expect(result.repairIssues[0]!.severity).toBe("critical");
    expect(result.blockingIssues[0]).toContain("ship.fuel");
  });
});
```

- [ ] **Step 2: Run the failing pipeline tests**

Run:

```bash
pnpm --filter @scribe/server test -- pipeline.test.ts
```

Expected: fail because the module does not exist.

- [ ] **Step 3: Implement `pipeline.ts`**

Create `packages/server/src/ai/quality-gates/pipeline.ts`:

```ts
import type { RepairContext } from "../prompts/repair-chapter.js";
import {
  compareHardFacts,
  hardFactContradictionsToRepairIssues,
  type HardFactClaim,
  type HardFactContradiction,
} from "./hard-facts.js";

export interface QualityGateInput {
  priorFacts: HardFactClaim[];
  currentClaims: HardFactClaim[];
}

export interface QualityGateResult {
  passed: boolean;
  repairIssues: RepairContext["issues"];
  blockingIssues: string[];
  hardFactContradictions: HardFactContradiction[];
}

export function runQualityGatePipeline(input: QualityGateInput): QualityGateResult {
  const hardFactResult = compareHardFacts({
    priorFacts: input.priorFacts,
    currentClaims: input.currentClaims,
  });
  const repairIssues = hardFactContradictionsToRepairIssues(hardFactResult.contradictions);
  return {
    passed: hardFactResult.passed,
    repairIssues,
    blockingIssues: hardFactResult.contradictions.map((contradiction) => contradiction.message),
    hardFactContradictions: hardFactResult.contradictions,
  };
}
```

- [ ] **Step 4: Run pipeline tests**

Run:

```bash
pnpm --filter @scribe/server test -- pipeline.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add packages/server/src/ai/quality-gates/pipeline.ts packages/server/tests/unit/ai/quality-gates/pipeline.test.ts
git commit -m "Add generic quality gate pipeline"
```

## Task 4: Block State Recording When Gates Fail

**Files:**
- Modify: `packages/server/src/ai/orchestrator/record-state.ts`
- Test: `packages/server/tests/unit/ai/orchestrator/record-state.test.ts`

- [ ] **Step 1: Add a failing guard test**

In `packages/server/tests/unit/ai/orchestrator/record-state.test.ts`, add this test inside the existing `describe("recordChapterState", ...)` block:

```ts
it("does not run state tools when quality gate failed", async () => {
  const events = await consume(recordChapterState(
    {
      model: makeStubLanguageModel({ text: "should not be called" }),
      stateDeps: {
        charactersRepo: repos.charactersRepo,
        foreshadowingRepo: repos.foreshadowingRepo,
        timelineRepo: repos.timelineRepo,
        chapterNo: 3,
      },
      genreDeps: {
        repo: repos.genreSectionsRepo,
        charactersRepo: repos.charactersRepo,
      },
    },
    {
      chapterNo: 3,
      chapterContent: "正文里有错误事实。",
      archiveSummary: buildArchiveSummary({
        genreSections: [],
        characters: repos.charactersRepo.list(),
        activeForeshadowing: [],
      }),
      qualityGateResult: {
        passed: false,
        blockingIssues: ["ship.fuel changed from 18 percent to 72 percent without an explicit in-chapter cause"],
      },
    },
  ));

  expect(events).toContainEqual(expect.objectContaining({
    type: "error",
    errorClass: "quality_gate_blocked_state_recording",
  }));
  expect(repos.timelineRepo.listAll()).toEqual([]);
});
```

- [ ] **Step 2: Run the failing guard test**

Run:

```bash
pnpm --filter @scribe/server test -- record-state.test.ts
```

Expected: fail because `qualityGateResult` is not accepted yet.

- [ ] **Step 3: Modify `RecordStateInput` and guard execution**

In `packages/server/src/ai/orchestrator/record-state.ts`, change `RecordStateInput` to include:

```ts
qualityGateResult?: { passed: boolean; blockingIssues: string[] };
```

At the start of `recordChapterState()`, before constructing tools, add:

```ts
  if (input.qualityGateResult && !input.qualityGateResult.passed) {
    yield {
      type: "error",
      errorClass: "quality_gate_blocked_state_recording",
      message: [
        "质量门禁未通过,本章不会写入长期记忆。",
        ...input.qualityGateResult.blockingIssues.map((issue) => `- ${issue}`),
      ].join("\n"),
    };
    return;
  }
```

- [ ] **Step 4: Run record-state tests**

Run:

```bash
pnpm --filter @scribe/server test -- record-state.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add packages/server/src/ai/orchestrator/record-state.ts packages/server/tests/unit/ai/orchestrator/record-state.test.ts
git commit -m "Block state recording on failed quality gates"
```

## Task 5: Prove `writeWithAudit()` Repairs On Gate Issues

**Files:**
- Modify: `packages/server/tests/integration/write-then-audit.test.ts`
- Modify if needed: `packages/server/src/ai/orchestrator/write-with-audit.ts`

- [ ] **Step 1: Add integration test for quality gate repair**

In `packages/server/tests/integration/write-then-audit.test.ts`, add a test near existing `qualityGate` tests:

```ts
it("repairs when generic quality gate returns hard-fact issues even if audit is ok", async () => {
  const events = await collect(writeWithAudit(
    deps,
    {
      chapterNo: 12,
      userIntent: "continue",
      ctx: { premise: "sci-fi ship story" },
      auditCtx: { premise: "sci-fi ship story" },
      qualityGate: ({ stage }) => stage === "draft"
        ? [{
            severity: "critical",
            category: "continuity",
            note: "ship.fuel changed from 18 percent to 72 percent without an explicit in-chapter cause",
            evidence: "prior: ship fuel 18%\ncurrent: ship fuel 72%",
            suggestion: "Keep fuel at 18 percent or show refueling.",
          }]
        : [],
    },
  ));

  expect(events).toContainEqual(expect.objectContaining({
    type: "tool_call_start",
    toolName: "chapter_repair",
  }));
  expect(events).toContainEqual(expect.objectContaining({
    type: "tool_call_end",
    toolName: "chapter_repair_audit",
  }));
  expect(events.at(-1)).toEqual({ type: "done" });
});
```

If the fixture in this file uses different input property names, mirror an adjacent `writeWithAudit()` test and only change the `qualityGate` body.

- [ ] **Step 2: Run the integration test**

Run:

```bash
pnpm --filter @scribe/server test -- write-then-audit.test.ts
```

Expected: pass if current hook is sufficient; fail if the repair audit event does not include unresolved gate state.

- [ ] **Step 3: Patch `write-with-audit.ts` only if the test fails**

If the repair path does not expose gate state, ensure the existing repair audit event includes:

```ts
qualityIssues: repairQualityIssues.issues.map((issue) => issue.note),
stillCritical: reAudit.output.verdict === "critical" || repairQualityIssues.issues.length > 0,
```

Do not add hard-fact-specific terms to this file.

- [ ] **Step 4: Run the integration test again**

Run:

```bash
pnpm --filter @scribe/server test -- write-then-audit.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add packages/server/tests/integration/write-then-audit.test.ts packages/server/src/ai/orchestrator/write-with-audit.ts
git commit -m "Verify quality gate repair path"
```

If `write-with-audit.ts` did not change, omit it from `git add`.

## Task 6: Document Product Roadmap And Phase Priority

**Files:**
- Modify: `docs/HANDOFF-codex.md`
- Create: `docs/superpowers/plans/2026-06-17-scribe-final-roadmap.md`

- [ ] **Step 1: Create final roadmap document**

Create `docs/superpowers/plans/2026-06-17-scribe-final-roadmap.md`:

```md
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
```

- [ ] **Step 2: Update handoff with the new priority**

At the top of `docs/HANDOFF-codex.md`, add:

```md
## 2026-06-17 Product Goal Reset

The controlling spec is now:

- `docs/superpowers/specs/2026-06-17-scribe-ultimate-product-goal.md`

The immediate implementation plan is:

- `docs/superpowers/plans/2026-06-17-scribe-phase1-generic-continuity-gates.md`

Do not continue sample-specific optimization. The first product-critical foundation is generic continuity gating that prevents failed chapters from entering durable memory.
```

- [ ] **Step 3: Run documentation checks**

Run:

```bash
rg -n "T" docs/superpowers/plans/2026-06-17-scribe-final-roadmap.md docs/HANDOFF-codex.md
```

Expected: no placeholder markers, incomplete-section labels, or future-work markers. The command is intentionally broad; inspect any match and remove only real placeholders.

- [ ] **Step 4: Commit**

Run:

```bash
git add docs/HANDOFF-codex.md docs/superpowers/plans/2026-06-17-scribe-final-roadmap.md
git commit -m "Document Scribe final roadmap"
```

## Task 7: Phase 1 Verification

**Files:**
- No source changes unless verification exposes a focused defect.

- [ ] **Step 1: Run Phase 1 focused tests**

Run:

```bash
pnpm --filter @scribe/server test -- hard-facts.test.ts archive-hard-facts.test.ts pipeline.test.ts record-state.test.ts write-then-audit.test.ts
```

Expected: all tests pass.

- [ ] **Step 2: Run server typecheck**

Run:

```bash
pnpm --filter @scribe/server typecheck
```

Expected: exit code 0.

- [ ] **Step 3: Run existing gate/context smoke tests**

Run:

```bash
pnpm --filter @scribe/server test -- output-sanitize.test.ts write-chapter.test.ts repair-chapter.test.ts sillytavern-longform-monitor.test.ts book-context.test.ts audit-worldbook-context.test.ts
```

Expected: all tests pass.

- [ ] **Step 4: Inspect git history**

Run:

```bash
git log --oneline --decorate -8
git status --short --branch
```

Expected: recent commits show Phase 1 work and working tree is clean.

## Self-Review

Spec coverage:

- Ultimate goal requires generic quality gates and blocked state recording. Tasks 1-5 implement that first foundation.
- Ultimate goal requires multi-genre verification. Task 1 includes urban/system, xianxia, mystery, and sci-fi tests.
- Ultimate goal requires later SillyTavern compatibility, UI, export, and live acceptance. Task 6 routes these to later phases instead of pretending this plan completes them.

Completeness marker scan:

- This plan intentionally contains no placeholder markers.
- Every implementation task names concrete files, tests, commands, and expected outcomes.

Type consistency:

- Hard-fact types are defined in Task 1 and reused by Tasks 2 and 3.
- `qualityGateResult` is consistently `{ passed: boolean; blockingIssues: string[] }`.
- Existing `RepairContext["issues"]` is reused rather than inventing a second repair issue type.
