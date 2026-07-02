import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf-8");
}

describe("legacy trigger tool guard", () => {
  it("does not expose heavy workflow trigger tools from the book tools registry", () => {
    const source = read("src/ai/tools/book-tools.ts");

    expect(source).not.toContain("makeTriggerTools");
    expect(source).not.toContain("TriggerAction");
    expect(source).not.toContain("__action");
    expect(source).not.toContain("write_next_chapter");
    expect(source).not.toContain("rewrite_chapter");
    expect(source).not.toContain("\"delete_chapters\"");
    expect(source).not.toContain("audit_chapter");
    expect(source).not.toContain("plannedChapterWriteFlow");
    expect(source).not.toContain("plannedAuditFlow");
    expect(source).not.toContain("plannedDeleteFlow");
    expect(source).not.toContain("delete_chapters_from");
  });

  it("legacy conversation orchestrator is removed instead of being kept as a second executable path", () => {
    expect(existsSync(resolve(process.cwd(), "src/ai/orchestrator/conversation-orchestrator.ts"))).toBe(false);
  });

  it("legacy intent classifier is removed so keyword matching cannot be reconnected", () => {
    expect(existsSync(resolve(process.cwd(), "src/ai/orchestrator/intent.ts"))).toBe(false);
  });

  it("legacy auto mode route file stays deleted (auto requests go through /agent/run)", () => {
    expect(existsSync(resolve(process.cwd(), "src/http/routes/auto.ts"))).toBe(false);
  });
});
