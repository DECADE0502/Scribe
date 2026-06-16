import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { SseEvent } from "@scribe/shared";
import {
  resolveDisplayFieldNames,
  resolveIdentityFieldNames,
  resolveItemIdentityKey,
  resolveItemLabel,
  type GenreSection,
  type GenreSectionItem,
} from "@scribe/shared";
import { resolveAppPaths } from "../src/config/paths.js";
import { loadConfig } from "../src/config/load.js";
import { loadSecrets } from "../src/config/secrets.js";
import { createModelManager } from "../src/ai/model-manager.js";
import { createBookRegistry, type BookHandle } from "../src/http/book-registry.js";
import { runNewBookConversation } from "../src/ai/orchestrator/new-book.js";
import { runAutoMode } from "../src/ai/orchestrator/auto-mode.js";
import {
  buildArchiveSummary,
  recordChapterState,
} from "../src/ai/orchestrator/record-state.js";
import {
  buildBookPromptContext,
  buildChapterWriteMessages,
} from "../src/ai/context-builder/book-context.js";
import { computeUsageCost } from "../src/ai/usage-tracker.js";

interface ToolEvent {
  phase: "onboard" | "auto";
  bookId: string;
  toolName: string;
  args?: unknown;
  result?: unknown;
}

interface BookReport {
  bookId: string;
  requestedTitle: string;
  persistedTitle?: string;
  premise: string;
  errors: Array<{ phase: string; errorClass: string; message: string }>;
  onboard: {
    done: boolean;
    toolCalls: string[];
    textLength: number;
  };
  auto: {
    done: boolean;
    chaptersRequested: number;
    maxChapterNo: number;
    doneChapters: number[];
    auditVerdicts: Array<{ chapterNo?: number; verdict?: unknown; issuesCount?: unknown }>;
    recordStateRuns: number;
    toolCalls: string[];
  };
  usage: {
    promptTokens: number;
    completionTokens: number;
    cachedTokens: number;
    reasoningTokens: number;
    estimatedCostUsd: number;
  };
  state: {
    characters: number;
    foreshadowingActive: number;
    timelineEvents: number;
    collections: Array<{
      name: string;
      identityFields: string[];
      displayFields: string[];
      searchFields: string[];
      schema: Array<{
        name: string;
        type: unknown;
        role?: string;
        required?: boolean;
        isLabel?: boolean;
      }>;
      relationFields: Array<{ name: string; type: unknown }>;
      items: Array<{
        id: string;
        label: string;
        identityKey?: string;
        data: Record<string, unknown>;
      }>;
    }>;
  };
  checks: {
    genericToolCalls: string[];
    legacyToolCalls: string[];
    hasDeclaredCollections: boolean;
    hasItems: boolean;
    missingIdentityDeclarations: string[];
    missingDisplayDeclarations: string[];
    failedToolResults: Array<{ toolName: string; message: string }>;
    recoveredToolFailures: Array<{ toolName: string; message: string }>;
    requiredTerms: string[];
    matchedRequiredTerms: string[];
    passed: boolean;
    failureReasons: string[];
  };
}

const GENERIC_TOOLS = new Set([
  "create_record_collection",
  "update_record_collection_schema",
  "upsert_record_item",
  "link_record_items",
  "update_record_item",
  "delete_record_item",
  "delete_record_collection",
]);

const LEGACY_RECORD_TOOLS = new Set([
  "create_genre_section",
  "update_genre_section_schema",
  "add_genre_section_item",
  "upsert_genre_section_item",
  "update_genre_section_item",
  "delete_genre_section_item",
  "delete_genre_section",
]);

