import { describe, expect, it } from "vitest";
import { SLASH_SUGGESTIONS, matchSlashSuggestions } from "../src/slash-commands.js";

describe("natural language shortcuts", () => {
  it("returns natural-language inserts for slash-like input", () => {
    const suggestions = matchSlashSuggestions("/");

    expect(suggestions.length).toBe(SLASH_SUGGESTIONS.length);
    expect(suggestions.every((s) => !s.insertText.startsWith("/"))).toBe(true);
  });

  it("filters by keyword", () => {
    const suggestions = matchSlashSuggestions("/重写");

    expect(suggestions.map((s) => s.label)).toEqual(["请重写当前章节"]);
  });

  it("exposes plain text only", () => {
    const help = SLASH_SUGGESTIONS.find((s) => s.label === "请说明现在能做什么");

    expect(help?.insertText).toContain("现在可以怎么做");
  });
});

