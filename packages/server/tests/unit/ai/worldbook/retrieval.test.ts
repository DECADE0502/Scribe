import { describe, expect, it } from "vitest";
import type { WorldbookEntry } from "@scribe/shared";
import {
  retrieveWorldbookEntries,
  renderWorldbookEntries,
} from "../../../../src/ai/worldbook/retrieval.js";

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
    createdAt: patch.createdAt ?? 1,
    updatedAt: patch.updatedAt ?? 1,
  };
}

describe("retrieveWorldbookEntries", () => {
  it("includes constant entries and matching triggered entries, ignoring disabled entries", () => {
    const result = retrieveWorldbookEntries({
      entries: [
        entry("constant", {
          title: "Narrative contract",
          content: "All chapters use close third person.",
          activation: "constant",
          constant: true,
        }),
        entry("match", {
          title: "Tide engine",
          content: "The tide engine is controlled by the harbor tower.",
          keys: ["tide engine"],
        }),
        entry("disabled", {
          title: "Disabled secret",
          content: "This must not appear.",
          enabled: false,
          keys: ["tide engine"],
        }),
      ],
      query: "The next chapter repairs the tide engine.",
    });

    expect(result.selected.map((item) => item.entry.id)).toEqual([
      "match",
      "constant",
    ]);
    expect(result.selected.find((item) => item.entry.id === "match")?.matchedKeys)
      .toEqual(["tide engine"]);
  });

  it("sorts higher priority first and recursively expands from selected content", () => {
    const result = retrieveWorldbookEntries({
      entries: [
        entry("low", {
          title: "Low priority note",
          content: "Background note.",
          keys: ["harbor"],
          priority: 1,
        }),
        entry("root", {
          title: "Harbor tower",
          content: "The tower stores the oath key.",
          keys: ["harbor"],
          priority: 50,
          recursive: true,
          recursionLimit: 1,
        }),
        entry("recursive", {
          title: "Oath key",
          content: "The oath key opens only during an eclipse.",
          keys: ["oath key"],
          priority: 20,
        }),
      ],
      query: "Return to the harbor.",
    });

    expect(result.selected.map((item) => item.entry.id)).toEqual([
      "root",
      "recursive",
      "low",
    ]);
    expect(result.selected.find((item) => item.entry.id === "recursive")?.reason)
      .toBe("recursive");
    expect(result.selected.find((item) => item.entry.id === "recursive")?.recursionDepth)
      .toBe(1);
  });

  it("stops recursive expansion at the configured recursion limit", () => {
    const result = retrieveWorldbookEntries({
      entries: [
        entry("root", {
          title: "A",
          content: "Mentions B.",
          keys: ["A"],
          recursive: true,
          recursionLimit: 1,
        }),
        entry("b", {
          title: "B",
          content: "Mentions C.",
          keys: ["B"],
          recursive: true,
          recursionLimit: 1,
        }),
        entry("c", {
          title: "C",
          content: "Too deep.",
          keys: ["C"],
        }),
      ],
      query: "A",
    });

    expect(result.selected.map((item) => item.entry.id)).toEqual(["root", "b"]);
  });

  it("trims lower priority entries when a token budget is provided", () => {
    const result = retrieveWorldbookEntries({
      entries: [
        entry("high", {
          title: "High",
          content: "important ".repeat(20),
          activation: "constant",
          constant: true,
          priority: 100,
        }),
        entry("low", {
          title: "Low",
          content: "optional ".repeat(200),
          activation: "constant",
          constant: true,
          priority: 1,
        }),
      ],
      query: "",
      tokenBudget: 40,
    });

    expect(result.selected.map((item) => item.entry.id)).toEqual(["high"]);
    expect(result.dropped.map((item) => item.entry.id)).toEqual(["low"]);
  });
});

describe("renderWorldbookEntries", () => {
  it("renders selected entries grouped by insertion depth", () => {
    const result = retrieveWorldbookEntries({
      entries: [
        entry("a", {
          title: "A",
          content: "Alpha",
          activation: "constant",
          constant: true,
          insertionDepth: 1,
          category: "rule",
        }),
        entry("b", {
          title: "B",
          content: "Beta",
          activation: "constant",
          constant: true,
          insertionDepth: 0,
        }),
      ],
      query: "",
    });

    const rendered = renderWorldbookEntries(result.selected);
    expect(rendered.indexOf("Depth 0")).toBeLessThan(rendered.indexOf("Depth 1"));
    expect(rendered).toContain("### B");
    expect(rendered).toContain("### [rule] A");
  });
});