const scenarios = [
  {
    slug: "signal-station",
    requiredTerms: ["深空", "信号", "中继站", "协议", "林砚"],
    title: "冷讯号港",
    genre: "科幻悬疑",
    premise:
      "近未来深空中继站收到一段无法归类的外星信号，站内安全官、语言模型工程师和企业监察员必须在政治压力、设备异常和信号自我演化之间查清真相。",
    seed:
      "开一本科幻悬疑长篇，主角是深空中继站安全官林砚。核心卖点是外星信号、站内政治、企业监察和逐步失控的通信协议。请完成建书：书名、基调、主角和主要配角、第一卷大纲、写作规则，并自动判断需要长期维护一致性的通用记录集合，比如协议、异常、站内权限、证据链等。不要套固定题材模板。",
  },
  {
    slug: "contract-launch",
    requiredTerms: ["合同", "法务", "上线", "合规", "许知微"],
    title: "灰度上线",
    genre: "职场法务现实",
    premise:
      "一家企业软件公司在重大产品上线前发现客户合同、数据合规、销售承诺和内部绩效目标互相冲突，年轻法务和产品负责人必须用有限证据阻止灾难性违约。",
    seed:
      "开一本职场法务现实题材长篇，主角是产品法务顾问许知微。故事围绕 SaaS 产品上线、合同义务、数据合规、销售承诺、客户关系和公司内控展开。请完成建书、人物、大纲、规则，并让 AI 自己判断应该建立哪些通用记录集合，例如合同条款、风险、客户承诺、内部决策记录等。不要使用玄幻或异能类设定。",
  },
  {
    slug: "floating-isles",
    requiredTerms: ["群岛", "航线", "遗物", "地图", "阿澜"],
    title: "群岛拾遗录",
    genre: "奇幻冒险",
    premise:
      "漂浮群岛的地图会随季风改写，修补地图的少女和失忆领航员寻找一枚会改变生态秩序的古老遗物，同时各岛的习俗、航线和遗物副作用不断改变队伍选择。",
    seed:
      "开一本奇幻冒险长篇，主角是地图修补师阿澜。世界由漂浮群岛、季风航线、岛屿习俗、古老遗物和生态代价构成。请完成建书、人物、大纲、规则，并自动创建这本书需要长期一致维护的通用记录集合，如岛屿、航线、遗物、习俗、代价或其他你认为必要的对象。不要写成某一本既有书的专用结构。",
  },
];

function parseArgs(): {
  chapters: number;
  only?: string;
  onboardTimeoutMs: number;
  autoTimeoutMs: number;
} {
  const args = process.argv.slice(2);
  const chaptersArg = args.indexOf("--chapters");
  const onlyArg = args.indexOf("--only");
  const onboardTimeoutArg = args.indexOf("--onboard-timeout-ms");
  const autoTimeoutArg = args.indexOf("--auto-timeout-ms");
  return {
    chapters:
      chaptersArg >= 0 && args[chaptersArg + 1]
        ? Math.max(1, Number(args[chaptersArg + 1]))
        : 1,
    only: onlyArg >= 0 ? args[onlyArg + 1] : undefined,
    onboardTimeoutMs:
      onboardTimeoutArg >= 0 && args[onboardTimeoutArg + 1]
        ? Math.max(30_000, Number(args[onboardTimeoutArg + 1]))
        : 240_000,
    autoTimeoutMs:
      autoTimeoutArg >= 0 && args[autoTimeoutArg + 1]
        ? Math.max(60_000, Number(args[autoTimeoutArg + 1]))
        : 420_000,
  };
}

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function toErrorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  return String(value);
}

function safeJson(value: unknown): unknown {
  try {
    JSON.stringify(value);
    return value;
  } catch {
    return String(value);
  }
}

