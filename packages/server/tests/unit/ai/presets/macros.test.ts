import { describe, expect, it } from "vitest";
import {
  createMacroScope,
  expandSillyTavernMacros,
} from "../../../../src/ai/presets/macros.js";

function scope() {
  return createMacroScope({
    user: "Lin",
    char: "Tide Book",
    lastUserMessage: "Continue",
    date: "2026-06-16",
    time: "12:00",
  });
}

describe("SillyTavern macro engine", () => {
  it("evaluates setvar and getvar in order without leaking scopes", () => {
    const first = scope();
    expect(expandSillyTavernMacros(
      "{{setvar::tone::quiet}}Tone={{getvar::tone}}",
      first,
    )).toBe("Tone=quiet");
    expect(expandSillyTavernMacros("User={{user}}, Char={{char}}", first))
      .toBe("User=Lin, Char=Tide Book");

    const fresh = scope();
    expect(expandSillyTavernMacros("Tone={{getvar::tone}}", fresh)).toBe("Tone=");
  });

  it("preserves unknown macros and records diagnostics", () => {
    const s = scope();
    expect(expandSillyTavernMacros("{{random::a,b}}", s)).toBe("{{random::a,b}}");
    expect(s.diagnostics.map((item) => item.code)).toContain("unknown_macro");
  });
});
