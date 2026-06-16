import type { CoreMessage } from "ai";
import type { PromptBlock } from "@scribe/shared";
import {
  createMacroScope,
  expandSillyTavernMacros,
  type PresetMacroContext,
} from "./macros.js";

export function renderPromptPresetBlocks(
  blocks: PromptBlock[],
  macroContext: PresetMacroContext,
): CoreMessage[] {
  const scope = createMacroScope(macroContext);
  return blocks
    .filter((block) => block.enabled && block.stackIndex !== null)
    .sort((a, b) => {
      const stackDelta = (a.stackIndex ?? 999_999) - (b.stackIndex ?? 999_999);
      if (stackDelta !== 0) return stackDelta;
      return a.sourceIdentifier.localeCompare(b.sourceIdentifier);
    })
    .map((block) => ({
      role: block.role,
      content: expandSillyTavernMacros(block.content, scope),
    }));
}