function collectionReport(section: GenreSection, items: GenreSectionItem[]) {
  const identityFields = resolveIdentityFieldNames(section);
  const displayFields = resolveDisplayFieldNames(section);
  const relationFields = section.schema
    .filter((field) => field.role === "relation")
    .map((field) => ({ name: field.name, type: field.type }));
  return {
    name: section.name,
    identityFields,
    displayFields,
    searchFields: section.searchFields ?? [],
    schema: section.schema.map((field) => ({
      name: field.name,
      type: field.type,
      role: field.role,
      required: field.required,
      isLabel: field.isLabel,
    })),
    relationFields,
    items: items.map((item) => ({
      id: item.id,
      label: resolveItemLabel(section, item.data, "?"),
      identityKey: resolveItemIdentityKey(section, item.data),
      data: item.data,
    })),
  };
}

function summarizeState(handle: BookHandle): BookReport["state"] {
  const collections = handle.genreSectionsRepo
    .listSections()
    .map((section) =>
      collectionReport(section, handle.genreSectionsRepo.listItems(section.id)),
    );
  return {
    characters: handle.charactersRepo.list().length,
    foreshadowingActive: handle.foreshadowingRepo.list("active").length,
    timelineEvents: handle.timelineRepo.listAll().length,
    collections,
  };
}

function buildScenarioEvidenceText(
  report: BookReport,
  events: ToolEvent[],
): string {
  const auditText = events
    .filter((event) => event.toolName === "chapter_audit")
    .map((event) => JSON.stringify(event.result ?? ""))
    .join("\n");
  const collectionText = report.state.collections
    .map((collection) =>
      [
        collection.name,
        collection.schema.map((field) => field.name).join(" "),
        collection.items.map((item) => JSON.stringify(item.data)).join(" "),
      ].join(" "),
    )
    .join("\n");
  return [
    report.requestedTitle,
    report.persistedTitle ?? "",
    report.premise,
    auditText,
    collectionText,
  ].join("\n");
}

function buildChecks(
  report: BookReport,
  opts: { requiredTerms: string[]; events: ToolEvent[] },
): BookReport["checks"] {
  const toolCalls = [
    ...report.onboard.toolCalls,
    ...report.auto.toolCalls,
  ];
  const evidenceText = buildScenarioEvidenceText(report, opts.events);
  const matchedRequiredTerms = opts.requiredTerms.filter((term) =>
    evidenceText.includes(term),
  );
  const checks = {
    genericToolCalls: toolCalls.filter((name) => GENERIC_TOOLS.has(name)),
    legacyToolCalls: toolCalls.filter((name) => LEGACY_RECORD_TOOLS.has(name)),
    hasDeclaredCollections: report.state.collections.some(
      (collection) =>
        collection.identityFields.length > 0 &&
        collection.displayFields.length > 0,
    ),
    hasItems: report.state.collections.some((collection) => collection.items.length > 0),
    missingIdentityDeclarations: report.state.collections
      .filter((collection) => collection.identityFields.length === 0)
      .map((collection) => collection.name),
    missingDisplayDeclarations: report.state.collections
      .filter((collection) => collection.displayFields.length === 0)
      .map((collection) => collection.name),
    failedToolResults: [] as Array<{ toolName: string; message: string }>,
    recoveredToolFailures: [] as Array<{ toolName: string; message: string }>,
    requiredTerms: opts.requiredTerms,
    matchedRequiredTerms,
    passed: false,
    failureReasons: [] as string[],
  };
  if (report.errors.length) {
    checks.failureReasons.push(
      `errors:${report.errors.map((e) => `${e.phase}/${e.errorClass}`).join(",")}`,
    );
  }
  if (!report.onboard.done) checks.failureReasons.push("onboard did not finish");
  if (!report.auto.done) checks.failureReasons.push("auto did not finish");
  if (report.auto.maxChapterNo < report.auto.chaptersRequested) {
    checks.failureReasons.push(
      `chapters ${report.auto.maxChapterNo}/${report.auto.chaptersRequested}`,
    );
  }
  if (!report.auto.auditVerdicts.some((audit) => audit.verdict === "ok")) {
    checks.failureReasons.push("no ok audit verdict");
  }
  if (report.auto.recordStateRuns < report.auto.chaptersRequested) {
    checks.failureReasons.push("record state did not run for each chapter");
  }
  if (!checks.hasDeclaredCollections) {
    checks.failureReasons.push("no declared record collections");
  }
  if (!checks.hasItems) checks.failureReasons.push("no record items persisted");
  if (checks.legacyToolCalls.length) {
    checks.failureReasons.push(`legacy tools:${checks.legacyToolCalls.join(",")}`);
  }
  if (!checks.genericToolCalls.length) {
    checks.failureReasons.push("no generic record tool calls");
  }
  if (opts.requiredTerms.length && matchedRequiredTerms.length < 2) {
    checks.failureReasons.push(
      `scenario terms ${matchedRequiredTerms.length}/${opts.requiredTerms.length}`,
    );
  }
  checks.passed = checks.failureReasons.length === 0;
  return checks;
}

