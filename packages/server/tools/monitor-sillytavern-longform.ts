import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { LanguageModel, CoreMessage } from "ai";
import type { SseEvent } from "@scribe/shared";
import { createBookRegistry, type BookHandle } from "../src/http/book-registry.js";
import { createApp } from "../src/http/server.js";
import { resolveAppPaths, type AppPaths } from "../src/config/paths.js";
import { loadConfig } from "../src/config/load.js";
import { loadSecrets } from "../src/config/secrets.js";
import { createModelManager } from "../src/ai/model-manager.js";
import { buildWriteContext } from "../src/ai/context-builder/builder.js";
import { loadBookSnapshot } from "../src/ai/context-builder/snapshot.js";
import {
  buildChapterAuditContext,
  buildChapterWriteMessages,
  detectMissingRequiredSections,
  extractRequiredOutputSections,
} from "../src/ai/context-builder/book-context.js";
import { writeWithAudit } from "../src/ai/orchestrator/write-with-audit.js";
import { buildArchiveSummary, recordChapterState } from "../src/ai/orchestrator/record-state.js";
import { sanitizeChapterOutput } from "../src/ai/orchestrator/output-sanitize.js";
import {
  buildSillyTavernLongformVerdict,
  detectMetaOutputLeakage,
  parseSillyTavernMonitorArgs,
  selectFinalChapterText,
  type SillyTavernMonitorChapterEvidence,
} from "../src/ai/monitor/sillytavern-longform-monitor.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

interface ChapterMonitorReport extends SillyTavernMonitorChapterEvidence {
  userIntent: string;
  presetBlockIds: string[];
  worldbookEntryIds: string[];
  readerIssuesBefore: string[];
  readerIssuesAfter: string[];
  messageCount: number;
  auditVerdict?: string;
  auditIssuesCount?: number;
  auditWorldbookPresent?: boolean;
  auditReaderIssuesPresent?: boolean;
  auditHardContinuityPresent?: boolean;
  recordStateAttempted?: boolean;
  recordStateSucceeded?: boolean;
  recordStateToolCallCount?: number;
  recordStateUpsertCount?: number;
  writeError?: string;
}

interface MonitorOutput {
  generatedAt: string;
  mode: "live" | "context";
  bookId: string;
  paths: {
    presetPath: string;
    worldbookPath: string;
    reportPath: string;
    partialPath: string;
  };
  config: Record<string, unknown>;
  ignoreExistingCritical: boolean;
  imports: {
    preset: { promptPresets: number; promptBlocks: number; worldbookEntries: number };
    worldbook: { promptPresets: number; promptBlocks: number; worldbookEntries: number };
  };
  chapterCount: number;
  presetInjectedChapters: number[];
  regexAppliedChapters: number[];
  worldbookTriggeredChapters: number[];
  readerIssueInjectionCount: number;
  verdict: ReturnType<typeof buildSillyTavernLongformVerdict>;
  reports: ChapterMonitorReport[];
}

function findWorldbookPath(root: string): string {
  for (const file of fs.readdirSync(root)) {
    if (!file.endsWith(".json") || file === "Izumi 0503.json" || file === "package.json") {
      continue;
    }
    const full = path.join(root, file);
    try {
      const parsed = JSON.parse(fs.readFileSync(full, "utf8")) as Record<string, unknown>;
      if (parsed.entries && typeof parsed.entries === "object") return full;
    } catch {
      // Keep scanning; user may have unrelated JSON files in the project root.
    }
  }
  throw new Error("Could not locate a SillyTavern worldbook JSON file");
}

function makeTempPaths(root: string): AppPaths {
  return {
    appRoot: root,
    libraryDb: path.posix.join(root, "library.db"),
    booksDir: path.posix.join(root, "books"),
    backupsDir: path.posix.join(root, "backups"),
    secretsEnv: path.posix.join(root, "secrets.env"),
    configJson: path.posix.join(root, "config.json"),
    bookDir: (id: string) => path.posix.join(root, "books", id),
    workspaceDb: (id: string) => path.posix.join(root, "books", id, "workspace.db"),
    chaptersDir: (id: string) => path.posix.join(root, "books", id, "chapters"),
    rulesMd: (id: string) => path.posix.join(root, "books", id, "rules.md"),
    exportsDir: (id: string) => path.posix.join(root, "books", id, "exports"),
    bookBackupsDir: (id: string) => path.posix.join(root, "backups", id),
  };
}

