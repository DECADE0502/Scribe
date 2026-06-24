import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("legacy conversation orchestrator removal", () => {
  it("does not keep the old executable conversation orchestrator in production source", () => {
    expect(existsSync(resolve(process.cwd(), "src/ai/orchestrator/conversation-orchestrator.ts"))).toBe(false);
  });
});
