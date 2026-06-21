import type { LanguageModel, CoreMessage } from "ai";
import {
  buildExecutionPolicy,
  classifyActionRisk,
  type ExecutionMode,
  type ExecutionStep,
  type SseEvent,
} from "@scribe/shared";
import { streamLlm } from "../llm-call.js";
import { NEW_BOOK_ONBOARD_PROMPT } from "../prompts/new-book-onboard.js";
import { prependDeepestPrompt } from "../prompts/deepest-prompt.js";
import { buildToolRegistry, type ToolRegistryDeps } from "../tools/registry.js";
import { createTaskId } from "./workflow-contract.js";

export interface NewBookOrchestratorDeps {
  model: LanguageModel;
  toolDeps: ToolRegistryDeps;
  abortSignal?: AbortSignal;
  maxSteps?: number;
  deepestPrompt?: string;
}

export interface NewBookInput {
  history?: CoreMessage[];
  message: string;
  completenessHint?: string;
  executionMode?: ExecutionMode;
}

export async function* runNewBookConversation(
  deps: NewBookOrchestratorDeps,
  input: NewBookInput,
): AsyncIterable<SseEvent> {
  const tools = buildToolRegistry(deps.toolDeps);
  const systemContent = input.completenessHint
    ? `${NEW_BOOK_ONBOARD_PROMPT}\n\n## 当前进度\n${input.completenessHint}`
    : NEW_BOOK_ONBOARD_PROMPT;
  const messages: CoreMessage[] = prependDeepestPrompt([
    { role: "system", content: systemContent },
    ...(input.history ?? []),
    { role: "user", content: input.message },
  ], deps.deepestPrompt);
  const executionMode = input.executionMode ?? "trusted_auto";
  const taskId = createTaskId("onboard");
  let stepNo = 0;
  const runningSteps = new Map<string, ExecutionStep>();
  const completedSteps: ExecutionStep[] = [];

  yield { type: "workflow_mode", mode: executionMode };

  for await (const ev of streamLlm({
    model: deps.model,
    messages,
    tools,
    maxSteps: deps.maxSteps ?? 8,
    abortSignal: deps.abortSignal,
  })) {
    if (ev.type === "tool_call_start") {
      stepNo += 1;
      const toolName = ev.toolName;
      const policy = buildExecutionPolicy({
        taskId,
        configuredMode: executionMode,
        actions: [{ type: toolName, riskHint: classifyActionRisk(toolName) }],
      });
      const step: ExecutionStep = {
        id: `step-${stepNo}`,
        actionType: toolName,
        riskLevel: policy.highestRisk,
        status: "running",
        toolName,
      };
      runningSteps.set(toolName, step);
      yield { type: "execution_step", taskId, step };
    }

    if (ev.type === "done") {
      const failed = completedSteps.some(step => step.status === "failed");
      yield {
        type: "acceptance_report",
        report: {
          taskId,
          verdict: failed ? "repairable" : "pass",
          userCriteria: [{
            criterion: "Onboard conversation completed",
            status: failed ? "fail" : "pass",
            evidence: failed ? "At least one onboard tool step failed." : "Onboard stream reached done.",
          }],
          processCriteria: [{
            criterion: "Workflow steps are visible",
            status: completedSteps.length > 0 ? "pass" : "unknown",
            evidence: completedSteps.length > 0
              ? `Tracked ${completedSteps.length} onboard tool step(s).`
              : "No tool step was needed for this turn.",
          }],
          domainCriteria: [],
          recommendedActions: failed
            ? [{ type: "auto_repair", reason: "Retry or revise failed onboard tool step." }]
            : [],
        },
      };
    }

    yield ev;

    if (ev.type === "tool_call_end") {
      const base = runningSteps.get(ev.toolName);
      if (base) {
        const result = ev.result as { success?: boolean; error?: string } | undefined;
        const succeeded = result?.success !== false && typeof result?.error !== "string";
        const step: ExecutionStep = {
          ...base,
          status: succeeded ? "succeeded" : "failed",
          resultSummary: succeeded ? `${ev.toolName} completed.` : `${ev.toolName} failed.`,
          verification: {
            method: "panel_refresh",
            passed: succeeded,
            detail: succeeded ? `${ev.toolName} completed.` : String(result?.error ?? `${ev.toolName} failed.`),
          },
        };
        completedSteps.push(step);
        runningSteps.delete(ev.toolName);
        yield { type: "execution_step", taskId, step };
      }
    }
  }
}
