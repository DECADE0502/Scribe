import { describe, expect, it } from "vitest";
import {
  ImportArtifactSchema,
  PromptPresetSchema,
  PromptBlockSchema,
  ReaderIssueSchema,
  SillyTavernWorldbookMetadataSchema,
} from "../src/types/sillytavern-import.js";

describe("sillytavern import shared schemas", () => {
  it("accepts import artifacts, prompt blocks, worldbook metadata, and reader issues", () => {
    expect(ImportArtifactSchema.parse({
      id: "imp-1",
      bookId: "book-1",
      sourceType: "sillytavern_preset",
      sourceName: "Izumi 0503",
      sourceFilename: "Izumi 0503.json",
      rawJson: "{}",
      rawHash: "hash",
      importReport: { warnings: [], stats: {} },
      importedAt: 1,
    }).sourceType).toBe("sillytavern_preset");

    expect(PromptPresetSchema.parse({
      id: "preset-1",
      bookId: "book-1",
      name: "Izumi",
      enabled: true,
      sourceImportId: "imp-1",
      generationSettings: { temperature: 1 },
      extensions: { regex_scripts: [] },
      regexScriptsEnabled: true,
      createdAt: 1,
      updatedAt: 1,
    }).regexScriptsEnabled).toBe(true);

    expect(PromptBlockSchema.parse({
      id: "block-1",
      presetId: "preset-1",
      sourceIdentifier: "main",
      name: "Main",
      role: "system",
      content: "Write well.",
      enabled: true,
      stackIndex: 0,
      injectionPosition: 0,
      injectionDepth: 4,
      injectionOrder: 100,
      systemPrompt: false,
      marker: false,
      forbidOverrides: false,
      injectionTrigger: [],
      sourcePromptEnabled: false,
      sourceOrderEnabled: true,
      metadata: {},
      createdAt: 1,
      updatedAt: 1,
    }).sourceOrderEnabled).toBe(true);

    expect(SillyTavernWorldbookMetadataSchema.parse({
      uid: "37",
      role: "system",
      position: 0,
      selective: true,
      selectiveLogic: 1,
      probability: 50,
      useProbability: true,
      scanDepth: 4,
      caseSensitive: false,
      matchWholeWords: true,
      group: "status",
      groupOverride: false,
      groupWeight: 100,
      sticky: 1,
      cooldown: 2,
      delay: 0,
      preventRecursion: false,
      delayUntilRecursion: false,
      excludeRecursion: false,
      rawEntry: { comment: "状态栏模板" },
    }).matchWholeWords).toBe(true);

    expect(ReaderIssueSchema.parse({
      id: "issue-1",
      chapterNo: 4,
      type: "continuity",
      severity: "warning",
      note: "A companion vanished without explanation.",
      evidence: "Chapter 3 says he joined; chapter 4 omits him.",
      suggestedAction: "Explain his absence or bring him back on page.",
      status: "open",
      createdAt: 1,
      updatedAt: 1,
    }).status).toBe("open");
  });
});
