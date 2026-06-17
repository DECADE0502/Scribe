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
