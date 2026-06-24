import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("legacy writeWithAudit removal", () => {
  it("does not keep the old write/audit/repair/state executable pipeline", () => {
    expect(existsSync(resolve(process.cwd(), "src/ai/orchestrator/write-with-audit.ts"))).toBe(false);
    expect(existsSync(resolve(process.cwd(), "src/ai/orchestrator/write-chapter.ts"))).toBe(false);
    expect(existsSync(resolve(process.cwd(), "src/ai/orchestrator/repair-chapter.ts"))).toBe(false);
    expect(existsSync(resolve(process.cwd(), "src/ai/orchestrator/record-state.ts"))).toBe(false);
  });
});
