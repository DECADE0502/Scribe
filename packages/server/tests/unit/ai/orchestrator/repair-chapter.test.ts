import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("legacy repairChapter removal", () => {
  it("does not keep the old repair-and-persist orchestrator", () => {
    expect(existsSync(resolve(process.cwd(), "src/ai/orchestrator/repair-chapter.ts"))).toBe(false);
  });
});
