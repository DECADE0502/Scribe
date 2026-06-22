import { Hono } from "hono";
import type { LanguageModel } from "ai";
import { ExecutionModeSchema, type ModelInfo } from "@scribe/shared";
import { streamSseResponse } from "../sse.js";
import { runEcho } from "../../ai/orchestrator/chat.js";
import { runConversation } from "../../ai/orchestrator/conversation-orchestrator.js";
import { resolveDeepestPrompt } from "../../ai/prompts/deepest-prompt.js";
import { withUsageRecording } from "../../ai/usage-tracker.js";
import { holdBook, type BookRegistry } from "../book-registry.js";
import type { StyleReference } from "../../config/load.js";

export interface ConversationDeps {
  getModel?: () => LanguageModel | undefined;
  getAuditModel?: () => LanguageModel | undefined;
  registry?: BookRegistry;
  writeModelInfo?: ModelInfo;
  auditModelInfo?: ModelInfo;
  onChapterCommitted?: (bookId: string) => void;
  getMasterPrompt?: () => string;
  getStyleReferences?: () => StyleReference[];
}

export function conversationRoutes(deps: ConversationDeps = {}) {
  const app = new Hono();

  // 拉取持久化对话历史（前端启动 / 刷新页面时加载）
  app.get("/api/books/:bookId/conversation", async (c) => {
    if (!deps.registry) return c.json({ error: "服务未就绪" }, 503);
    const bookId = c.req.param("bookId");
    const limit = Number(c.req.query("limit") ?? 100);
    const handle = deps.registry.open(bookId);
    const rows = handle.conversationsRepo.listLatest(limit).reverse();
    return c.json({ messages: rows });
  });

  app.post("/api/books/:bookId/conversation", async (c) => {
    const bookId = c.req.param("bookId");
    const body = await c.req.json().catch(() => ({}));
    const message = String((body as { message?: unknown })?.message ?? "");
    if (!message) return c.json({ error: "message 不能为空" }, 400);
    const executionModeResult = ExecutionModeSchema.optional().safeParse(
      (body as { executionMode?: unknown })?.executionMode,
    );
    if (!executionModeResult.success) return c.json({ error: "executionMode invalid" }, 400);
    const executionMode = executionModeResult.data;
    const mode = c.req.query("mode") ?? "echo";
    const model = deps.getModel?.();

    // 真实对话:意图识别 + 斜杠命令路由(spec §7.3 / §7.4)
    if (mode === "chat" && model && deps.registry) {
      const auditModel = deps.getAuditModel?.() ?? model;
      const handle = deps.registry.open(bookId);
      const booksRepo = deps.registry.booksRepo;
      // 多轮记忆:回放最近的 chat 历史(只取 chat,排除 note;不含当前这条)
      const history = handle.conversationsRepo
        .listLatest(12)
        .filter((m) => (m.role === "user" || m.role === "assistant"))
        .reverse()
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
      const deepestPrompt = resolveDeepestPrompt({
        perBook: handle.bookMetaRepo.get("master_prompt"),
        perBookEnabled: handle.bookMetaRepo.get("master_prompt_enabled") !== "0",
        global: deps.getMasterPrompt?.() ?? "",
      });
      const inner = runConversation(
        {
          handle,
          model,
          auditModel,
          auditModelId: deps.auditModelInfo?.id ?? "unknown",
          abortSignal: c.req.raw.signal,
          deepestPrompt,
          styleReferences: deps.getStyleReferences?.() ?? [],
        },
        { message, history, executionMode },
      );
      // 全量计费:统一交给 withUsageRecording(按事件 modelRole/taskType 分类定价,
      // 缺 modelInfo 也记 token、费用为 0);不再在此手写,也不再因缺 writeModelInfo 而漏记。
      const tracked = withUsageRecording(inner, {
        tokenUsageRepo: handle.tokenUsageRepo,
        booksRepo,
        bookId,
        modelInfo: deps.writeModelInfo,
        auditModelInfo: deps.auditModelInfo,
        taskType: "chat",
      });
      // 对话持久化 + 章节提交回调(写章成功后触发自动快照计数)
      async function* persisting() {
        handle.conversationsRepo.append({ role: "user", content: message, metadata: { kind: "chat" } });
        let buf = "";
        let wroteChapter = false;
        for await (const ev of tracked) {
          if (ev.type === "text_delta") buf += ev.delta;
          if (ev.type === "tool_call_end" && ev.toolName === "chapter_write") {
            const result = ev.result as { success?: boolean } | undefined;
            if (result?.success !== false) wroteChapter = true;
          }
          if (ev.type === "tool_call_end" && ev.toolName === "record_chapter_state") wroteChapter = true;
          if (ev.type === "done") {
            // 写章流:整章正文已存为章节版本,聊天历史只留简短标记,避免把整章
            // 正文塞进 conversations(否则膨胀且会被回放成 history 再喂回模型)。
            if (wroteChapter) {
              handle.conversationsRepo.append({ role: "assistant", content: "(已完成写作并记录设定)", metadata: { kind: "chat" } });
              deps.onChapterCommitted?.(bookId);
            } else if (buf.trim()) {
              handle.conversationsRepo.append({ role: "assistant", content: buf, metadata: { kind: "chat" } });
            }
          }
          yield ev;
        }
      }
      return streamSseResponse(holdBook(deps.registry, bookId, persisting()));
    }

    return streamSseResponse(runEcho({ message }));
  });
  return app;
}