function getFailedToolResults(
  events: ToolEvent[],
): Array<{ toolName: string; message: string }> {
  return events
    .filter((event) => {
      const result = event.result as { success?: unknown } | undefined;
      return result?.success === false;
    })
    .map((event) => {
      const result = event.result as { error?: unknown; message?: unknown };
      return {
        toolName: event.toolName,
        message: String(result.error ?? result.message ?? "unknown tool failure"),
      };
    });
}

function splitRecoveredToolFailures(
  failures: Array<{ toolName: string; message: string }>,
  events: ToolEvent[],
  report: BookReport,
): {
  active: Array<{ toolName: string; message: string }>;
  recovered: Array<{ toolName: string; message: string }>;
} {
  const successfulAfterFailure = new Set<string>();
  let sawFailure = false;
  for (const event of events) {
    const result = event.result as { success?: unknown; error?: unknown; message?: unknown } | undefined;
    if (result?.success === false) {
      sawFailure = true;
      continue;
    }
    if (sawFailure && event.toolName === "upsert_record_item" && result && result.success !== false) {
      successfulAfterFailure.add(event.toolName);
    }
    if (sawFailure && event.toolName === "record_chapter_state" && result && result.success === true) {
      successfulAfterFailure.add(event.toolName);
    }
  }
  const flowRecovered =
    report.onboard.done &&
    report.auto.done &&
    report.checks.hasDeclaredCollections &&
    report.checks.hasItems;
  const isRecovered = (failure: { toolName: string }) =>
    successfulAfterFailure.has(failure.toolName) ||
    (flowRecovered && GENERIC_TOOLS.has(failure.toolName));
  const recovered = failures.filter(isRecovered);
  const active = failures.filter((failure) => !isRecovered(failure));
  return { active, recovered };
}

function makeRecordState(
  handle: BookHandle,
  model: NonNullable<ReturnType<ReturnType<typeof createModelManager>["getAuditModel"]>>,
  abortSignal: AbortSignal,
  deepestPrompt: string,
  onUsage: (ev: Extract<SseEvent, { type: "usage" }>) => void,
): (chapterNo: number) => AsyncIterable<SseEvent> {
  return (chapterNo: number) => {
    const chapter = handle.chapterFiles.read(chapterNo);
    if (!chapter) return (async function* empty() {})();
    const archiveSummary = buildArchiveSummary({
      genreSections: handle.genreSectionsRepo.listSections().map((section) => ({
        section,
        items: handle.genreSectionsRepo.listItems(section.id),
      })),
      characters: handle.charactersRepo.list(),
      activeForeshadowing: handle.foreshadowingRepo.list("active"),
    });
    const inner = recordChapterState(
      {
        model,
        stateDeps: {
          charactersRepo: handle.charactersRepo,
          foreshadowingRepo: handle.foreshadowingRepo,
          timelineRepo: handle.timelineRepo,
          chapterNo,
        },
        genreDeps: {
          repo: handle.genreSectionsRepo,
          charactersRepo: handle.charactersRepo,
        },
        abortSignal,
        deepestPrompt,
      },
      { chapterNo, chapterContent: chapter.content, archiveSummary },
    );
    return (async function* withUsage() {
      for await (const ev of inner) {
        if (ev.type === "usage") onUsage(ev);
        yield ev;
      }
    })();
  };
}

