import { z } from "zod";

export const ImportSourceTypeSchema = z.enum([
  "sillytavern_preset",
  "sillytavern_worldbook",
  "unknown_json",
]);

export const ImportWarningSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  path: z.string().optional(),
});

export const ImportReportSchema = z.object({
  warnings: z.array(ImportWarningSchema),
  stats: z.record(z.unknown()),
});

export const ImportArtifactSchema = z.object({
  id: z.string().min(1),
  bookId: z.string().min(1),
  sourceType: ImportSourceTypeSchema,
  sourceName: z.string().min(1),
  sourceFilename: z.string().min(1),
  rawJson: z.string().min(1),
  rawHash: z.string().min(1),
  importReport: ImportReportSchema,
  importedAt: z.number().int(),
});

export const PromptRoleSchema = z.enum(["system", "user", "assistant"]);

export const PromptPresetSchema = z.object({
  id: z.string().min(1),
  bookId: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean(),
  sourceImportId: z.string().min(1).nullable(),
  generationSettings: z.record(z.unknown()),
  extensions: z.record(z.unknown()),
  regexScriptsEnabled: z.boolean(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

export const PromptBlockSchema = z.object({
  id: z.string().min(1),
  presetId: z.string().min(1),
  sourceIdentifier: z.string().min(1),
  name: z.string().min(1),
  role: PromptRoleSchema,
  content: z.string(),
  enabled: z.boolean(),
  stackIndex: z.number().int().nullable(),
  injectionPosition: z.number().int().nullable(),
  injectionDepth: z.number().int().nullable(),
  injectionOrder: z.number().int().nullable(),
  systemPrompt: z.boolean(),
  marker: z.boolean(),
  forbidOverrides: z.boolean(),
  injectionTrigger: z.array(z.string()),
  sourcePromptEnabled: z.boolean().nullable(),
  sourceOrderEnabled: z.boolean().nullable(),
  metadata: z.record(z.unknown()),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

export const SillyTavernRegexScriptSchema = z.object({
  id: z.string().optional(),
  scriptName: z.string().optional(),
  findRegex: z.string().optional(),
  replaceString: z.string().optional(),
  trimStrings: z.array(z.string()).optional(),
  placement: z.array(z.number()).optional(),
  disabled: z.boolean().optional(),
  markdownOnly: z.boolean().optional(),
  promptOnly: z.boolean().optional(),
  runOnEdit: z.boolean().optional(),
  substituteRegex: z.number().optional(),
  minDepth: z.number().nullable().optional(),
  maxDepth: z.number().nullable().optional(),
}).passthrough();

export const SillyTavernWorldbookMetadataSchema = z.object({
  uid: z.string().min(1),
  role: z.string().nullable().optional(),
  position: z.union([z.number(), z.string()]).nullable().optional(),
  selective: z.boolean().optional(),
  selectiveLogic: z.number().nullable().optional(),
  probability: z.number().nullable().optional(),
  useProbability: z.boolean().optional(),
  scanDepth: z.number().nullable().optional(),
  caseSensitive: z.boolean().nullable().optional(),
  matchWholeWords: z.boolean().nullable().optional(),
  group: z.string().nullable().optional(),
  groupOverride: z.boolean().optional(),
  groupWeight: z.number().nullable().optional(),
  sticky: z.number().nullable().optional(),
  cooldown: z.number().nullable().optional(),
  delay: z.number().nullable().optional(),
  preventRecursion: z.boolean().optional(),
  delayUntilRecursion: z.boolean().optional(),
  excludeRecursion: z.boolean().optional(),
  ignoreBudget: z.boolean().optional(),
  useGroupScoring: z.boolean().nullable().optional(),
  characterFilter: z.unknown().optional(),
  triggers: z.array(z.unknown()).optional(),
  rawEntry: z.record(z.unknown()),
}).passthrough();

export const ReaderIssueTypeSchema = z.enum([
  "continuity",
  "character_behavior",
  "foreshadowing",
  "setting_consistency",
  "pacing",
  "narrative_perspective",
  "information_density",
  "style_drift",
]);

export const ReaderIssueStatusSchema = z.enum([
  "open",
  "injected",
  "resolved",
  "ignored",
  "deferred",
]);

export const ReaderIssueSchema = z.object({
  id: z.string().min(1),
  chapterNo: z.number().int().positive(),
  type: ReaderIssueTypeSchema,
  severity: z.enum(["warning", "critical"]),
  note: z.string().min(1),
  evidence: z.string().nullable(),
  suggestedAction: z.string().nullable(),
  status: ReaderIssueStatusSchema,
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

export type ImportSourceType = z.infer<typeof ImportSourceTypeSchema>;
export type ImportWarning = z.infer<typeof ImportWarningSchema>;
export type ImportReport = z.infer<typeof ImportReportSchema>;
export type ImportArtifact = z.infer<typeof ImportArtifactSchema>;
export type PromptPreset = z.infer<typeof PromptPresetSchema>;
export type PromptBlock = z.infer<typeof PromptBlockSchema>;
export type PromptRole = z.infer<typeof PromptRoleSchema>;
export type SillyTavernRegexScript = z.infer<typeof SillyTavernRegexScriptSchema>;
export type SillyTavernWorldbookMetadata = z.infer<typeof SillyTavernWorldbookMetadataSchema>;
export type ReaderIssue = z.infer<typeof ReaderIssueSchema>;
export type ReaderIssueType = z.infer<typeof ReaderIssueTypeSchema>;
export type ReaderIssueStatus = z.infer<typeof ReaderIssueStatusSchema>;