function readJsonFile(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

async function importFile(
  app: ReturnType<typeof createApp>,
  bookId: string,
  file: string,
) {
  const res = await app.request(`/api/books/${bookId}/imports`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: path.basename(file), json: readJsonFile(file) }),
  });
  if (res.status !== 201) {
    throw new Error(`${file} import failed: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<{
    sourceType: string;
    imported: {
      promptPresets: number;
      promptBlocks: number;
      worldbookEntries: number;
    };
  }>;
}

function intentForChapter(chapterNo: number): string {
  const controls = [
    "继续，但不要急着解释系统全貌；让主角在压力下做选择，并保持捕捉规则一致。",
    "上一章的状态栏、捕捉规则、契约数量和代价要延续，不要突然换设定。",
    "让世界书里的核心设定自然进入剧情，不要写成百科说明。",
    "以读者视角检查前文伏笔，推进一个矛盾，但不要一次性回收全部。",
  ];
  const focus = [
    "捕捉",
    "状态栏",
    "宠物",
    "契约",
    "天界",
    "魔界",
    "宠物捕捉系统",
    "系统",
  ];
  return [
    `第 ${chapterNo} 章。`,
    controls[(chapterNo - 1) % controls.length],
    `本章必须自然触发这些关键词：${focus[(chapterNo - 1) % focus.length]}、捕捉、状态栏、系统。`,
  ].join(" ");
}

function countReadableWords(text: string): number {
  const chineseChars = text.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
  const latinWords = text.match(/[A-Za-z]+/g)?.length ?? 0;
  return chineseChars + latinWords;
}

function loadSnapshot(handle: BookHandle) {
  return loadBookSnapshot(
    handle.bookId,
    {
      charactersRepo: handle.charactersRepo,
      outlineRepo: handle.outlineRepo,
      foreshadowingRepo: handle.foreshadowingRepo,
      chaptersRepo: handle.chaptersRepo,
      genreSectionsRepo: handle.genreSectionsRepo,
      worldbookRepo: handle.worldbookRepo,
      promptPresetsRepo: handle.promptPresetsRepo,
      readerIssuesRepo: handle.readerIssuesRepo,
      bookMetaRepo: handle.bookMetaRepo,
    },
    { rulesMd: handle.rulesMdPath },
  );
}

function createReaderContinuityIssue(handle: BookHandle): string {
  return handle.readerIssuesRepo.create({
    chapterNo: 4,
    type: "continuity",
    severity: "warning",
    note: "状态栏、捕捉规则、契约数量与代价必须在后续章节保持连续，不能突然改设定。",
    evidence: "前四章已经建立系统状态栏、捕捉规则和契约代价。",
    suggestedAction: "下一章继续显示这些规则，并让变化有明确因果。",
    status: "open",
  }).id;
}

function extractDiagnostics(messages: CoreMessage[], report: ChapterMonitorReport): void {
  const joined = messages.map((message) => String(message.content)).join("\n");
  report.hardContinuityPresent = joined.includes("## Hard Continuity Constraints");
  report.hardContinuitySnippets = extractBlockSnippets(joined, "## Hard Continuity Constraints");
  report.readerIssueSnippets = extractBlockSnippets(joined, "## Reader Continuity Issues");
  if (!report.containsWorldbook) report.continuityNotes.push("missing worldbook context");
  if (report.presetBlockCount === 0) report.continuityNotes.push("missing preset context");
  if (report.readerIssuesBefore.length > 0 && !joined.includes("Reader Continuity Issues")) {
    report.continuityNotes.push("reader issues missing from prompt text");
  }
}

function extractBlockSnippets(text: string, heading: string): string[] {
  const start = text.indexOf(heading);
  if (start < 0) return [];
  const rest = text.slice(start + heading.length);
  const nextHeading = rest.search(/\n## /);
  const block = (nextHeading >= 0 ? rest.slice(0, nextHeading) : rest)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .slice(0, 8);
  return block;
}

function buildContextReport(handle: BookHandle, chapterNo: number): ChapterMonitorReport {
  const userIntent = intentForChapter(chapterNo);
  const snapshot = loadSnapshot(handle);
  const context = buildWriteContext({
    snapshot,
    currentChapterNo: chapterNo,
    intent: {
      characters: ["主角"],
      foreshadowing: ["系统", "捕捉", "状态栏"],
      records: ["系统", "捕捉", "状态栏", "宠物", "契约", "天界", "魔界"],
      userMessage: userIntent,
    },
  });
  const diagnostics = context.diagnostics ?? {
    promptPresetBlockIds: [],
    promptRegexScriptsApplied: [],
    worldbookEntryIds: [],
    readerIssueIds: [],
  };
  const joined = context.messages.map((message) => String(message.content)).join("\n");
  const report: ChapterMonitorReport = {
    chapterNo,
    userIntent,
    wordCount: 0,
    presetBlockCount: diagnostics.promptPresetBlockIds.length,
    presetBlockIds: diagnostics.promptPresetBlockIds,
    regexScriptsApplied: diagnostics.promptRegexScriptsApplied,
    worldbookEntryCount: diagnostics.worldbookEntryIds.length,
    worldbookEntryIds: diagnostics.worldbookEntryIds,
    readerIssueIds: diagnostics.readerIssueIds,
    readerIssuesBefore: diagnostics.readerIssueIds,
    readerIssuesAfter: diagnostics.readerIssueIds,
    messageCount: context.messages.length,
    containsWorldbook: joined.includes("## Worldbook"),
    continuityNotes: [],
    styleNotes: [],
  };
  extractDiagnostics(context.messages, report);
  return report;
}

function saveSyntheticChapterState(
  handle: BookHandle,
  report: ChapterMonitorReport,
) {
  const worldbookNote = report.worldbookEntryCount > 0
    ? `本章上下文使用了 ${report.worldbookEntryCount} 条世界书。`
    : "本章没有世界书进入上下文。";
  handle.chaptersRepo.saveSummary({
    chapterNo: report.chapterNo,
    oneLiner: `第 ${report.chapterNo} 章围绕系统捕捉推进。`,
    paragraph: `${report.userIntent} ${worldbookNote} 主角保持状态栏、捕捉规则和阵营压力的连续性。`,
    keyEvents: [{
      event: `chapter-${report.chapterNo}-capture-continuity`,
      characters: ["主角"],
      foreshadowingRefs: ["系统", "捕捉", "状态栏"],
    }],
    generatedAt: Date.now(),
    reasoningContent: null,
  });
  handle.chaptersRepo.saveVersion({
    chapterNo: report.chapterNo,
    source: "ai_write",
    contentMd: `# 第 ${report.chapterNo} 章监控占位\n\n${report.userIntent}\n\n${worldbookNote}`,
  });
}