async function runScenario(
  registry: ReturnType<typeof createBookRegistry>,
  models: ReturnType<typeof createModelManager>,
  scenario: (typeof scenarios)[number],
  chapters: number,
  opts: { onboardTimeoutMs: number; autoTimeoutMs: number },
): Promise<{ report: BookReport; toolEvents: ToolEvent[] }> {
  const book = registry.booksRepo.create({
    title: `${scenario.title} 监控 ${Date.now()}`,
    genre: scenario.genre,
  });
  const handle = registry.open(book.id);
  const toolEvents: ToolEvent[] = [];
  const writeModel = models.getModel();
  const auditModel = models.getAuditModel();
  const writeModelInfo = models.getWriteModelInfo();
  const auditModelInfo = models.getAuditModelInfo();
  if (!writeModel || !auditModel) {
    throw new Error("model is not configured");
  }

  const usage = {
    promptTokens: 0,
    completionTokens: 0,
    cachedTokens: 0,
    reasoningTokens: 0,
    estimatedCostUsd: 0,
  };
  const errors: BookReport["errors"] = [];
  const onboardToolCalls: string[] = [];
  const autoToolCalls: string[] = [];
  const auditVerdicts: BookReport["auto"]["auditVerdicts"] = [];
  const doneChapters = new Set<number>();
  let onboardTextLength = 0;
  let onboardDone = false;
  let autoDone = false;
  let recordStateRuns = 0;

  const addUsage = (
    info: typeof writeModelInfo,
    ev: Extract<SseEvent, { type: "usage" }>,
  ) => {
    usage.promptTokens += ev.promptTokens;
    usage.completionTokens += ev.completionTokens;
    usage.cachedTokens += ev.cachedTokens ?? 0;
    usage.reasoningTokens += ev.reasoningTokens ?? 0;
    usage.estimatedCostUsd += computeUsageCost(
      info,
      ev.promptTokens,
      ev.completionTokens,
      ev.cachedTokens ?? 0,
    );
  };

  const onboardController = new AbortController();
  const onboardTimer = setTimeout(() => {
    onboardController.abort();
  }, opts.onboardTimeoutMs);
  log(`onboard start ${scenario.title} (${book.id})`);
  try {
    for await (const ev of runNewBookConversation(
      {
        model: writeModel,
        toolDeps: {
          genreToolsDeps: {
            repo: handle.genreSectionsRepo,
            charactersRepo: handle.charactersRepo,
          },
          bookMetaToolsDeps: {
            bookMetaRepo: handle.bookMetaRepo,
            charactersRepo: handle.charactersRepo,
            outlineRepo: handle.outlineRepo,
            rulesMdPath: handle.rulesMdPath,
          },
        },
        abortSignal: onboardController.signal,
        maxSteps: 14,
        deepestPrompt: models.getMasterPrompt(),
      },
      { message: scenario.seed },
    )) {
      if (ev.type === "text_delta") onboardTextLength += ev.delta.length;
      if (ev.type === "tool_call_start") {
        onboardToolCalls.push(ev.toolName);
        toolEvents.push({
          phase: "onboard",
          bookId: book.id,
          toolName: ev.toolName,
          args: safeJson(ev.args),
        });
        log(`  onboard tool ${ev.toolName}`);
      }
      if (ev.type === "tool_call_end") {
        toolEvents.push({
          phase: "onboard",
          bookId: book.id,
          toolName: ev.toolName,
          result: safeJson(ev.result),
        });
      }
      if (ev.type === "usage") addUsage(writeModelInfo, ev);
      if (ev.type === "done") onboardDone = true;
      if (ev.type === "error") {
        errors.push({ phase: "onboard", errorClass: ev.errorClass, message: ev.message });
        break;
      }
    }
  } finally {
    clearTimeout(onboardTimer);
  }
  if (onboardController.signal.aborted && !onboardDone) {
    errors.push({
      phase: "onboard",
      errorClass: "stage_timeout",
      message: `onboard exceeded ${opts.onboardTimeoutMs}ms`,
    });
  }

  log(`auto start ${scenario.title} chapters=${chapters}`);
  const promptCtx = buildBookPromptContext(handle);
  const autoController = new AbortController();
  const autoTimer = setTimeout(() => {
    autoController.abort();
  }, opts.autoTimeoutMs);
  const recordState = makeRecordState(
    handle,
    auditModel,
    autoController.signal,
    models.getMasterPrompt(),
    (ev) => addUsage(auditModelInfo, ev),
  );

  try {
    for await (const ev of runAutoMode(
      {
        model: writeModel,
        auditModel,
        auditModelId: auditModelInfo.id,
        chaptersRepo: handle.chaptersRepo,
        chapterFiles: handle.chapterFiles,
        maxChapterNo: () => handle.chaptersRepo.maxChapterNo(),
        getVerdict: (chapterNo) => handle.chaptersRepo.getAudit(chapterNo)?.verdict,
        budgetLimitUsd: 50,
        writeModelInfo,
        auditModelInfo,
        abortSignal: autoController.signal,
        deepestPrompt: models.getMasterPrompt(),
        recordState,
        buildWriteMessages: (chapterNo) =>
          buildChapterWriteMessages(handle, chapterNo, "").messages,
      },
      { n: chapters, writeCtx: promptCtx.writeCtx, auditCtx: promptCtx.auditCtx },
    )) {
      if (ev.type === "auto_status") {
        for (const chapterNo of ev.doneChapters) doneChapters.add(chapterNo);
        if (ev.state === "done") autoDone = true;
      }
      if (ev.type === "tool_call_start") {
        autoToolCalls.push(ev.toolName);
        if (ev.toolName === "record_chapter_state") recordStateRuns += 1;
        toolEvents.push({
          phase: "auto",
          bookId: book.id,
          toolName: ev.toolName,
          args: safeJson(ev.args),
        });
        log(`  auto tool ${ev.toolName}`);
      }
      if (ev.type === "tool_call_end") {
        toolEvents.push({
          phase: "auto",
          bookId: book.id,
          toolName: ev.toolName,
          result: safeJson(ev.result),
        });
        if (ev.toolName === "chapter_audit") {
          const result = ev.result as { verdict?: unknown; issuesCount?: unknown };
          auditVerdicts.push({
            chapterNo: handle.chaptersRepo.maxChapterNo(),
            verdict: result?.verdict,
            issuesCount: result?.issuesCount,
          });
        }
      }
      if (ev.type === "usage") addUsage(writeModelInfo, ev);
      if (ev.type === "error") {
        errors.push({ phase: "auto", errorClass: ev.errorClass, message: ev.message });
        break;
      }
    }
  } finally {
    clearTimeout(autoTimer);
  }
  if (autoController.signal.aborted && !autoDone) {
    errors.push({
      phase: "auto",
      errorClass: "stage_timeout",
      message: `auto exceeded ${opts.autoTimeoutMs}ms`,
    });
  }

  const report: BookReport = {
    bookId: book.id,
    requestedTitle: scenario.title,
    persistedTitle: handle.bookMetaRepo.get("title") ?? book.title,
    premise: scenario.premise,
    errors,
    onboard: {
      done: onboardDone,
      toolCalls: onboardToolCalls,
      textLength: onboardTextLength,
    },
    auto: {
      done: autoDone,
      chaptersRequested: chapters,
      maxChapterNo: handle.chaptersRepo.maxChapterNo(),
      doneChapters: [...doneChapters].sort((a, b) => a - b),
      auditVerdicts,
      recordStateRuns,
      toolCalls: autoToolCalls,
    },
    usage,
    state: summarizeState(handle),
    checks: {
      genericToolCalls: [],
      legacyToolCalls: [],
      hasDeclaredCollections: false,
      hasItems: false,
      missingIdentityDeclarations: [],
      missingDisplayDeclarations: [],
    },
  };
  report.checks = buildChecks(report, {
    requiredTerms: scenario.requiredTerms,
    events: toolEvents,
  });
  const toolFailures = splitRecoveredToolFailures(
    getFailedToolResults(toolEvents),
    toolEvents,
    report,
  );
  report.checks.failedToolResults = toolFailures.active;
  report.checks.recoveredToolFailures = toolFailures.recovered;
  if (toolFailures.active.length) {
    report.checks.failureReasons.push(
      `failed tools:${toolFailures.active
        .map((failure) => failure.toolName)
        .join(",")}`,
    );
    report.checks.passed = false;
  }
  log(
    `done ${scenario.title}: chapters=${report.auto.maxChapterNo}, collections=${report.state.collections.length}, errors=${report.errors.length}, passed=${report.checks.passed}`,
  );
  return { report, toolEvents };
}

