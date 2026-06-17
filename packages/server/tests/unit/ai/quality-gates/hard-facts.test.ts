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
      dimension: "continuity",
    }));
    expect(issues[0]!.note).toContain("ship.fuel");
  });
});
