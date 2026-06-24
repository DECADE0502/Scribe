import { randomUUID } from "node:crypto";
import type { SseEvent } from "@scribe/shared";
import type { BookHandle } from "../../http/book-registry.js";
import { analyzeIntent } from "./main-agent.js";
import { runExecutor } from "./executor-agent.js";
import { validateStagedChanges } from "./validator-agent.js";
import { runRepair } from "./repair-agent.js";
import type { WorkflowStaging } from "./workflow-staging.js";

export interface AgentRunnerDeps {
  handle: BookHandle;
  model: unknown;
  auditModel: unknown;
  staging: WorkflowStaging;
  abortSignal?: AbortSignal;
}

export async function* runAgentWorkflow(
  deps: AgentRunnerDeps,
  input: { message: string; source: string; executionMode?: string },
): AsyncIterable<SseEvent> {
  const runId = randomUUID();
  deps.staging.begin(runId, { bookId: deps.handle.bookId, source: input.source });

  // 1 Thinking
  yield { type: "agent_phase", phase: "thinking" };
  const main = await analyzeIntent({ model: deps.model }, input.message);
  yield { type: "main_output", reply: main.reply, draft: main.draft };

  // 2 Executing
  yield { type: "agent_phase", phase: "executing" };
  const plan = await runExecutor(
    { model: deps.model, handle: deps.handle },
    main.taskContract,
  );
  for (const step of plan.steps) {
    deps.staging.add(runId, step);
  }
  yield { type: "execution_plan", steps: plan.steps as any[], summary: plan.summary };

  // 3 Validating
  yield { type: "agent_phase", phase: "validating" };
  const changes = plan.steps;
  const report = await validateStagedChanges(
    { handle: deps.handle, model: deps.auditModel },
    changes,
    input.message,
  );
  yield { type: "validation_report", verdict: report.verdict, issues: report.issues as any[], commitAllowed: report.commitAllowed };

  // 4 Terminal
  if (report.verdict === "pass" && report.commitAllowed) {
    deps.staging.commit(runId, deps.handle);
    yield { type: "agent_phase", phase: "completed" };
    yield { type: "done", committed: true, runId, needsUserDecision: false };
    return;
  }

  if (report.verdict === "repairable" && input.executionMode !== "trusted_auto") {
    yield { type: "agent_phase", phase: "waiting_user" };
    yield { type: "done", committed: false, needsUserDecision: true, runId };
    return;
  }

  // auto-repair 1 time
  yield { type: "agent_phase", phase: "repairing" };
  const repaired = await runRepair(report, plan, ["0"]);
  yield { type: "repair_plan", steps: repaired.repairedPlan.steps as any[], summary: repaired.summary };

  // re-validate
  yield { type: "agent_phase", phase: "validating" };
  const rerun = await validateStagedChanges(
    { handle: deps.handle, model: deps.auditModel },
    repaired.repairedPlan.steps,
    input.message,
  );
  yield { type: "validation_report", verdict: rerun.verdict, issues: rerun.issues as any[], commitAllowed: rerun.commitAllowed };

  if (rerun.commitAllowed) {
    deps.staging.commit(runId, deps.handle);
    yield { type: "agent_phase", phase: "completed" };
    yield { type: "done", committed: true, runId, needsUserDecision: false };
    return;
  }

  yield { type: "agent_phase", phase: "waiting_user" };
  yield { type: "done", committed: false, needsUserDecision: true, runId };
}
