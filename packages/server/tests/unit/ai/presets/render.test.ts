import { describe, expect, it } from "vitest";
import type { PromptBlock } from "@scribe/shared";
import { renderPromptPresetBlocks } from "../../../../src/ai/presets/render.js";

function block(patch: Partial<PromptBlock>): PromptBlock {
  return {
    id: patch.id ?? "b",
    presetId: patch.presetId ?? "p",
    sourceIdentifier: patch.sourceIdentifier ?? "main",
    name: patch.name ?? "Main",
    role: patch.role ?? "system",
    content: patch.content ?? "",
    enabled: patch.enabled ?? true,
    stackIndex: patch.stackIndex ?? 0,
    injectionPosition: patch.injectionPosition ?? 0,
    injectionDepth: patch.injectionDepth ?? 4,
    injectionOrder: patch.injectionOrder ?? 100,
    systemPrompt: patch.systemPrompt ?? false,
    marker: patch.marker ?? false,
    forbidOverrides: patch.forbidOverrides ?? false,
    injectionTrigger: patch.injectionTrigger ?? [],
    sourcePromptEnabled: patch.sourcePromptEnabled ?? true,
    sourceOrderEnabled: patch.sourceOrderEnabled ?? true,
    metadata: patch.metadata ?? {},
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("preset rendering", () => {
  it("renders enabled blocks in stack order, keeps roles, and shares macro scope across blocks", () => {
    const messages = renderPromptPresetBlocks([
      block({ id: "b2", role: "assistant", content: "Tone={{getvar::tone}}", stackIndex: 1 }),
      block({ id: "b1", role: "system", content: "{{setvar::tone::quiet}}System.", stackIndex: 0 }),
      block({ id: "b3", enabled: false, content: "Skip.", stackIndex: 2 }),
    ], {
      user: "Lin",
      char: "Book",
      lastUserMessage: "",
      date: "2026-06-16",
      time: "12:00",
    });

    expect(messages).toEqual([
      { role: "system", content: "System." },
      { role: "assistant", content: "Tone=quiet" },
    ]);
  });
});
