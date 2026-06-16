import { createHash } from "node:crypto";
import type {
  ImportArtifact,
  ImportReport,
  ImportSourceType,
} from "@scribe/shared";
import type { BookHandle } from "../../http/book-registry.js";
import { detectSillyTavernJson } from "./sillytavern-detect.js";
import { normalizeSillyTavernPreset } from "./sillytavern-preset.js";
import { normalizeSillyTavernWorldbook } from "./sillytavern-worldbook.js";

export interface ImportJsonInput {
  filename: string;
  json: unknown;
}

export interface ImportPreview {
  sourceType: ImportSourceType;
  sourceName: string;
  stats: Record<string, unknown>;
  warnings: ImportReport["warnings"];
}

export interface ImportResult {
  artifact: ImportArtifact;
  sourceType: ImportSourceType;
  imported: {
    promptPresets: number;
    promptBlocks: number;
    worldbookEntries: number;
  };
}

function sourceName(filename: string): string {
  return filename.replace(/\.json$/i, "") || "Imported JSON";
}

function hashJson(rawJson: string): string {
  return createHash("sha256").update(rawJson).digest("hex");
}

function normalizedReport(input: ImportJsonInput): {
  sourceType: ImportSourceType;
  report: ImportReport;
} {
  const sourceType = detectSillyTavernJson(input.json);
  if (sourceType === "sillytavern_preset") {
    return {
      sourceType,
      report: normalizeSillyTavernPreset(input.json, input.filename).report,
    };
  }
  if (sourceType === "sillytavern_worldbook") {
    return {
      sourceType,
      report: normalizeSillyTavernWorldbook(input.json).report,
    };
  }
  return {
    sourceType,
    report: {
      warnings: [{
        code: "unknown_import_json",
        message: "JSON shape is not a recognized SillyTavern preset or worldbook.",
      }],
      stats: {},
    },
  };
}

export function previewSillyTavernImport(input: ImportJsonInput): ImportPreview {
  const { sourceType, report } = normalizedReport(input);
  return {
    sourceType,
    sourceName: sourceName(input.filename),
    stats: report.stats,
    warnings: report.warnings,
  };
}

export function importSillyTavernJson(
  handle: BookHandle,
  input: ImportJsonInput,
): ImportResult {
  const rawJson = JSON.stringify(input.json);
  const { sourceType, report } = normalizedReport(input);
  const artifact = handle.importArtifactsRepo.create({
    sourceType,
    sourceName: sourceName(input.filename),
    sourceFilename: input.filename,
    rawJson,
    rawHash: hashJson(rawJson),
    importReport: report,
  });

  const imported = {
    promptPresets: 0,
    promptBlocks: 0,
    worldbookEntries: 0,
  };

  if (sourceType === "sillytavern_preset") {
    const normalized = normalizeSillyTavernPreset(input.json, input.filename);
    const preset = handle.promptPresetsRepo.createPreset({
      ...normalized.preset,
      sourceImportId: artifact.id,
    });
    imported.promptPresets = 1;
    for (const block of normalized.blocks) {
      handle.promptPresetsRepo.createBlock({
        ...block,
        presetId: preset.id,
      });
      imported.promptBlocks += 1;
    }
  }

  if (sourceType === "sillytavern_worldbook") {
    const normalized = normalizeSillyTavernWorldbook(input.json);
    for (const entry of normalized.entries) {
      handle.worldbookRepo.create({
        ...entry,
        metadata: {
          ...(entry.metadata ?? {}),
          sourceImportId: artifact.id,
        },
      });
      imported.worldbookEntries += 1;
    }
  }

  return { artifact, sourceType, imported };
}
