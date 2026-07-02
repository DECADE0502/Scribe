import { Hono } from "hono";
import type { LanguageModel } from "ai";
import { AgentRunRequestSchema, type AgentRunRequest, type ModelInfo, type TaskType } from "@scribe/shared";
import { streamSseResponse } from "../sse.js";
import { holdBook, type BookRegistry } from "../book-registry.js";
import { dispatchTask } from "../../ai/tasks/dispatch.js";
import { resolveTask as defaultResolveTask } from "../../ai/tasks/registry.js";
import type { TaskDef, TaskUsage } from "../../ai/tasks/types.js";
import { computeUsageCost } from "../../ai/usage-tracker.js";
import { createConversationMessageService } from "../../ai/conversation-message-service.js";
import { resolveDeepestPrompt } from "../../ai/prompts/deepest-prompt.js";
import type { StyleReference } from "../../config/load.js";

export interface AgentRoutesDeps {
  registry: BookRegistry;
  getModel?: () => LanguageModel | undefined;
  getAuditModel?: () => LanguageModel | undefined;
  writeModelInfo?: ModelInfo;
  auditModelInfo?: ModelInfo;
  onChapterCommitted?: (bookId: string) => void;
  /** 全局最深处提示词(书级 book_meta.master_prompt 覆盖它) */
  getMasterPrompt?: () => string;
  /** 全局文风参考列表 */
  getStyleReferences?: () => StyleReference[];
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
    const taskType = taskTypeForTask(task.name);
    const chapterNo = request.target?.chapterNo ?? request.target?.revisionRange?.chapterNo ?? null;

    // 用量记账:streamLlm 的 usage 事件在 task 内部被消费(不进 SSE 流),task 每完成一次
    // LLM 调用经 ctx.onUsage 上报到这里,按 modelRole 选价目表落库 + 累计书籍成本。
    const onUsage = (usage: TaskUsage) => {
      const modelInfo = usage.modelRole === "audit"
        ? (deps.auditModelInfo ?? deps.writeModelInfo)
        : deps.writeModelInfo;
      const cached = usage.cachedTokens ?? 0;
      const cost = modelInfo
        ? computeUsageCost(modelInfo, usage.promptTokens, usage.completionTokens, cached)
        : 0;
      handle.tokenUsageRepo.record({
        taskType,
        model: modelInfo?.id ?? "unknown",
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        cachedTokens: cached,
        reasoningTokens: usage.reasoningTokens ?? 0,
        costUsd: cost,
        chapterNo,
      });
      deps.registry.booksRepo.addCost(bookId, cost);
    };

    // 最深处提示词:书级覆盖(book_meta.master_prompt,显式开关 "0" 关闭)> 全局配置。
    // 解析一次,由各 task 的默认 LLM 调用统一 prepend。
    const deepestPrompt = resolveDeepestPrompt({
      perBook: handle.bookMetaRepo.get("master_prompt"),
      perBookEnabled: handle.bookMetaRepo.get("master_prompt_enabled") !== "0",
      global: deps.getMasterPrompt?.(),
    });

    const inner = dispatchTask(task, {
      handle,
      request,
      writeModel: model,
      auditModel,
      abortSignal: c.req.raw.signal,
      onUsage,
      deepestPrompt,
      styleReferences: deps.getStyleReferences?.() ?? [],
    });

    async function* persisting() {
      const messages = createConversationMessageService(handle.conversationsRepo);
      messages.recordUserVisible(request.message, { source: request.source, target: request.target });
      let assistantReply = "";
      // 章节类任务的"回复"就是正文本身,已落 chapters 表;对话表里只留简短进度说明,
      // 避免整章正文再存一份(conversations 表会随章节数线性膨胀)。
      const isChapterContent = task.name === "write-chapter" || task.name === "revise";

      for await (const ev of inner) {
        if (ev.type === "text_delta") assistantReply += ev.delta;
        if (ev.type === "done") {
          if (isChapterContent) {
            messages.recordAssistantVisible(
              task.name === "revise"
                ? `(已完成${chapterNo ? `第 ${chapterNo} 章` : ""}选段改写,新段 ${assistantReply.length} 字)`
                : `(已生成${chapterNo ? `第 ${chapterNo} 章` : "章节"}正文,共 ${assistantReply.length} 字)`,
              { source: request.source, target: request.target },
            );
          } else if (assistantReply.trim()) {
            messages.recordAssistantVisible(assistantReply, { source: request.source, target: request.target });
          }
          // onChapterCommitted 的语义是"章节内容变更"(标脏 + 快照调度),
          // 只对章节任务触发;onboard/audit 虽落库但不动章节,chat 完全无副作用。
          if (ev.committed && isChapterContent) deps.onChapterCommitted?.(bookId);
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
