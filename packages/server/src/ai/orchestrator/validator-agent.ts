import type { ValidationReport } from "@scribe/shared";
import type { StagedChange } from "./workflow-staging.js";

export interface ValidatorDeps {
  handle: {
    bookId: string;
    chapterFiles?: { read(no: number): { content: string } | undefined };
    charactersRepo?: { list(): Array<{ name: string }> };
    readerIssuesRepo?: { create(input: { chapterNo: number; type: "continuity"; severity: "warning"; note: string }): unknown };
  };
  model: unknown;
  auditModelId?: string;
}

export async function validateStagedChanges(
  deps: ValidatorDeps,
  changes: StagedChange[],
  _userMessage: string,
): Promise<ValidationReport> {
  const issues: ValidationReport["issues"] = [];
  const chapterChanges = changes.filter((c) => c.type === "chapter_version");

  for (const ch of chapterChanges) {
    const p = ch.payload as { chapterNo: number; content: string };
    if (!p.content || p.content.trim().length < 100) {
      issues.push({
        severity: "warning",
        area: "chapter",
        message: `第 ${p.chapterNo} 章正文不足 100 字`,
        suggestedAction: "repair",
      });
    }
  }

  if (issues.length === 0) {
    return { verdict: "pass", issues: [], commitAllowed: true };
  }
  const hasCritical = issues.some((i) => i.severity === "critical");
  if (hasCritical) {
    return { verdict: "fail", issues, commitAllowed: false };
  }
  return { verdict: "repairable", issues, commitAllowed: false };
}
