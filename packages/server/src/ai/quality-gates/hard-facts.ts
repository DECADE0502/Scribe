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
    dimension: "continuity",
    note: contradiction.message,
    excerpt: [
      `prior: ${contradiction.prior.evidence}`,
      `current: ${contradiction.current.evidence}`,
      `suggestion: revise the chapter so ${contradiction.entity}.${contradiction.attribute} either keeps the prior value (${normalizeFactValue(contradiction.prior.value)}) or clearly shows the cause of changing to ${normalizeFactValue(contradiction.current.value)}.`,
    ].join("\n"),
  }));
}
