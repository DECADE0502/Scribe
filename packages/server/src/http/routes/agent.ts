import { Hono } from "hono";
import type { LanguageModel } from "ai";
import { streamSseResponse } from "../sse.js";
import { holdBook, type BookRegistry } from "../book-registry.js";
import { runAgentWorkflow } from "../../ai/orchestrator/agent-runner.js";
import { createWorkflowStaging } from "../../ai/orchestrator/workflow-staging.js";
import { createWorkflowRunsRepo } from "../../db/repositories/workflow-runs.js";

export interface AgentRoutesDeps {
  registry: BookRegistry;
  getModel?: () => LanguageModel | undefined;
  getAuditModel?: () => LanguageModel | undefined;
}

export function agentRoutes(deps: AgentRoutesDeps) {
  const app = new Hono();

  app.post("/api/books/:bookId/agent/run", async (c) => {
    const bookId = c.req.param("bookId");
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const message = String(body.message ?? "");
    const source = String(body.source ?? "chat");
    const executionMode = typeof body.executionMode === "string" ? body.executionMode : undefined;

    const model = deps.getModel?.();
    if (!model) return c.json({ error: "未配置模型" }, 503);

    const handle = deps.registry.open(bookId);
    const auditModel = deps.getAuditModel?.() ?? model;
    const wfRepo = createWorkflowRunsRepo(handle.workspaceDb);
    const staging = createWorkflowStaging(wfRepo);

    const stream = runAgentWorkflow(
      { handle, model, auditModel, staging },
      { message, source, executionMode },
    );
    return streamSseResponse(holdBook(deps.registry, bookId, stream));
  });

  return app;
}
