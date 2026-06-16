import { describe, expect, it } from "vitest";
import { applySillyTavernRegexScripts } from "../../../../src/ai/presets/regex-scripts.js";

describe("SillyTavern regex scripts", () => {
  it("applies enabled prompt scripts and skips disabled scripts", () => {
    const result = applySillyTavernRegexScripts("bad phrase and keep", [{
      id: "r1",
      scriptName: "ban phrase",
      findRegex: "/bad phrase/g",
      replaceString: "better phrase",
      disabled: false,
      promptOnly: true,
      markdownOnly: false,
      minDepth: null,
      maxDepth: null,
    }, {
      id: "r2",
      scriptName: "disabled",
      findRegex: "/keep/g",
      replaceString: "drop",
      disabled: true,
      promptOnly: true,
    }], { target: "prompt", depth: 0 });

    expect(result.text).toBe("better phrase and keep");
    expect(result.applied.map((item) => item.scriptName)).toEqual(["ban phrase"]);
  });

  it("respects depth bounds", () => {
    const result = applySillyTavernRegexScripts("alpha", [{
      id: "r1",
      scriptName: "too deep",
      findRegex: "/alpha/g",
      replaceString: "beta",
      disabled: false,
      promptOnly: true,
      minDepth: 2,
      maxDepth: 4,
    }], { target: "prompt", depth: 1 });
    expect(result.text).toBe("alpha");
    expect(result.applied).toEqual([]);
  });
});
