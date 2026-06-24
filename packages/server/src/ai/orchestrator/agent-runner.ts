import { randomUUID } from "node:crypto";
import { buildExecutionPolicy, type AgentRunRequest, type SseEvent } from "@scribe/shared";
import type { BookHandle } from "../../http/book-registry.js";
import { loadBookSnapshot } from "../context-builder/snapshot.js";
import { analyzeIntent } from "./main-agent.js";
import { runExecutor } from "./executor-agent.js";
import { validateStagedChanges } from "./validator-agent.js";
import { runRepair } from "./repair-agent.js";
import type { WorkflowStaging } from "./workflow-staging.js";
import type { MainAgentDeps } from "./main-agent.js";

export interface AgentRunnerDeps {
  handle: BookHandle;
  model: unknown;
  auditModel: unknown;
  staging: WorkflowStaging;
  abortSignal?: AbortSignal;
  generateText?: MainAgentDeps["generateText"];
}

export async function* runAgentWorkflow(
  deps: AgentRunnerDeps,
  input: Pick<AgentRunRequest, "message" | "source" | "executionMode" | "target">,
): AsyncIterable<SseEvent> {
  const runId = randomUUID();
  try {
    deps.staging.begin(runId, { bookId: deps.handle.bookId, source: input.source });

    yield { type: "agent_phase", phase: "thinking" };
    yield { type: "agent_progress", runId, phase: "thinking", label: "理解意图", status: "running" };
    const main = await analyzeIntent(
      {
        model: deps.model,
        generateText: deps.generateText,
        abortSignal: deps.abortSignal,
        bookContext: buildMainAgentBookContext(deps.handle, input.target?.chapterNo),
      },
      input,
    );
    yield { type: "agent_progress", runId, phase: "thinking", label: "理解意图", status: "done" };
    if (main.usage) {
      yield {
        type: "usage",
        taskType: "intent",
        modelRole: "write",
        promptTokens: main.usage.promptTokens,
        completionTokens: main.usage.completionTokens,
        cachedTokens: main.usage.cachedTokens,
        reasoningTokens: main.usage.reasoningTokens,
        chapterNo: input.target?.chapterNo ?? null,
      };
    }
    yield input.source === "revision"
      ? { type: "main_output", reply: main.reply, draft: main.draft }
      : { type: "main_output", reply: main.reply };

    yield { type: "agent_phase", phase: "executing" };
    yield { type: "agent_progress", runId, phase: "executing", label: "执行变更", status: "running" };
    const plan = await runExecutor(
      { model: deps.model, handle: deps.handle },
      main.taskContract,
    );
    for (const step of plan.steps) {
      deps.staging.add(runId, step);
    }
    yield {
      type: "agent_progress",
      runId,
      phase: "executing",
      label: "执行变更",
      status: "done",
      detail: plan.summary,
    };

    if (plan.steps.length === 0) {
      yield { type: "agent_phase", phase: "validating" };
      yield {
        type: "validation_report",
        verdict: "pass",
        issues: [],
        commitAllowed: false,
      };
      yield { type: "agent_phase", phase: "completed" };
      yield { type: "done", committed: false, runId, needsUserDecision: false };
      return;
    }

    yield { type: "agent_phase", phase: "validating" };
    yield { type: "agent_progress", runId, phase: "validating", label: "验证结果", status: "running" };
    const changes = plan.steps;
    const report = await validateStagedChanges(
      { handle: deps.handle, model: deps.auditModel },
      changes,
      input.message,
    );
    yield { type: "agent_progress", runId, phase: "validating", label: "验证结果", status: report.commitAllowed ? "done" : "error" };
    yield { type: "validation_report", verdict: report.verdict, issues: report.issues as any[], commitAllowed: report.commitAllowed };

    if (report.verdict === "pass" && report.commitAllowed) {
      if (requiresUserConfirmation(runId, input, changes)) {
        yield { type: "agent_phase", phase: "waiting_user" };
        yield { type: "done", committed: false, runId, needsUserDecision: true };
        return;
      }
      const commit = deps.staging.commit(runId, deps.handle);
      if (commit.failed.length > 0) {
        yield {
          type: "error",
          errorClass: "commit_failed",
          message: commit.failed.map((f) => f.error).join("; ") || "commit failed",
        };
        yield { type: "agent_phase", phase: "waiting_user" };
        yield { type: "done", committed: false, runId, needsUserDecision: true };
        return;
      }
      yield { type: "agent_phase", phase: "completed" };
      yield { type: "done", committed: true, runId, needsUserDecision: false };
      return;
    }

    if (report.verdict === "repairable" && input.executionMode !== "trusted_auto") {
      yield { type: "agent_phase", phase: "waiting_user" };
      yield { type: "done", committed: false, needsUserDecision: true, runId };
      return;
    }

    if (report.verdict !== "repairable") {
      yield { type: "agent_phase", phase: "waiting_user" };
      yield { type: "done", committed: false, needsUserDecision: true, runId };
      return;
    }

    yield { type: "agent_phase", phase: "repairing" };
    yield { type: "agent_progress", runId, phase: "repairing", label: "修复计划", status: "running" };
    const repaired = await runRepair(report, plan, ["0"]);
    deps.staging.replace(runId, repaired.repairedPlan.steps);
    yield { type: "agent_progress", runId, phase: "repairing", label: "修复计划", status: "done", detail: repaired.summary };
    yield { type: "repair_plan", steps: repaired.repairedPlan.steps as any[], summary: repaired.summary };

    yield { type: "agent_phase", phase: "validating" };
    const rerun = await validateStagedChanges(
      { handle: deps.handle, model: deps.auditModel },
      repaired.repairedPlan.steps,
      input.message,
    );
    yield { type: "validation_report", verdict: rerun.verdict, issues: rerun.issues as any[], commitAllowed: rerun.commitAllowed };

    if (rerun.commitAllowed) {
      if (requiresUserConfirmation(runId, input, repaired.repairedPlan.steps)) {
        yield { type: "agent_phase", phase: "waiting_user" };
        yield { type: "done", committed: false, needsUserDecision: true, runId };
        return;
      }
      const commit = deps.staging.commit(runId, deps.handle);
      if (commit.failed.length > 0) {
        yield {
          type: "error",
          errorClass: "commit_failed",
          message: commit.failed.map((f) => f.error).join("; ") || "commit failed",
        };
        yield { type: "agent_phase", phase: "waiting_user" };
        yield { type: "done", committed: false, runId, needsUserDecision: true };
        return;
      }
      yield { type: "agent_phase", phase: "completed" };
      yield { type: "done", committed: true, runId, needsUserDecision: false };
      return;
    }

    yield { type: "agent_phase", phase: "waiting_user" };
    yield { type: "done", committed: false, needsUserDecision: true, runId };
  } catch (error) {
    yield {
      type: "error",
      errorClass: "workflow_failed",
      message: error instanceof Error ? error.message : String(error),
    };
    yield { type: "agent_phase", phase: "waiting_user" };
    yield { type: "done", committed: false, needsUserDecision: true, runId };
  }
}

