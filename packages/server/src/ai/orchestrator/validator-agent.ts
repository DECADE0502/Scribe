import type { ValidationIssue, ValidationReport } from "@scribe/shared";
import type { StagedChange } from "./workflow-staging.js";

export interface ValidatorDeps {
  handle: {
    bookId: string;
    chapterFiles?: { read(no: number): { content: string } | undefined };
    charactersRepo?: { list(): Array<{ name: string }> };
    readerIssuesRepo?: { create(input: { chapterNo: number; type: "continuity"; severity: "warning"; note: string }): unknown };
  };
  model: unknown;
  auditModelId?: string;
}

export async function validateStagedChanges(
  _deps: ValidatorDeps,
  changes: StagedChange[],
  userMessage: string,
): Promise<ValidationReport> {
  const issues: ValidationIssue[] = [];
  const requestedChapterNo = extractRequestedChapterNo(userMessage);

  for (const change of changes) {
    if (change.type === "chapter_version") {
      validateChapterVersion(change, requestedChapterNo, userMessage, issues);
    } else if (change.type === "character_upsert") {
      validateCharacterUpsert(change, issues);
    } else if (change.type === "outline_upsert") {
      validateOutlineUpsert(change, issues);
    } else if (change.type === "worldbook_upsert") {
      validateWorldbookUpsert(change, issues);
    } else if (change.type === "chapter_audit") {
      validateChapterAudit(change, issues);
    }
  }

  if (issues.length === 0) {
    return { verdict: "pass", issues: [], commitAllowed: true };
  }
  const hasCritical = issues.some((i) => i.severity === "critical");
  if (hasCritical) {
    return { verdict: "fail", issues, commitAllowed: false };
  }
  return { verdict: "repairable", issues, commitAllowed: false };
}

function validateChapterVersion(
  change: StagedChange,
  requestedChapterNo: number | undefined,
  userMessage: string,
  issues: ValidationIssue[],
): void {
  const p = change.payload as {
    chapterNo?: number;
    content?: string;
    title?: string;
    acceptanceCriteria?: unknown;
  };
  if (!p.chapterNo || p.chapterNo < 1) {
    issues.push(critical("chapter", "章节写入缺少有效章节编号", "stop"));
    return;
  }
  if (requestedChapterNo !== undefined && p.chapterNo !== requestedChapterNo) {
    issues.push(critical(
      "chapter",
      `目标章节不一致: 用户要求第 ${requestedChapterNo} 章，执行计划写入第 ${p.chapterNo} 章`,
      "stop",
    ));
  }

  const content = p.content?.trim() ?? "";
  if (content.length < 100) {
    issues.push({
      severity: "warning",
      area: "chapter",
      message: `第 ${p.chapterNo} 章正文不足 100 字`,
      suggestedAction: "repair",
    });
  }

  if (hasSerialFillerEnding(content)) {
    issues.push(critical(
      "chapter",
      "章节结尾包含待续、下一章再展开等连续小说填充式收尾，不能提交",
      "reroll",
    ));
  }

  const criteria = normalizeCriteria(p.acceptanceCriteria);
  const combinedCriteria = `${userMessage}\n${criteria.join("\n")}`;
  if (requiresFirstPerson(combinedCriteria) && !looksLikeFirstPerson(content)) {
    issues.push(critical(
      "chapter",
      "验收标准要求第一人称，但正文没有稳定使用第一人称叙述",
      "reroll",
    ));
  }

  for (const criterion of criteria) {
    if (!criterion.trim()) {
      issues.push(critical("chapter", "章节验收标准包含空项，无法验证", "stop"));
    }
  }
}

function validateCharacterUpsert(change: StagedChange, issues: ValidationIssue[]): void {
  const p = change.payload as { name?: string };
  if (!p.name?.trim()) {
    issues.push(critical("character", "角色变更缺少角色名", "stop"));
  }
}

function validateOutlineUpsert(change: StagedChange, issues: ValidationIssue[]): void {
  const p = change.payload as { title?: string; level?: string; summary?: string | null };
  if (!p.title?.trim()) {
    issues.push(critical("outline", "大纲变更缺少标题", "stop"));
  }
  if (!["volume", "arc", "chapter"].includes(String(p.level))) {
    issues.push(critical("outline", "大纲变更缺少有效层级", "stop"));
  }
}

function validateWorldbookUpsert(change: StagedChange, issues: ValidationIssue[]): void {
  const p = change.payload as { title?: string; content?: string };
  if (!p.title?.trim()) {
    issues.push(critical("worldbook", "世界书变更缺少标题", "stop"));
  }
  if (!p.content?.trim()) {
    issues.push(critical("worldbook", "世界书变更缺少内容", "stop"));
  }
}

function validateChapterAudit(change: StagedChange, issues: ValidationIssue[]): void {
  const p = change.payload as { chapterNo?: number; verdict?: string; issues?: unknown[] };
  if (typeof p.chapterNo !== "number" || p.chapterNo < 0) {
    issues.push(critical("system", "审查记录缺少有效章节范围", "stop"));
  }
  if (!["ok", "warning", "critical"].includes(String(p.verdict))) {
    issues.push(critical("system", "审查记录缺少有效结论", "stop"));
  }
  if (!Array.isArray(p.issues)) {
    issues.push(critical("system", "审查记录缺少 issues 数组", "stop"));
  }
}

function critical(
  area: ValidationIssue["area"],
  message: string,
  suggestedAction: ValidationIssue["suggestedAction"],
): ValidationIssue {
  return { severity: "critical", area, message, suggestedAction };
}

function normalizeCriteria(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function hasSerialFillerEnding(content: string): boolean {
  const tail = content.slice(-200);
  return /(?:未完待续|待续|下章(?:再|继续|揭晓|展开)|下一章(?:再|继续|揭晓|展开)|欲知后事|且听下回|to be continued)/i.test(tail);
}

function requiresFirstPerson(text: string): boolean {
  return /(?:第一人称|一人称|主角视角|我的视角|用\s*我\s*来写|以\s*我\s*为视角|first[-\s]?person)/i.test(text);
}

function looksLikeFirstPerson(content: string): boolean {
  const sample = content.slice(0, 1200);
  const firstPersonMatches = sample.match(/[我咱]/g)?.length ?? 0;
  const thirdPersonMatches = sample.match(/[他她][^们]/g)?.length ?? 0;
  return firstPersonMatches >= 2 && firstPersonMatches >= thirdPersonMatches;
}

function extractRequestedChapterNo(message: string): number | undefined {
  const arabic = message.match(/第\s*(\d+)\s*[章节回]/);
  if (arabic?.[1]) return Number(arabic[1]);

  const english = message.match(/\bchapter\s+(\d+)\b/i);
  if (english?.[1]) return Number(english[1]);

  const chinese = message.match(/第\s*([一二三四五六七八九十百两]+)\s*[章节回]/);
  if (!chinese?.[1]) return undefined;
  return parseChineseInteger(chinese[1]);
}

function parseChineseInteger(value: string): number | undefined {
  const digits: Record<string, number> = {
    零: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  if (value === "十") return 10;
  if (value.includes("十")) {
    const [left, right] = value.split("十");
    const tens = left ? digits[left] : 1;
    const ones = right ? digits[right] : 0;
    if (tens === undefined || ones === undefined) return undefined;
    return tens * 10 + ones;
  }
  return digits[value];
}
