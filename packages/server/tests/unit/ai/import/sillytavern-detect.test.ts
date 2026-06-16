import { describe, expect, it } from "vitest";
import { detectSillyTavernJson } from "../../../../src/ai/import/sillytavern-detect.js";

describe("detectSillyTavernJson", () => {
  it("detects preset and worldbook shapes", () => {
    expect(detectSillyTavernJson({
      prompts: [],
      prompt_order: [],
      temperature: 1,
    })).toBe("sillytavern_preset");

    expect(detectSillyTavernJson({
      entries: {
        "0": { key: ["world"], comment: "World", content: "Rules" },
      },
      originalData: { name: "Worldbook" },
    })).toBe("sillytavern_worldbook");

    expect(detectSillyTavernJson({ hello: "world" })).toBe("unknown_json");
  });
});