async function runContextMonitor(handle: BookHandle, chapterCount: number): Promise<{
  reports: ChapterMonitorReport[];
  readerIssueCreated: boolean;
}> {
  const reports: ChapterMonitorReport[] = [];
  let readerIssueCreated = false;
  for (let chapterNo = 1; chapterNo <= chapterCount; chapterNo += 1) {
    if (chapterNo === 5) {
      createReaderContinuityIssue(handle);
      readerIssueCreated = true;
    }
    const report = buildContextReport(handle, chapterNo);
    reports.push(report);
    saveSyntheticChapterState(handle, report);
  }
  return { reports, readerIssueCreated };
}

function modelSetup() {
  const appPaths = resolveAppPaths({ env: process.env });
  const config = loadConfig(appPaths.configJson);
  const secrets = loadSecrets(appPaths.secretsEnv);
  const apiKey =
    config.provider === "mimo"
      ? secrets.MIMO_API_KEY ?? secrets.DEEPSEEK_API_KEY ?? null
      : secrets.DEEPSEEK_API_KEY ?? secrets.MIMO_API_KEY ?? null;
  const models = createModelManager({
    provider: config.provider,
    apiKey,
    writeModelId: config.writeModelId,
    auditModelId: config.auditModelId,
    masterPrompt: config.masterPrompt,
  });
  return { appPaths, config, models };
}

