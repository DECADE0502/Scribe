import { describe, expect, test } from "vitest";
import {
  buildSillyTavernLongformVerdict,
  detectMetaOutputLeakage,
  parseSillyTavernMonitorArgs,
  selectFinalChapterText,
} from "../../../../src/ai/monitor/sillytavern-longform-monitor.js";

describe("sillytavern longform monitor helpers", () => {
  test("parses live mode and chapter count without losing positional json paths", () => {
    const args = parseSillyTavernMonitorArgs(
      [
        "--live",
        "--chapters",
        "15",
        "--book-id",
        "book-1",
        "--ignore-existing-critical",
        "C:/preset.json",
        "C:/worldbook.json",
      ],
      {
        defaultPresetPath: "fallback-preset.json",
        defaultWorldbookPath: "fallback-worldbook.json",
      },
    );

    expect(args.live).toBe(true);
    expect(args.bookId).toBe("book-1");
    expect(args.ignoreExistingCritical).toBe(true);
    expect(args.chapterCount).toBe(15);
    expect(args.presetPath).toBe("C:/preset.json");
    expect(args.worldbookPath).toBe("C:/worldbook.json");
  });

  test("fails when reader-visible longform evidence is missing", () => {
    const verdict = buildSillyTavernLongformVerdict({
      expectedChapterCount: 15,
      reports: [
        {
          chapterNo: 1,
          wordCount: 1000,
          presetBlockCount: 52,
          regexScriptsApplied: ["style"],
          worldbookEntryCount: 0,
          readerIssueIds: [],
          containsWorldbook: false,
          continuityNotes: [],
          styleNotes: [],
        },
      ],
      readerIssueCreated: true,
      live: true,
    });

    expect(verdict.passed).toBe(false);
    expect(verdict.failureReasons).toContain("generated 1/15 chapters");
    expect(verdict.failureReasons).toContain("no imported worldbook entry affected any chapter context");
    expect(verdict.failureReasons).toContain("reader issues were not injected into later chapter context");
  });

  test("fails immediately when a critical chapter remains unrepaired", () => {
    const verdict = buildSillyTavernLongformVerdict({
      expectedChapterCount: 15,
      live: true,
      readerIssueCreated: false,
      reports: [
        {
          chapterNo: 9,
          wordCount: 1800,
          presetBlockCount: 52,
          regexScriptsApplied: ["cleanup"],
          worldbookEntryCount: 8,
          readerIssueIds: [],
          recordStateAttempted: true,
          recordStateSucceeded: true,
          containsWorldbook: true,
          continuityNotes: [],
          styleNotes: [],
          auditVerdict: "critical",
          repairAttempted: true,
          repairVerdict: "critical",
        },
      ],
    });

    expect(verdict.passed).toBe(false);
    expect(verdict.failureReasons).toContain("chapter 9: unresolved critical after repair");
  });

  test("does not fail a repaired critical chapter when re-audit is ok", () => {
    const reports = Array.from({ length: 15 }, (_, index) => ({
      chapterNo: index + 1,
      wordCount: 1800,
      presetBlockCount: 52,
      regexScriptsApplied: ["cleanup"],
      worldbookEntryCount: 8,
      readerIssueIds: index > 4 ? ["issue-1"] : [],
      recordStateAttempted: true,
      recordStateSucceeded: true,
      containsWorldbook: true,
      continuityNotes: [],
      styleNotes: [],
      auditVerdict: index === 8 ? "critical" : "ok",
      repairAttempted: index === 8,
      repairVerdict: index === 8 ? "ok" : undefined,
    }));

    const verdict = buildSillyTavernLongformVerdict({
      expectedChapterCount: 15,
      live: true,
      readerIssueCreated: true,
      reports,
    });

    expect(verdict.failureReasons).not.toContain("chapter 9: audit verdict critical");
    expect(verdict.failureReasons).not.toContain("chapter 9: unresolved critical after repair");
  });

  test("does not fail a repaired critical chapter when re-audit is warning", () => {
    const reports = Array.from({ length: 15 }, (_, index) => ({
      chapterNo: index + 1,
      wordCount: 1800,
      presetBlockCount: 52,
      regexScriptsApplied: ["cleanup"],
      worldbookEntryCount: 8,
      readerIssueIds: index > 4 ? ["issue-1"] : [],
      recordStateAttempted: true,
      recordStateSucceeded: true,
      containsWorldbook: true,
      continuityNotes: index === 8 ? ["audit verdict critical"] : [],
      styleNotes: [],
      auditVerdict: index === 8 ? "critical" : "ok",
      repairAttempted: index === 8,
      repairVerdict: index === 8 ? "warning" : undefined,
      repairStillCritical: false,
    }));

    const verdict = buildSillyTavernLongformVerdict({
      expectedChapterCount: 15,
      live: true,
      readerIssueCreated: true,
      reports,
    });

    expect(verdict.failureReasons).not.toContain("chapter 9: audit verdict critical");
    expect(verdict.failureReasons).not.toContain("chapter 9: unresolved critical after repair");
  });

  test("detects non-novel meta output labels without banning diegetic system text", () => {
    expect(detectMetaOutputLeakage("【进度】：任务完成\n正文继续")).toContain("progress label");
    expect(detectMetaOutputLeakage("AI：我会继续写这一章")).toContain("ai chat log");
    expect(detectMetaOutputLeakage("事件：捕捉成功")).toContain("event frame");
    expect(detectMetaOutputLeakage("<progress>\nPG.1\n</progress>")).toContain("xml meta block");
    expect(detectMetaOutputLeakage("<konatan_chat>hello</konatan_chat>")).toContain("xml meta block");
    expect(detectMetaOutputLeakage("他看见系统提示：捕捉成功。")).toEqual([]);
  });
  test("uses repaired text as final monitor evidence when repair succeeds", () => {
    expect(selectFinalChapterText({
      draftText: "bad draft <progress></progress>",
      repairText: "clean repaired prose",
      repairVerdict: "ok",
    })).toBe("clean repaired prose");
  });

  test("uses draft text when no repair text exists", () => {
    expect(selectFinalChapterText({
      draftText: "original prose",
      repairText: "",
    })).toBe("original prose");
  });

  test("fails live verdict when chapter state recording did not run", () => {
    const reports = Array.from({ length: 15 }, (_, index) => ({
      chapterNo: index + 1,
      wordCount: 1800,
      presetBlockCount: 52,
      regexScriptsApplied: ["cleanup"],
      worldbookEntryCount: 8,
      readerIssueIds: index > 4 ? ["issue-1"] : [],
      containsWorldbook: true,
      continuityNotes: [],
      styleNotes: [],
      auditVerdict: "ok",
      recordStateAttempted: index !== 2,
      recordStateSucceeded: index !== 2,
    }));

    const verdict = buildSillyTavernLongformVerdict({
      expectedChapterCount: 15,
      live: true,
      readerIssueCreated: true,
      reports,
    });

    expect(verdict.passed).toBe(false);
    expect(verdict.failureReasons).toContain("chapter 3: chapter state was not recorded");
  });
});
