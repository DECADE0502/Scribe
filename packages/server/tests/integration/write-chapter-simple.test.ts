import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("legacy writeChapterSimple removal", () => {
  it("does not keep the old direct write-and-persist orchestrator", () => {
    expect(existsSync(resolve(process.cwd(), "src/ai/orchestrator/write-chapter.ts"))).toBe(false);
  });
});
