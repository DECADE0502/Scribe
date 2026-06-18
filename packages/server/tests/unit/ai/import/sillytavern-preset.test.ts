import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { normalizeSillyTavernPreset } from "../../../../src/ai/import/sillytavern-preset.js";

describe("normalizeSillyTavernPreset", () => {
  it("uses prompt_order enabled state and preserves mismatches", () => {
    const result = normalizeSillyTavernPreset({
      temperature: 1,
      top_p: 0.99,
      extensions: { regex_scripts: [{ scriptName: "r" }] },
      prompts: [
        {
          identifier: "main",
          name: "Main",
          enabled: false,
          role: "system",
          content: "Write with continuity.",
          injection_position: 0,
          injection_depth: 4,
          injection_order: 100,
          system_prompt: false,
          marker: false,
          forbid_overrides: false,
          injection_trigger: [],
        },
        {
          identifier: "unused",
          name: "Unused",
          enabled: true,
          role: "system",
          content: "Unused content.",
        },
      ],
      prompt_order: [{
        character_id: 100001,
        order: [{ identifier: "main", enabled: true }],
      }],
    }, "Izumi 0503.json");

    expect(result.preset.name).toBe("Izumi 0503");
    expect(result.preset.generationSettings.temperature).toBe(1);
    expect(result.preset.extensions.regex_scripts).toHaveLength(1);
    expect(result.blocks).toHaveLength(2);

    const main = result.blocks.find((block) => block.sourceIdentifier === "main")!;
    expect(main.enabled).toBe(true);
    expect(main.stackIndex).toBe(0);
    expect(main.sourcePromptEnabled).toBe(false);
    expect(main.sourceOrderEnabled).toBe(true);

    const unused = result.blocks.find((block) => block.sourceIdentifier === "unused")!;
    expect(unused.enabled).toBe(false);
    expect(unused.stackIndex).toBeNull();
    expect(result.report.warnings.map((warning) => warning.code)).toContain("prompt_enabled_mismatch");
  });

  it("normalizes the real exported Izumi preset without losing runtime controls", () => {
    const filePath = path.resolve(process.cwd(), "../../samples/sillytavern/Izumi 0503.json");
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const result = normalizeSillyTavernPreset(raw, "Izumi 0503.json");

    expect(result.preset.name).toBe("Izumi 0503");
    expect(result.blocks).toHaveLength(203);
    expect(result.blocks.filter((block) => block.enabled)).toHaveLength(52);
    expect(result.report.stats.promptCount).toBe(203);
    expect(result.report.stats.activePromptCount).toBe(52);
    expect(result.report.stats.regexScriptCount).toBe(26);
    expect(result.preset.extensions.regex_scripts).toHaveLength(26);
    expect(result.preset.regexScriptsEnabled).toBe(true);
    expect(result.blocks.every((block) => block.sourceIdentifier.length > 0)).toBe(true);
  });
});
