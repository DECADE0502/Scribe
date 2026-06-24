import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildArchiveSummary } from "../../../../src/ai/prompts/record-state-contract.js";

describe("buildArchiveSummary", () => {
  it("renders generic record identity, display, search fields, and searchable item text", () => {
    const summary = buildArchiveSummary({
      genreSections: [
        {
          section: {
            name: "任意集合",
            identityFields: ["代号"],
            displayFields: ["名称"],
            searchFields: ["代号", "名称", "摘要"],
            schema: [
              { name: "代号", type: "string", role: "identity", required: true },
              { name: "名称", type: "string", role: "label" },
              { name: "摘要", type: "text", role: "summary" },
            ],
          },
          items: [
            {
              data: {
                代号: "A-1",
                名称: "一号",
                摘要: "重要可检索信息",
              },
            },
          ],
        },
      ],
      characters: [],
      activeForeshadowing: [],
    });

    expect(summary).toContain("identity:代号");
    expect(summary).toContain("display:名称");
    expect(summary).toContain("search:代号,名称,摘要");
    expect(summary).toContain("A-1");
    expect(summary).toContain("一号");
    expect(summary).toContain("重要可检索信息");
  });
});

describe("legacy recordChapterState removal", () => {
  it("does not keep the old executable state-recording orchestrator", () => {
    expect(existsSync(resolve(process.cwd(), "src/ai/orchestrator/record-state.ts"))).toBe(false);
  });
});