function requiresUserConfirmation(
  runId: string,
  input: Pick<AgentRunRequest, "executionMode">,
  changes: Array<{ type: string }>,
): boolean {
  const policy = buildExecutionPolicy({
    taskId: runId,
    configuredMode: input.executionMode,
    actions: changes.map((change) => ({ type: change.type })),
  });
  return policy.requiresConfirmation || policy.effectiveMode === "blocked";
}

function buildMainAgentBookContext(handle: BookHandle, targetChapterNo?: number): string {
  const snapshot = loadBookSnapshot(
    handle.bookId,
    {
      charactersRepo: handle.charactersRepo,
      outlineRepo: handle.outlineRepo,
      foreshadowingRepo: handle.foreshadowingRepo,
      chaptersRepo: handle.chaptersRepo,
      chapterFiles: handle.chapterFiles,
      genreSectionsRepo: handle.genreSectionsRepo,
      worldbookRepo: handle.worldbookRepo,
      promptPresetsRepo: handle.promptPresetsRepo,
      readerIssuesRepo: handle.readerIssuesRepo,
      bookMetaRepo: handle.bookMetaRepo,
    },
    { rulesMd: handle.rulesMdPath },
  );

  const parts: string[] = [];
  parts.push(`## 基础信息\n标题: ${snapshot.meta.title || "未命名作品"}${snapshot.meta.genre ? `\n题材: ${snapshot.meta.genre}` : ""}${snapshot.meta.tone ? `\n基调: ${snapshot.meta.tone}` : ""}`);

  if (snapshot.characters.length) {
    parts.push([
      "## 角色资产",
      ...snapshot.characters.slice(0, 30).map((character) =>
        `- ${character.name} (${character.role}): ${JSON.stringify({
          baseData: character.baseData,
          currentState: character.currentState,
        })}`,
      ),
    ].join("\n"));
  }

  const targetOutline = targetChapterNo
    ? snapshot.outline.find((node) =>
      node.level === "chapter" && node.sortOrder === targetChapterNo)
    : undefined;
  if (targetOutline) {
    parts.push([
      "## 目标章节精确大纲",
      `标题: ${targetOutline.title}`,
      targetOutline.summary ? `本章必须写: ${targetOutline.summary}` : "",
      targetOutline.metadata ? `metadata: ${JSON.stringify(targetOutline.metadata)}` : "",
    ].filter(Boolean).join("\n"));
  }

  if (snapshot.recentFullChapters.length) {
    parts.push([
      "## 最近 10 章全文",
      ...snapshot.recentFullChapters.map((chapter) =>
        `### 第 ${chapter.chapterNo} 章 ${chapter.title}\n${chapter.content}`,
      ),
    ].join("\n\n"));
  }

  if (snapshot.midRangeSummaries.length) {
    parts.push([
      "## 前 11-20 章摘要",
      ...snapshot.midRangeSummaries.map((summary) =>
        `- 第 ${summary.chapterNo} 章 ${summary.oneLiner}\n  ${summary.paragraph}`,
      ),
    ].join("\n"));
  }

  const recent = new Set(snapshot.recentSummaries.map((summary) => summary.chapterNo));
  const mid = new Set(snapshot.midRangeSummaries.map((summary) => summary.chapterNo));
  const older = snapshot.allSummaries.filter((summary) =>
    !recent.has(summary.chapterNo) && !mid.has(summary.chapterNo)
  );
  if (older.length) {
    parts.push([
      "## 更早章节总览",
      ...older.map((summary) =>
        `- 第 ${summary.chapterNo} 章 ${summary.oneLiner}`,
      ),
    ].join("\n"));
  }

  if (snapshot.activeForeshadowing.length) {
    parts.push([
      "## 活跃伏笔",
      ...snapshot.activeForeshadowing.map((item) => `- ${item.label}: ${item.description}`),
    ].join("\n"));
  }

  return parts.join("\n\n");
}
