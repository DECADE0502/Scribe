import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { openWorkspaceDb } from "../../../../src/db/workspace.js";
import { createPromptPresetsRepo } from "../../../../src/db/repositories/prompt-presets.js";

const roots: string[] = [];

function openRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scribe-prompt-presets-"));
  roots.push(root);
  const db = openWorkspaceDb(path.join(root, "workspace.db"));
  return { db, repo: createPromptPresetsRepo(db, "book-1") };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("prompt presets repository", () => {
  it("creates presets with ordered blocks and toggles blocks", () => {
    const { db, repo } = openRepo();
    try {
      const preset = repo.createPreset({
        name: "Izumi",
        enabled: true,
        sourceImportId: "imp-1",
        generationSettings: { temperature: 1 },
        extensions: { regex_scripts: [] },
        regexScriptsEnabled: true,
      });

      const block = repo.createBlock({
        presetId: preset.id,
        sourceIdentifier: "main",
        name: "Main prompt",
        role: "system",
        content: "Write vivid prose.",
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
      });

      expect(repo.listPresets()).toHaveLength(1);
      expect(repo.listPresets()[0]!.regexScriptsEnabled).toBe(true);
      expect(repo.listBlocks(preset.id).map((item) => item.sourceIdentifier))
        .toEqual(["main"]);

      repo.updateBlock(block.id, { enabled: false });
      expect(repo.listBlocks(preset.id)[0]!.enabled).toBe(false);
    } finally {
      db.close();
    }
  });
});
