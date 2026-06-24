import { Hono } from "hono";
import type { LanguageModel } from "ai";
import { AgentRunRequestSchema, type ModelInfo, type TaskType } from "@scribe/shared";
import { streamSseResponse } from "../sse.js";
import { holdBook, type BookRegistry } from "../book-registry.js";
import { runAgentWorkflow } from "../../ai/orchestrator/agent-runner.js";
import { createWorkflowStaging } from "../../ai/orchestrator/workflow-staging.js";
import { createWorkflowRunsRepo } from "../../db/repositories/workflow-runs.js";
import { withUsageRecording } from "../../ai/usage-tracker.js";
import { createConversationMessageService } from "../../ai/conversation-message-service.js";

export interface AgentRoutesDeps {
  registry: BookRegistry;
  getModel?: () => LanguageModel | undefined;
  getAuditModel?: () => LanguageModel | undefined;
  writeModelInfo?: ModelInfo;
  auditModelInfo?: ModelInfo;
  onChapterCommitted?: (bookId: string) => void;
}

export function agentRoutes(deps: AgentRoutesDeps) {
  const app = new Hono();

  app.post("/api/books/:bookId/agent/run", async (c) => {
    const bookId = c.req.param("bookId");
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const rawMessage = String(body.message ?? "").trim();
    const parsed = AgentRunRequestSchema.safeParse({
      message: rawMessage,
      source: body.source ?? "chat",
      executionMode: body.executionMode,
      target: body.target,
    });
    if (!parsed.success) return c.json({ error: "agent 请求无效", issues: parsed.error.issues }, 400);
    const { message, source, executionMode, target } = parsed.data;

    const model = deps.getModel?.();
    if (!model) return c.json({ error: "未配置模型" }, 503);

    const handle = deps.registry.open(bookId);
    const auditModel = deps.getAuditModel?.() ?? model;
    const wfRepo = createWorkflowRunsRepo(handle.workspaceDb);
    const staging = createWorkflowStaging(wfRepo);

    const inner = runAgentWorkflow(
      { handle, model, auditModel, staging, abortSignal: c.req.raw.signal },
      { message, source, executionMode, target },
    );
    const tracked = withUsageRecording(inner, {
      tokenUsageRepo: handle.tokenUsageRepo,
      booksRepo: deps.registry.booksRepo,
      bookId,
      modelInfo: deps.writeModelInfo,
      auditModelInfo: deps.auditModelInfo,
      taskType: taskTypeForSource(source),
      chapterNo: target?.chapterNo ?? null,
    });

    async function* persisting() {
      const messages = createConversationMessageService(handle.conversationsRepo);
      messages.recordUserVisible(message, { source, target });
      let assistantReply = "";

      for await (const ev of tracked) {
        if (ev.type === "main_output") assistantReply += ev.reply;
        if (ev.type === "done") {
          if (ev.committed) {
            messages.recordAgentProgressSummary("(已通过统一 Agent 管线完成变更)", {
              source,
              runId: ev.runId,
              target,
            });
            deps.onChapterCommitted?.(bookId);
          } else if (assistantReply.trim()) {
            messages.recordAssistantVisible(assistantReply, {
              source,
              runId: ev.runId,
              target,
            });
          }
        }
        yield ev;
      }
    }

    return streamSseResponse(holdBook(deps.registry, bookId, persisting()));
  });

  app.post("/api/books/:bookId/agent/runs/:runId/approve", async (c) => {
    const bookId = c.req.param("bookId");
    const runId = c.req.param("runId");
    const handle = deps.registry.open(bookId);
    const wfRepo = createWorkflowRunsRepo(handle.workspaceDb);
    const run = wfRepo.get(runId);
    if (!run || run.bookId !== bookId) return c.json({ error: "workflow_run_not_found" }, 404);
    if (run.phase === "completed") return c.json({ ok: true, committed: true, alreadyCommitted: true });

    const staging = createWorkflowStaging(wfRepo);
    const commit = staging.commit(runId, handle);
    if (commit.failed.length > 0) {
      return c.json({
        ok: false,
        error: "commit_failed",
        failed: commit.failed.map((item) => ({ id: item.change.id, error: item.error })),
      }, 500);
    }
    createConversationMessageService(handle.conversationsRepo).recordAgentProgressSummary(
      "(已通过统一 Agent 管线完成变更)",
      { source: run.source, runId },
    );
    deps.onChapterCommitted?.(bookId);
    return c.json({ ok: true, committed: commit.committed.length });
  });

  app.post("/api/books/:bookId/agent/runs/:runId/cancel", async (c) => {
    const bookId = c.req.param("bookId");
    const runId = c.req.param("runId");
    const handle = deps.registry.open(bookId);
    const wfRepo = createWorkflowRunsRepo(handle.workspaceDb);
    const run = wfRepo.get(runId);
    if (!run || run.bookId !== bookId) return c.json({ error: "workflow_run_not_found" }, 404);
    createWorkflowStaging(wfRepo).discard(runId);
    return c.json({ ok: true });
  });

  return app;
}

function taskTypeForSource(source: string): TaskType {
  if (source === "revision") return "segment_revise";
  if (source === "onboard") return "new_book";
  if (source === "auto" || source === "editor") return "write";
  if (source === "asset_audit") return "audit";
  return "chat";
}