async function main() {
  const args = parseArgs();
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
  if (!models.getModel() || !models.getAuditModel()) {
    throw new Error(
      `No usable model configured. provider=${config.provider}, config=${appPaths.configJson}, secrets=${appPaths.secretsEnv}`,
    );
  }

  log(
    `config provider=${config.provider} write=${config.writeModelId} audit=${config.auditModelId} appRoot=${appPaths.appRoot}`,
  );

  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../..",
  );
  const outDir = path.join(repoRoot, "tmp");
  fs.mkdirSync(outDir, { recursive: true });
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(outDir, `generic-record-monitor-${runId}.json`);
  const partialPath = path.join(outDir, `generic-record-monitor-${runId}.partial.json`);

  const registry = createBookRegistry({ paths: appPaths });
  const selected = args.only
    ? scenarios.filter((scenario) => scenario.slug === args.only)
    : scenarios;
  if (!selected.length) {
    throw new Error(`No scenario matched --only ${args.only}`);
  }

  const reports: BookReport[] = [];
  const toolEvents: ToolEvent[] = [];
  const buildOutput = () => ({
    generatedAt: new Date().toISOString(),
    config: {
      provider: config.provider,
      writeModelId: config.writeModelId,
      auditModelId: config.auditModelId,
      appRoot: appPaths.appRoot,
    },
    chaptersPerBook: args.chapters,
    timeouts: {
      onboardTimeoutMs: args.onboardTimeoutMs,
      autoTimeoutMs: args.autoTimeoutMs,
    },
    reports,
    toolEvents,
  });
  try {
    for (const scenario of selected) {
      const result = await runScenario(registry, models, scenario, args.chapters, {
        onboardTimeoutMs: args.onboardTimeoutMs,
        autoTimeoutMs: args.autoTimeoutMs,
      });
      reports.push(result.report);
      toolEvents.push(...result.toolEvents);
      fs.writeFileSync(partialPath, JSON.stringify(buildOutput(), null, 2), "utf-8");
      log(`partial report ${partialPath}`);
    }
  } finally {
    registry.closeAll();
  }

  const output = buildOutput();
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), "utf-8");
  log(`report ${outPath}`);
  console.log(JSON.stringify(output, null, 2));
  const failed = reports.filter((report) => !report.checks.passed);
  if (failed.length) {
    console.error(
      `[monitor verdict failed] ${failed
        .map((report) => `${report.requestedTitle}:${report.checks.failureReasons.join("|")}`)
        .join("; ")}`,
    );
    process.exit(2);
  }
}

main().catch((error) => {
  console.error(`[monitor failed] ${toErrorMessage(error)}`);
  process.exit(1);
});
