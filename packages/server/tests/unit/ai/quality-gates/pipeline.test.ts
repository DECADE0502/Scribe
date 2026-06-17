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