async function runWithTimeout<T>(
  label: string,
  timeoutMs: number,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fn(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`${label} exceeded ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function buildRecordArchiveSummary(handle: BookHandle): string {
  return buildArchiveSummary({
    genreSections: handle.genreSectionsRepo.listSections().map((section) => ({
      section,
      items: handle.genreSectionsRepo.listItems(section.id),
    })),
    characters: handle.charactersRepo.list(),
    activeForeshadowing: handle.foreshadowingRepo.list("active"),
  });
}

async function runRecordChapterState(input: {
  handle: BookHandle;
  model: LanguageModel;
  chapterNo: number;
  chapterContent: string;
  abortSignal: AbortSignal;
  deepestPrompt: string;
}): Promise<{
  attempted: boolean;
  succeeded: boolean;
  toolCallCount: number;
  upsertCount: number;
  error?: string;
}> {
  let toolCallCount = 0;
  let upsertCount = 0;
  for await (const ev of recordChapterState(
    {
      model: input.model,
      stateDeps: {
        charactersRepo: input.handle.charactersRepo,
        foreshadowingRepo: input.handle.foreshadowingRepo,
        timelineRepo: input.handle.timelineRepo,
        chapterNo: input.chapterNo,
      },
      genreDeps: {
        repo: input.handle.genreSectionsRepo,
        charactersRepo: input.handle.charactersRepo,
      },
      abortSignal: input.abortSignal,
      deepestPrompt: input.deepestPrompt,
    },
    {
      chapterNo: input.chapterNo,
      chapterContent: input.chapterContent,
      archiveSummary: buildRecordArchiveSummary(input.handle),
    },
  )) {
    if (ev.type === "tool_call_start") toolCallCount += 1;
    if (ev.type === "tool_call_end" && ev.toolName === "upsert_record_item") {
      const result = ev.result as { success?: unknown } | undefined;
      if (result?.success !== false) upsertCount += 1;
    }
    if (ev.type === "error") {
      return {
        attempted: true,
        succeeded: false,
        toolCallCount,
        upsertCount,
        error: `${ev.errorClass}: ${ev.message}`,
      };
    }
  }
  return { attempted: true, succeeded: true, toolCallCount, upsertCount };
}

async function runLiveChapter(input: {
  handle: BookHandle;
  writeModel: LanguageModel;
  auditModel: LanguageModel;
  auditModelId: string;
  chapterNo: number;
  timeoutMs: number;
  deepestPrompt: string;
}): Promise<ChapterMonitorReport> {
  const userIntent = intentForChapter(input.chapterNo);
  const beforeIssues = input.handle.readerIssuesRepo.listOpen().map((issue) => issue.id);
  const writeContext = buildChapterWriteMessages(input.handle, input.chapterNo, userIntent);
  const diagnostics = writeContext.diagnostics ?? {
    promptPresetBlockIds: [],
    promptRegexScriptsApplied: [],
    worldbookEntryIds: [],
    readerIssueIds: [],
  };
  let draftText = "";
  let repairText = "";
  let collectingRepairText = false;
  let auditVerdict: string | undefined;
  let auditIssuesCount: number | undefined;
  let repairAttempted = false;
  let repairVerdict: string | undefined;
  let repairStillCritical: boolean | undefined;
  let writeError: string | undefined;
  const auditCtx = buildChapterAuditContext(input.handle, input.chapterNo, userIntent).auditCtx;
  const requiredSections = extractRequiredOutputSections(writeContext.messages.map((message) => ({
    content: String(message.content),
  })));

  await runWithTimeout(`chapter ${input.chapterNo}`, input.timeoutMs, async (signal) => {
    for await (const ev of writeWithAudit(
      {
        model: input.writeModel,
        auditModel: input.auditModel,
        auditModelId: input.auditModelId,
        chaptersRepo: input.handle.chaptersRepo,
        chapterFiles: input.handle.chapterFiles,
        readerIssuesRepo: input.handle.readerIssuesRepo,
      },
      {
        chapterNo: input.chapterNo,
        userIntent,
        prebuiltMessages: writeContext.messages,
        auditCtx,
        enableRepair: true,
        qualityGate: ({ chapterContent }) => [
          ...detectMissingRequiredSections(chapterContent, requiredSections).map((note) => ({
            dimension: "required_output_section",
            severity: "critical" as const,
            note,
          })),
          ...detectMetaOutputLeakage(chapterContent).map((issue) => ({
            dimension: "meta_output_leakage",
            severity: "critical" as const,
            note: `meta output leakage: ${issue}`,
          })),
        ],
        abortSignal: signal,
        deepestPrompt: input.deepestPrompt,
      },
    )) {
      if (ev.type === "text_delta") {
        if (collectingRepairText) repairText += ev.delta;
        else draftText += ev.delta;
      }
      if (ev.type === "tool_call_start" && ev.toolName === "chapter_repair") {
        repairAttempted = true;
        collectingRepairText = true;
      }
      if (ev.type === "tool_call_end" && ev.toolName === "chapter_audit") {
        const result = ev.result as { verdict?: unknown; issuesCount?: unknown };
        auditVerdict = String(result.verdict ?? "");
        auditIssuesCount = Number(result.issuesCount ?? 0);
      }
      if (ev.type === "tool_call_end" && ev.toolName === "chapter_repair_audit") {
        const result = ev.result as { verdict?: unknown; stillCritical?: unknown };
        repairVerdict = String(result.verdict ?? "");
        repairStillCritical = Boolean(result.stillCritical);
      }
      if (ev.type === "error") {
        writeError = `${ev.errorClass}: ${ev.message}`;
        throw new Error(writeError);
      }
    }
  });

  const text = sanitizeChapterOutput(selectFinalChapterText({ draftText, repairText, repairVerdict }));
  let recordStateAttempted = false;
  let recordStateSucceeded = false;
  let recordStateToolCallCount = 0;
  let recordStateUpsertCount = 0;
  let recordStateError: string | undefined;
  await runWithTimeout(`chapter ${input.chapterNo} state recording`, input.timeoutMs, async (signal) => {
    const recordResult = await runRecordChapterState({
      handle: input.handle,
      model: input.auditModel,
      chapterNo: input.chapterNo,
      chapterContent: text,
      abortSignal: signal,
      deepestPrompt: input.deepestPrompt,
    });
    recordStateAttempted = recordResult.attempted;
    recordStateSucceeded = recordResult.succeeded;
    recordStateToolCallCount = recordResult.toolCallCount;
    recordStateUpsertCount = recordResult.upsertCount;
    recordStateError = recordResult.error;
  });
  const afterIssues = input.handle.readerIssuesRepo.listOpen().map((issue) => issue.id);
  const joined = writeContext.messages.map((message) => String(message.content)).join("\n");
  const report: ChapterMonitorReport = {
    chapterNo: input.chapterNo,
    userIntent,
    wordCount: countReadableWords(text),
    presetBlockCount: diagnostics.promptPresetBlockIds.length,
    presetBlockIds: diagnostics.promptPresetBlockIds,
    regexScriptsApplied: diagnostics.promptRegexScriptsApplied,
    worldbookEntryCount: diagnostics.worldbookEntryIds.length,
    worldbookEntryIds: diagnostics.worldbookEntryIds,
    readerIssueIds: diagnostics.readerIssueIds,
    readerIssuesBefore: beforeIssues,
    readerIssuesAfter: afterIssues,
    messageCount: writeContext.messages.length,
    containsWorldbook: joined.includes("## Worldbook"),
    continuityNotes: [],
    styleNotes: [],
    auditVerdict,
    auditIssuesCount,
    auditWorldbookPresent: Boolean(auditCtx.worldbookContext?.trim()),
    auditReaderIssuesPresent: Boolean(auditCtx.readerIssuesContext?.trim()),
    auditHardContinuityPresent: Boolean(auditCtx.hardContinuityContext?.trim()),
    repairAttempted,
    repairVerdict,
    repairStillCritical,
    recordStateAttempted,
    recordStateSucceeded,
    recordStateToolCallCount,
    recordStateUpsertCount,
    writeError,
  };
  extractDiagnostics(writeContext.messages, report);
  if (report.wordCount < 500) {
    report.styleNotes.push(`chapter too short for longform validation: ${report.wordCount}`);
  }
  for (const missing of detectMissingRequiredSections(text, requiredSections)) {
    report.styleNotes.push(missing);
  }
  for (const issue of detectMetaOutputLeakage(text)) {
    report.styleNotes.push(`meta output leakage: ${issue}`);
  }
  if (auditVerdict === "critical" && repairVerdict !== "ok") {
    report.continuityNotes.push("audit verdict critical");
  }
  if (!recordStateSucceeded) {
    report.continuityNotes.push(recordStateError ? `chapter state record failed: ${recordStateError}` : "chapter state was not recorded");
  }
  return report;
}

async function runLiveMonitor(input: {
  handle: BookHandle;
  chapterCount: number;
  chapterTimeoutMs: number;
  onProgress?: (reports: ChapterMonitorReport[]) => void;
}): Promise<{
  reports: ChapterMonitorReport[];
  readerIssueCreated: boolean;
  modelConfig: Record<string, unknown>;
}> {
  const { appPaths, config, models } = modelSetup();
  const writeModel = models.getModel();
  const auditModel = models.getAuditModel();
  if (!writeModel || !auditModel) {
    throw new Error(
      `No usable model configured. provider=${config.provider}, config=${appPaths.configJson}, secrets=${appPaths.secretsEnv}`,
    );
  }
  const existingChapterCount = input.handle.chaptersRepo.maxChapterNo();
  const reports: ChapterMonitorReport[] = buildExistingLiveReports(
    input.handle,
    Math.min(existingChapterCount, input.chapterCount),
  );
  let readerIssueCreated = input.handle.readerIssuesRepo.listAll().length > 0;
  if (reports.length) input.onProgress?.(reports);
  const missingAudit = reports.find((report) => !report.auditVerdict);
  const startChapter = missingAudit
    ? missingAudit.chapterNo
    : input.handle.chaptersRepo.maxChapterNo() + 1;
  if (missingAudit) {
    reports.splice(reports.findIndex((report) => report.chapterNo === missingAudit.chapterNo));
  }
  for (let chapterNo = startChapter; chapterNo <= input.chapterCount; chapterNo += 1) {
    if (chapterNo === 5) {
      createReaderContinuityIssue(input.handle);
      readerIssueCreated = true;
    }
    console.log(`[sillytavern live] chapter ${chapterNo}/${input.chapterCount} start`);
    const report = await runLiveChapter({
      handle: input.handle,
      writeModel,
      auditModel,
      auditModelId: models.getAuditModelInfo().id,
      chapterNo,
      timeoutMs: input.chapterTimeoutMs,
      deepestPrompt: models.getMasterPrompt(),
    });
    reports.push(report);
    console.log(
      `[sillytavern live] chapter ${chapterNo}/${input.chapterCount} ` +
      `wordCount=${report.wordCount} audit=${report.auditVerdict ?? "unknown"} ` +
      `repair=${report.repairVerdict ?? (report.repairAttempted ? "attempted" : "none")} ` +
      `worldbook=${report.worldbookEntryCount} readerIssues=${report.readerIssueIds.length}`,
    );
    input.onProgress?.(reports);
    if (
      (
        report.auditVerdict === "critical" &&
        (!report.repairAttempted || report.repairVerdict === "critical" || report.repairStillCritical)
      ) ||
      report.repairStillCritical
    ) {
      report.stoppedAfterChapter = true;
      input.onProgress?.(reports);
      break;
    }
  }
  return {
    reports,
    readerIssueCreated,
    modelConfig: {
      provider: config.provider,
      writeModelId: config.writeModelId,
      auditModelId: config.auditModelId,
      appRoot: appPaths.appRoot,
    },
  };
}

function buildExistingLiveReports(
  handle: BookHandle,
  uptoChapterNo: number,
): ChapterMonitorReport[] {
  const reports: ChapterMonitorReport[] = [];
  const allIssues = handle.readerIssuesRepo.listAll();
  const recordedStateExists =
    handle.charactersRepo.list().length > 0 ||
    handle.foreshadowingRepo.list("active").length > 0 ||
    handle.genreSectionsRepo.listSections().some((section) =>
      handle.genreSectionsRepo.listItems(section.id).length > 0
    );
  for (let chapterNo = 1; chapterNo <= uptoChapterNo; chapterNo += 1) {
    const userIntent = intentForChapter(chapterNo);
    const writeContext = buildChapterWriteMessages(handle, chapterNo, userIntent);
    const diagnostics = writeContext.diagnostics ?? {
      promptPresetBlockIds: [],
      promptRegexScriptsApplied: [],
      worldbookEntryIds: [],
      readerIssueIds: [],
    };
    const chapter = handle.chapterFiles.read(chapterNo);
    const audit = handle.chaptersRepo.getAudit(chapterNo);
    const auditCtx = buildChapterAuditContext(handle, chapterNo, userIntent).auditCtx;
    const joined = writeContext.messages.map((message) => String(message.content)).join("\n");
    const applicableIssueIds = allIssues
      .filter((issue) => issue.chapterNo < chapterNo)
      .map((issue) => issue.id);
    const report: ChapterMonitorReport = {
      chapterNo,
      userIntent,
      wordCount: countReadableWords(chapter?.content ?? ""),
      presetBlockCount: diagnostics.promptPresetBlockIds.length,
      presetBlockIds: diagnostics.promptPresetBlockIds,
      regexScriptsApplied: diagnostics.promptRegexScriptsApplied,
      worldbookEntryCount: diagnostics.worldbookEntryIds.length,
      worldbookEntryIds: diagnostics.worldbookEntryIds,
      readerIssueIds: applicableIssueIds,
      readerIssuesBefore: applicableIssueIds,
      readerIssuesAfter: allIssues
        .filter((issue) => issue.chapterNo <= chapterNo)
        .map((issue) => issue.id),
      messageCount: writeContext.messages.length,
      containsWorldbook: joined.includes("## Worldbook"),
      continuityNotes: [],
      styleNotes: [],
      auditVerdict: audit?.verdict,
      auditIssuesCount: audit?.issues.filter((issue) => issue.severity !== "ok").length,
      auditWorldbookPresent: Boolean(auditCtx.worldbookContext?.trim()),
      auditReaderIssuesPresent: Boolean(auditCtx.readerIssuesContext?.trim()),
      auditHardContinuityPresent: Boolean(auditCtx.hardContinuityContext?.trim()),
      recordStateAttempted: recordedStateExists,
      recordStateSucceeded: recordedStateExists,
      recordStateToolCallCount: 0,
      recordStateUpsertCount: 0,
    };
    if (audit?.verdict === "critical") {
      report.writeError = "existing critical audit";
    }
    extractDiagnostics(writeContext.messages, report);
    if (audit?.verdict === "critical") {
      report.continuityNotes.push("audit verdict critical");
    }
    reports.push(report);
  }
  return reports;
}

async function createMonitorBook(app: ReturnType<typeof createApp>) {
  const create = await app.request("/api/books", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: `SillyTavern Longform Monitor ${Date.now()}`,
      genre: "宠物捕捉系统",
    }),
  });
  if (create.status !== 201) {
    throw new Error(`create book failed: ${create.status} ${await create.text()}`);
  }
  return create.json() as Promise<{ id: string }>;
}

function buildOutput(input: {
  mode: "live" | "context";
  bookId: string;
  presetPath: string;
  worldbookPath: string;
  reportPath: string;
  partialPath: string;
  config: Record<string, unknown>;
  ignoreExistingCritical: boolean;
  imports: MonitorOutput["imports"];
  chapterCount: number;
  reports: ChapterMonitorReport[];
  readerIssueCreated: boolean;
}): MonitorOutput {
  const reportsForVerdict = input.ignoreExistingCritical
    ? input.reports.map((report) => ({
        ...report,
        continuityNotes: report.writeError === "existing critical audit"
          ? report.continuityNotes.filter((note) => note !== "audit verdict critical")
          : report.continuityNotes,
      }))
    : input.reports;
  const verdict = buildSillyTavernLongformVerdict({
    expectedChapterCount: input.chapterCount,
    reports: reportsForVerdict,
    readerIssueCreated: input.readerIssueCreated,
    live: input.mode === "live",
  });
  return {
    generatedAt: new Date().toISOString(),
    mode: input.mode,
    bookId: input.bookId,
    paths: {
      presetPath: input.presetPath,
      worldbookPath: input.worldbookPath,
      reportPath: input.reportPath,
      partialPath: input.partialPath,
    },
    config: input.config,
    ignoreExistingCritical: input.ignoreExistingCritical,
    imports: input.imports,
    chapterCount: input.chapterCount,
    presetInjectedChapters: input.reports
      .filter((report) => report.presetBlockCount > 0)
      .map((report) => report.chapterNo),
    regexAppliedChapters: input.reports
      .filter((report) => report.regexScriptsApplied.length > 0)
      .map((report) => report.chapterNo),
    worldbookTriggeredChapters: input.reports
      .filter((report) => report.worldbookEntryCount > 0)
      .map((report) => report.chapterNo),
    readerIssueInjectionCount: input.reports
      .filter((report) => report.readerIssueIds.length > 0)
      .length,
    verdict,
    reports: input.reports,
  };
}

async function main() {
  const args = parseSillyTavernMonitorArgs(process.argv.slice(2), {
    defaultPresetPath: path.join(repoRoot, "Izumi 0503.json"),
    defaultWorldbookPath: findWorldbookPath(repoRoot),
  });
  const root = args.live
    ? resolveAppPaths({ env: process.env }).appRoot
    : fs.mkdtempSync(path.join(os.tmpdir(), "scribe-sillytavern-longform-"));
  const paths = args.live ? resolveAppPaths({ env: process.env }) : makeTempPaths(root);
  fs.mkdirSync(paths.booksDir, { recursive: true });
  const registry = createBookRegistry({ paths });
  const app = createApp({ bookRegistry: registry, appPaths: paths });
  let reportPath = "";
  let partialPath = "";

  try {
    const book = args.bookId
      ? registry.booksRepo.get(args.bookId) ?? (() => {
          throw new Error(`book not found: ${args.bookId}`);
        })()
      : await createMonitorBook(app);
    const handle = registry.open(book.id);
    const existingPresets = handle.promptPresetsRepo.listPresets();
    const existingImportedWorldbookEntries = handle.worldbookRepo
      .list()
      .filter((entry) => entry.metadata?.seed !== true);
    const presetImport = existingPresets.length
      ? { imported: { promptPresets: existingPresets.length, promptBlocks: existingPresets.reduce((sum, preset) => sum + handle.promptPresetsRepo.listBlocks(preset.id).length, 0), worldbookEntries: 0 } }
      : await importFile(app, book.id, args.presetPath);
    const worldbookImport = existingImportedWorldbookEntries.length
      ? { imported: { promptPresets: 0, promptBlocks: 0, worldbookEntries: existingImportedWorldbookEntries.length } }
      : await importFile(app, book.id, args.worldbookPath);
    handle.bookMetaRepo.set(
      "premise",
      "一本长篇宠物捕捉系统小说，重点验证状态栏、捕捉规则、契约代价、阵营冲突与角色记忆的连续性。",
    );
    handle.bookMetaRepo.set(
      "tone",
      "读者视角、剧情推进优先、设定自然进入正文、避免百科式解释",
    );
    handle.bookMetaRepo.set("genre", "宠物捕捉系统");

    const outDir = path.join(repoRoot, "packages", "server", "tmp");
    fs.mkdirSync(outDir, { recursive: true });
    reportPath = path.join(
      outDir,
      `sillytavern-longform-${args.live ? "live" : "context"}-${new Date()
        .toISOString()
        .replace(/[:.]/g, "-")}.json`,
    );
    partialPath = reportPath.replace(/\.json$/, ".partial.json");

    let latestReports: ChapterMonitorReport[] = [];
    let readerIssueCreated = false;
    const writePartial = (reports: ChapterMonitorReport[], modelConfig: Record<string, unknown>) => {
      const partial = buildOutput({
        mode: args.live ? "live" : "context",
        bookId: book.id,
        presetPath: args.presetPath,
        worldbookPath: args.worldbookPath,
        reportPath,
        partialPath,
        config: modelConfig,
        ignoreExistingCritical: args.ignoreExistingCritical,
        imports: {
          preset: presetImport.imported,
          worldbook: worldbookImport.imported,
        },
        chapterCount: args.chapterCount,
        reports,
        readerIssueCreated,
      });
      fs.writeFileSync(partialPath, JSON.stringify(partial, null, 2), "utf-8");
    };

    const run = args.live
      ? await runLiveMonitor({
          handle,
          chapterCount: args.chapterCount,
          chapterTimeoutMs: args.chapterTimeoutMs,
          onProgress: (reports) => {
            latestReports = reports;
            writePartial(reports, { mode: "live-in-progress" });
          },
        })
      : {
          ...(await runContextMonitor(handle, args.chapterCount)),
          modelConfig: { mode: "context-only" },
        };
    latestReports = run.reports;
    readerIssueCreated = run.readerIssueCreated;
    const output = buildOutput({
      mode: args.live ? "live" : "context",
      bookId: book.id,
      presetPath: args.presetPath,
      worldbookPath: args.worldbookPath,
      reportPath,
      partialPath,
      config: run.modelConfig,
      ignoreExistingCritical: args.ignoreExistingCritical,
      imports: {
        preset: presetImport.imported,
        worldbook: worldbookImport.imported,
      },
      chapterCount: args.chapterCount,
      reports: latestReports,
      readerIssueCreated,
    });
    fs.writeFileSync(reportPath, JSON.stringify(output, null, 2), "utf-8");
    console.log(JSON.stringify({
      generatedAt: output.generatedAt,
      mode: output.mode,
      bookId: output.bookId,
      chapterCount: output.chapterCount,
      imports: output.imports,
      presetInjectedChapterCount: output.presetInjectedChapters.length,
      regexAppliedChapterCount: output.regexAppliedChapters.length,
      worldbookTriggeredChapterCount: output.worldbookTriggeredChapters.length,
      readerIssueInjectionCount: output.readerIssueInjectionCount,
      verdict: output.verdict,
      reportPath,
    }, null, 2));
    if (!output.verdict.passed) {
      console.error(`[sillytavern monitor failed] ${output.verdict.failureReasons.join("; ")}`);
      process.exitCode = args.live ? 2 : 3;
    }
  } finally {
    registry.closeAll();
    if (!args.live) fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`[sillytavern monitor failed] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
