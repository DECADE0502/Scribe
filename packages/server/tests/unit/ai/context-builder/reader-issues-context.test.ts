import { describe, expect, it } from "vitest";
import type { BookSnapshot } from "../../../../src/ai/context-builder/snapshot.js";
import { buildWriteContext } from "../../../../src/ai/context-builder/builder.js";

function snapshot(): BookSnapshot {
  return {
    bookId: "book-1",
    meta: { title: "Continuity Book", premise: "", genre: "fantasy" },
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
    promptPresets: [],
    promptBlocks: [],
    readerIssues: [{
      id: "issue-1",
      chapterNo: 3,
      type: "continuity",
      severity: "warning",
      note: "A companion vanished without explanation.",
      evidence: "Chapter 2 says he joins the team.",
      suggestedAction: "Explain his absence or bring him back on page.",
      status: "open",
      createdAt: 1,
      updatedAt: 1,
    }],
  };
}

describe("reader issue context integration", () => {
  it("injects unresolved reader continuity issues into writing context", () => {
    const result = buildWriteContext({
      snapshot: snapshot(),
      currentChapterNo: 4,
      intent: { characters: [], foreshadowing: [], userMessage: "Continue." },
    });

    const joined = result.messages.map((m) => String(m.content)).join("\n");
    expect(joined).toContain("Reader Continuity Issues");
    expect(joined).toContain("A companion vanished without explanation.");
    expect(joined).toContain("Explain his absence");
  });
});
