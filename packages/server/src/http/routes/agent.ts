import { Hono } from "hono";
import type { LanguageModel } from "ai";
import { AgentRunRequestSchema, type AgentRunRequest, type ModelInfo, type TaskType } from "@scribe/shared";
import { streamSseResponse } from "../sse.js";
import { holdBook, type BookRegistry } from "../book-registry.js";
import { dispatchTask } from "../../ai/tasks/dispatch.js";
import { resolveTask as defaultResolveTask } from "../../ai/tasks/registry.js";
import type { TaskDef } from "../../ai/tasks/types.js";
import { withUsageRecording } from "../../ai/usage-tracker.js";
import { createConversationMessageService } from "../../ai/conversation-message-service.js";

export interface AgentRoutesDeps {
  registry: BookRegistry;
  getModel?: () => LanguageModel | undefined;
  getAuditModel?: () => LanguageModel | undefined;
  writeModelInfo?: ModelInfo;
  auditModelInfo?: ModelInfo;
  onChapterCommitted?: (bookId: string) => void;
  /** 测试注入:跳过真实 source→task 映射,直接指定任务实现 */
  resolveTask?: (request: AgentRunRequest) => TaskDef<any>;
}

/**
 * 薄任务分派路由:唯一职责是 —— 校验请求 → 挑一个 TaskDef → dispatchTask 跑
 * stream/parse/apply → 记账 → 转存对话 → holdBook 包一层互斥保护 → SSE 转发。
 * 不再有 4-agent 编排、staging/approve/cancel 这些概念(architecture 见
 * docs/superpowers/plans/2026-07-02-simplify-to-task-dispatcher.md)。
 */
export function agentRoutes(deps: AgentRoutesDeps) {
  const app = new Hono();
  const resolveTask = deps.resolveTask ?? defaultResolveTask;

  app.post("/api/books/:bookId/agent/run", async (c) => {
    const bookId = c.req.param("bookId");
    const book = deps.registry.booksRepo.get(bookId);
    if (!book) return c.json({ error: "book_not_found" }, 404);

    const parsed = AgentRunRequestSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "bad_request", detail: parsed.error.message }, 400);
    const request = parsed.data;

    const model = deps.getModel?.();
    if (!model) return c.json({ error: "未配置模型" }, 503);
    const auditModel = deps.getAuditModel?.() ?? model;

    const handle = deps.registry.open(bookId);
    const task = resolveTask(request);

    const inner = dispatchTask(task, {
      handle,
      request,
      writeModel: model,
      auditModel,
      abortSignal: c.req.raw.signal,
    });
    const tracked = withUsageRecording(inner, {
      tokenUsageRepo: handle.tokenUsageRepo,
      booksRepo: deps.registry.booksRepo,
      bookId,
      modelInfo: deps.writeModelInfo,
      auditModelInfo: deps.auditModelInfo,
      taskType: taskTypeForTask(task.name),
      chapterNo: request.target?.chapterNo ?? null,
    });

    async function* persisting() {
      const messages = createConversationMessageService(handle.conversationsRepo);
      messages.recordUserVisible(request.message, { source: request.source, target: request.target });
      let assistantReply = "";

      for await (const ev of tracked) {
        if (ev.type === "text_delta") assistantReply += ev.delta;
        if (ev.type === "done") {
          if (assistantReply.trim()) {
            messages.recordAssistantVisible(assistantReply, { source: request.source, target: request.target });
          }
          if (ev.committed) deps.onChapterCommitted?.(bookId);
        }
        yield ev;
      }
    }

    return streamSseResponse(holdBook(deps.registry, bookId, persisting()));
  });

  return app;
}

function taskTypeForTask(name: string): TaskType {
  if (name === "write-chapter") return "write";
  if (name === "audit") return "audit";
  if (name === "revise") return "revise";
  if (name === "onboard") return "onboard";
  return "chat";
}
