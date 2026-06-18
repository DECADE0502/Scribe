import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { normalizeSillyTavernWorldbook } from "../../../../src/ai/import/sillytavern-worldbook.js";

describe("normalizeSillyTavernWorldbook", () => {
  it("maps native worldbook fields and preserves raw SillyTavern metadata", () => {
    const result = normalizeSillyTavernWorldbook({
      entries: {
        "0": {
          key: ["capture", "pet ball"],
          keysecondary: ["system"],
          comment: "Capture rules",
          content: "Capture must roll probability.",
          constant: false,
          selective: true,
          selectiveLogic: 1,
          order: 88,
          position: 0,
          disable: false,
          ignoreBudget: true,
          preventRecursion: false,
          delayUntilRecursion: false,
          probability: 100,
          useProbability: true,
          depth: 4,
          role: "system",
          extensions: { depth: 4, role: "system" },
        },
        "1": {
          key: ["core"],
          keysecondary: [],
          comment: "Core world",
          content: "Always include this.",
          constant: true,
          order: 100,
          depth: 0,
          disable: false,
          role: "system",
        },
      },
      originalData: { name: "Pet worldbook" },
    });

    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]!.title).toBe("Capture rules");
    expect(result.entries[0]!.activation).toBe("triggered");
    expect(result.entries[0]!.keys).toEqual(["capture", "pet ball"]);
    expect(result.entries[0]!.secondaryKeys).toEqual(["system"]);
    expect(result.entries[0]!.priority).toBe(88);
    expect(result.entries[0]!.insertionDepth).toBe(4);
    expect(result.entries[0]!.metadata?.sillytavern).toMatchObject({
      uid: "0",
      role: "system",
      position: 0,
    });
    expect((result.entries[0]!.metadata?.sillytavern as any).rawEntry.selective).toBe(true);

    expect(result.entries[1]!.activation).toBe("constant");
    expect(result.report.stats.entryCount).toBe(2);
    expect(result.report.stats.constantCount).toBe(1);
  });

  it("normalizes the real exported SillyTavern worldbook without losing source fields", () => {
    const filePath = path.resolve(process.cwd(), "../../samples/sillytavern/宠物捕捉系统-世界书.json");
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const result = normalizeSillyTavernWorldbook(raw);

    expect(result.entries).toHaveLength(38);
    expect(result.entries.filter((entry) => entry.constant)).toHaveLength(7);
    expect(result.entries.flatMap((entry) => entry.keys)).toHaveLength(320);
    expect(result.report.stats.entryCount).toBe(38);
    expect(result.report.stats.constantCount).toBe(7);
    expect(result.report.stats.triggerKeyCount).toBe(320);
    expect(result.entries.every((entry) => Boolean(entry.metadata?.sillytavern))).toBe(true);
    expect(result.entries.some((entry) => Boolean((entry.metadata?.sillytavern as any).rawEntry))).toBe(true);
  });
});
