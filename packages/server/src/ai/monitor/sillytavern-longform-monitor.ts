export interface SillyTavernMonitorArgs {
  live: boolean;
  bookId?: string;
  ignoreExistingCritical: boolean;
  chapterCount: number;
  presetPath: string;
  worldbookPath: string;
  onboardTimeoutMs: number;
  chapterTimeoutMs: number;
}

export interface SillyTavernMonitorChapterEvidence {
  chapterNo: number;
  wordCount: number;
  presetBlockCount: number;
  regexScriptsApplied: string[];
  worldbookEntryCount: number;
  readerIssueIds: string[];
  hardContinuityPresent?: boolean;
  hardContinuitySnippets?: string[];
  readerIssueSnippets?: string[];
  containsWorldbook: boolean;
  continuityNotes: string[];
  styleNotes: string[];
  auditVerdict?: string;
  repairAttempted?: boolean;
  repairVerdict?: string;
  repairStillCritical?: boolean;
  recordStateAttempted?: boolean;
  recordStateSucceeded?: boolean;
  recordStateToolCallCount?: number;
  recordStateUpsertCount?: number;
  stoppedAfterChapter?: boolean;
}

export interface SillyTavernLongformVerdict {
  passed: boolean;
  failureReasons: string[];
}

export function detectMetaOutputLeakage(text: string): string[] {
  const issues: string[] = [];
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (/<\/?(progress|current_event|konatan_chat|chat|event|analysis|thinking|instructions?)[^>]*>/i.test(text)) {
    issues.push("xml meta block");
  }
  if (lines.some((line) => /^【?(进度|任务|完成|日志|指令|输出|章节目标)】?\s*[:：]/.test(line))) {
    issues.push("progress label");
  }
  if (lines.some((line) => /^(AI|Assistant|User|System|模型|作者)[:：]/i.test(line))) {
    issues.push("ai chat log");
  }
  if (lines.some((line) => /^【?(事件|判定|检定|回合|阶段|状态更新)】?\s*[:：]/.test(line))) {
    issues.push("event frame");
  }

  return [...new Set(issues)];
}

export function selectFinalChapterText(input: {
  draftText: string;
  repairText?: string;
  repairVerdict?: string;
}): string {
  if (input.repairText?.trim() && input.repairVerdict !== "critical") {
    return input.repairText;
  }
  return input.draftText;
}

export function parseSillyTavernMonitorArgs(
  argv: string[],
  defaults: { defaultPresetPath: string; defaultWorldbookPath: string },
): SillyTavernMonitorArgs {
  const positional: string[] = [];
  let live = false;
  let bookId: string | undefined;
  let ignoreExistingCritical = false;
  let chapterCount = 15;
  let onboardTimeoutMs = 240_000;
  let chapterTimeoutMs = 420_000;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) continue;
    if (arg === "--live") {
      live = true;
      continue;
    }
    if (arg === "--book-id" && argv[index + 1]) {
      bookId = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--ignore-existing-critical") {
      ignoreExistingCritical = true;
      continue;
    }
    if (arg === "--chapters" && argv[index + 1]) {
      chapterCount = Math.max(1, Number(argv[index + 1]));
      index += 1;
      continue;
    }
    if (arg === "--onboard-timeout-ms" && argv[index + 1]) {
      onboardTimeoutMs = Math.max(30_000, Number(argv[index + 1]));
      index += 1;
      continue;
    }
    if (arg === "--chapter-timeout-ms" && argv[index + 1]) {
      chapterTimeoutMs = Math.max(60_000, Number(argv[index + 1]));
      index += 1;
      continue;
    }
    positional.push(arg);
  }

  return {
    live,
    bookId,
    ignoreExistingCritical,
    chapterCount,
    presetPath: positional[0] ?? defaults.defaultPresetPath,
    worldbookPath: positional[1] ?? defaults.defaultWorldbookPath,
    onboardTimeoutMs,
    chapterTimeoutMs,
  };
}

export function buildSillyTavernLongformVerdict(input: {
  expectedChapterCount: number;
  reports: SillyTavernMonitorChapterEvidence[];
  readerIssueCreated: boolean;
  live: boolean;
}): SillyTavernLongformVerdict {
  const failureReasons: string[] = [];
  if (input.reports.length < input.expectedChapterCount) {
    failureReasons.push(
      `generated ${input.reports.length}/${input.expectedChapterCount} chapters`,
    );
  }
  if (input.reports.some((report) => report.presetBlockCount === 0)) {
    failureReasons.push("at least one chapter lacked imported preset context");
  }
  if (!input.reports.some((report) => report.regexScriptsApplied.length > 0)) {
    failureReasons.push("no imported regex script affected any chapter context");
  }
  if (!input.reports.some((report) => report.worldbookEntryCount > 0)) {
    failureReasons.push("no imported worldbook entry affected any chapter context");
  }
  if (
    input.readerIssueCreated &&
    !input.reports.some((report) => report.readerIssueIds.length > 0)
  ) {
    failureReasons.push("reader issues were not injected into later chapter context");
  }
  for (const report of input.reports) {
    if (input.live && (!report.recordStateAttempted || !report.recordStateSucceeded)) {
      failureReasons.push(`chapter ${report.chapterNo}: chapter state was not recorded`);
    }
    if (report.auditVerdict !== "critical") continue;
    if (!report.repairAttempted) {
      failureReasons.push(`chapter ${report.chapterNo}: critical without repair attempt`);
      continue;
    }
    if (report.repairVerdict === "critical" || report.repairStillCritical) {
      failureReasons.push(`chapter ${report.chapterNo}: unresolved critical after repair`);
    }
  }
  for (const report of input.reports) {
    if (
      report.auditVerdict !== "critical" &&
      report.repairAttempted &&
      report.repairStillCritical
    ) {
      failureReasons.push(`chapter ${report.chapterNo}: unresolved quality gate after repair`);
    }
  }
  const continuityFailures = input.reports.flatMap((report) =>
    report.continuityNotes
      .filter((note) => {
        if (note !== "audit verdict critical") return true;
        return (
          report.auditVerdict !== "critical" ||
          !report.repairVerdict ||
          report.repairVerdict === "critical" ||
          report.repairStillCritical
        );
      })
      .map((note) => `chapter ${report.chapterNo}: ${note}`),
  );
  const styleFailures = input.reports.flatMap((report) =>
    report.styleNotes.map((note) => `chapter ${report.chapterNo}: ${note}`),
  );
  failureReasons.push(...continuityFailures, ...styleFailures);
  if (!input.live) {
    failureReasons.push(
      "context-only monitor does not prove final prose quality; rerun with --live",
    );
  }
  return {
    passed: failureReasons.length === 0,
    failureReasons,
  };
}
