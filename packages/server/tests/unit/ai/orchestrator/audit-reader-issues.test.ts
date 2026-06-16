import { describe, expect, it } from "vitest";
import type { AuditResult } from "../../../../src/ai/orchestrator/audit-chapter.js";
import { persistAuditResult } from "../../../../src/ai/orchestrator/audit-persist.js";

function auditResult(): AuditResult {
  return {
    output: {
      verdict: "warning",
      issues: [
        {
          dimension: "character_behavior",
          severity: "warning",
          score: 5,
          excerpt: "He agrees without motivation.",
          note: "Character choice lacks setup.",
        },
        {
          dimension: "pacing",
          severity: "ok",
          score: 8,
          note: "ok",
        },
      ],
      summary: {
        oneLiner: "A test summary",
        paragraph: "This paragraph is intentionally long enough to resemble a valid audit summary for persistence in tests.",
        keyEvents: [],
      },
    },
    usage: {
      promptTokens: 0,
      completionTokens: 0,
      cachedTokens: 0,
      reasoningTokens: 0,
    },
    rawText: "{}",
  };
}

describe("audit persistence reader issues", () => {
  it("persists warning and critical audit issues as open reader issues", () => {
    const savedIssues: unknown[] = [];
    const repo = {
      saveAudit() {},
      saveSummary() {},
    };
    const readerIssuesRepo = {
      create(input: unknown) {
        savedIssues.push(input);
      },
    };

    persistAuditResult(repo, 4, auditResult(), "audit-model", readerIssuesRepo);

    expect(savedIssues).toEqual([{
      chapterNo: 4,
      type: "character_behavior",
      severity: "warning",
      note: "Character choice lacks setup.",
      evidence: "He agrees without motivation.",
      suggestedAction: "Address this before or during the next chapter.",
      status: "open",
    }]);
  });
});
