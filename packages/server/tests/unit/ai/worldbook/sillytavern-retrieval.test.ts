import { describe, expect, it } from "vitest";
import type { WorldbookEntry } from "@scribe/shared";
import { retrieveWorldbookEntries } from "../../../../src/ai/worldbook/retrieval.js";

function entry(
  id: string,
  patch: Partial<WorldbookEntry> & Pick<WorldbookEntry, "title" | "content">,
): WorldbookEntry {
  return {
    id,
    title: patch.title,
    content: patch.content,
    enabled: patch.enabled ?? true,
    activation: patch.activation ?? "triggered",
    keys: patch.keys ?? [],
    secondaryKeys: patch.secondaryKeys ?? [],
    constant: patch.constant ?? false,
    priority: patch.priority ?? 0,
    insertionDepth: patch.insertionDepth ?? 0,
    recursive: patch.recursive ?? false,
    recursionLimit: patch.recursionLimit ?? 0,
    tokenBudget: patch.tokenBudget ?? null,
    category: patch.category ?? null,
    metadata: patch.metadata ?? {},
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("SillyTavern-compatible worldbook retrieval", () => {
  it("requires secondary keys for selective entries", () => {
    const result = retrieveWorldbookEntries({
      entries: [entry("sel", {
        title: "Selective",
        content: "Only with both keys.",
        keys: ["capture"],
        secondaryKeys: ["boss"],
        metadata: { sillytavern: { selective: true } },
      })],
      query: "capture",
      extraText: [],
    });
    expect(result.selected).toEqual([]);

    const both = retrieveWorldbookEntries({
      entries: [entry("sel", {
        title: "Selective",
        content: "Only with both keys.",
        keys: ["capture"],
        secondaryKeys: ["boss"],
        metadata: { sillytavern: { selective: true } },
      })],
      query: "capture the boss",
    });
    expect(both.selected.map((item) => item.entry.id)).toEqual(["sel"]);
  });

  it("supports whole-word and case-sensitive matching", () => {
    const result = retrieveWorldbookEntries({
      entries: [entry("case", {
        title: "Case",
        content: "Case sensitive.",
        keys: ["AAB"],
        metadata: { sillytavern: { caseSensitive: true, matchWholeWords: true } },
      })],
      query: "aab AABX",
    });
    expect(result.selected).toEqual([]);

    const exact = retrieveWorldbookEntries({
      entries: [entry("case", {
        title: "Case",
        content: "Case sensitive.",
        keys: ["AAB"],
        metadata: { sillytavern: { caseSensitive: true, matchWholeWords: true } },
      })],
      query: "AAB arrived",
    });
    expect(exact.selected.map((item) => item.entry.id)).toEqual(["case"]);
  });

  it("returns trigger diagnostics explaining matches", () => {
    const result = retrieveWorldbookEntries({
      entries: [entry("w", {
        title: "World",
        content: "Rules.",
        keys: ["world"],
      })],
      query: "world detail",
    });

    expect(result.selected[0]!.matchedKeys).toEqual(["world"]);
    expect(result.selected[0]!.reason).toBe("trigger");
    expect(result.selected[0]!.recursionDepth).toBe(0);
  });

  it("applies probability gates with deterministic diagnostics", () => {
    const result = retrieveWorldbookEntries({
      entries: [entry("prob", {
        title: "Probability",
        content: "Sometimes appears.",
        keys: ["capture"],
        metadata: { sillytavern: { useProbability: true, probability: 50 } },
      })],
      query: "capture",
      random: () => 0.75,
    });

    expect(result.selected).toEqual([]);
    expect(result.dropped.map((item) => item.entry.id)).toEqual(["prob"]);
    expect(result.diagnostics?.find((item) => item.entryId === "prob")).toMatchObject({
      decision: "dropped",
      reason: "probability",
    });

    const selected = retrieveWorldbookEntries({
      entries: [entry("prob", {
        title: "Probability",
        content: "Sometimes appears.",
        keys: ["capture"],
        metadata: { sillytavern: { useProbability: true, probability: 50 } },
      })],
      query: "capture",
      random: () => 0.25,
    });
    expect(selected.selected.map((item) => item.entry.id)).toEqual(["prob"]);
  });

  it("limits scanning to SillyTavern scan depth from the latest context items", () => {
    const result = retrieveWorldbookEntries({
      entries: [entry("depth", {
        title: "Depth",
        content: "Only recent context should trigger this.",
        keys: ["ancient key"],
        metadata: { sillytavern: { scanDepth: 1 } },
      })],
      query: "latest instruction",
      extraText: ["ancient key appears only in older context", "recent context without key"],
    });

    expect(result.selected).toEqual([]);

    const recent = retrieveWorldbookEntries({
      entries: [entry("depth", {
        title: "Depth",
        content: "Recent context triggers this.",
        keys: ["ancient key"],
        metadata: { sillytavern: { scanDepth: 2 } },
      })],
      query: "latest instruction",
      extraText: ["older context without key", "recent ancient key"],
    });
    expect(recent.selected.map((item) => item.entry.id)).toEqual(["depth"]);
  });

  it("honors SillyTavern recursion exclusion metadata", () => {
    const result = retrieveWorldbookEntries({
      entries: [
        entry("root", {
          title: "Root",
          content: "Mentions child-key.",
          keys: ["root-key"],
          recursive: true,
          recursionLimit: 2,
        }),
        entry("child", {
          title: "Child",
          content: "This must not enter through recursion.",
          keys: ["child-key"],
          metadata: { sillytavern: { excludeRecursion: true } },
        }),
      ],
      query: "root-key",
    });

    expect(result.selected.map((item) => item.entry.id)).toEqual(["root"]);
    expect(result.diagnostics?.find((item) => item.entryId === "child")).toMatchObject({
      decision: "dropped",
      reason: "excludeRecursion",
    });
  });
});
