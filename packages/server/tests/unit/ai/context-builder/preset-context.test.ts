import { describe, expect, it } from "vitest";
import type { BookSnapshot } from "../../../../src/ai/context-builder/snapshot.js";
import { buildWriteContext } from "../../../../src/ai/context-builder/builder.js";

describe("preset context integration", () => {
  it("places enabled preset blocks before worldbook and dynamic context", () => {
    const snapshot: BookSnapshot = {
      bookId: "book-1",
      meta: { title: "Tide Book", premise: "", genre: "fantasy" },
      rulesMd: "",
      characters: [],
      outline: [],
      activeForeshadowing: [],
      paidForeshadowing: [],
      recentSummaries: [],
      recentFullChapters: [],
      midRangeSummaries: [],
      chapterOutlinePaths: [],
      arcVolumeSummaries: [],
      allSummaries: [],
      genreSections: [],
      worldbookEntries: [{
        id: "w1",
        title: "Harbor",
        content: "The harbor has bells.",
        enabled: true,
        activation: "constant",
        keys: [],
        secondaryKeys: [],
        constant: true,
        priority: 1,
        insertionDepth: 0,
        recursive: false,
        recursionLimit: 0,
        tokenBudget: null,
        category: null,
        metadata: {},
        createdAt: 1,
        updatedAt: 1,
      }],
      promptPresets: [],
      promptBlocks: [{
        id: "p1",
        presetId: "preset",
        sourceIdentifier: "style",
        name: "Style",
        role: "system",
        content: "Use close third person.",
        enabled: true,
        stackIndex: 0,
        injectionPosition: 0,
        injectionDepth: 4,
        injectionOrder: 100,
        systemPrompt: false,
        marker: false,
        forbidOverrides: false,
        injectionTrigger: [],
        sourcePromptEnabled: true,
        sourceOrderEnabled: true,
        metadata: {},
        createdAt: 1,
        updatedAt: 1,
      }],
      readerIssues: [],
    };

    const result = buildWriteContext({
      snapshot,
      currentChapterNo: 1,
      intent: { characters: [], foreshadowing: [], userMessage: "Continue." },
    });

    const joined = result.messages.map((m) => String(m.content)).join("\n---\n");
    expect(joined).toContain("Use close third person.");
    expect(joined).toContain("The harbor has bells.");
    expect(joined.indexOf("Use close third person."))
      .toBeLessThan(joined.indexOf("The harbor has bells."));
  });

  it("applies enabled prompt regex scripts to rendered preset blocks", () => {
    const snapshot: BookSnapshot = {
      bookId: "book-1",
      meta: { title: "Tide Book", premise: "", genre: "fantasy" },
      rulesMd: "",
      characters: [],
      outline: [],
      activeForeshadowing: [],
      paidForeshadowing: [],
      recentSummaries: [],
      recentFullChapters: [],
      midRangeSummaries: [],
      chapterOutlinePaths: [],
      arcVolumeSummaries: [],
      allSummaries: [],
      genreSections: [],
      worldbookEntries: [],
      promptPresets: [{
        id: "preset",
        bookId: "book-1",
        name: "Regex preset",
        enabled: true,
        sourceImportId: null,
        generationSettings: {},
        extensions: {
          regex_scripts: [{
            scriptName: "style replace",
            findRegex: "/bad phrase/g",
            replaceString: "better phrase",
            disabled: false,
            promptOnly: true,
          }],
        },
        regexScriptsEnabled: true,
        createdAt: 1,
        updatedAt: 1,
      }],
      promptBlocks: [{
        id: "p1",
        presetId: "preset",
        sourceIdentifier: "style",
        name: "Style",
        role: "system",
        content: "Use bad phrase.",
        enabled: true,
        stackIndex: 0,
        injectionPosition: 0,
        injectionDepth: 4,
        injectionOrder: 100,
        systemPrompt: false,
        marker: false,
        forbidOverrides: false,
        injectionTrigger: [],
        sourcePromptEnabled: true,
        sourceOrderEnabled: true,
        metadata: {},
        createdAt: 1,
        updatedAt: 1,
      }],
      readerIssues: [],
    };

    const result = buildWriteContext({
      snapshot,
      currentChapterNo: 1,
      intent: { characters: [], foreshadowing: [], userMessage: "Continue." },
    });

    const joined = result.messages.map((m) => String(m.content)).join("\n");
    expect(joined).toContain("better phrase");
    expect(joined).not.toContain("bad phrase");
    expect(result.diagnostics?.promptPresetBlockIds).toEqual(["p1"]);
    expect(result.diagnostics?.promptRegexScriptsApplied).toEqual(["style replace"]);
  });
});
