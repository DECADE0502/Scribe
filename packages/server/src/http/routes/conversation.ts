import { Hono } from "hono";
import type { LanguageModel } from "ai";
import type { ModelInfo } from "@scribe/shared";
import { streamSseResponse } from "../sse.js";
import { runEcho } from "../../ai/orchestrator/chat.js";
import { runConversation } from "../../ai/orchestrator/conversation-orchestrator.js";
import type { BookRegistry } from "../book-registry.js";

export interface ConversationDeps {
  getModel?: () => LanguageModel | undefined;
  getAuditModel?: () => LanguageModel | undefined;
  registry?: BookRegistry;
  auditModelInfo?: ModelInfo;
  onChapterCommitted?: (bookId: string) => void;
}

export function conversationRoutes(deps: ConversationDeps = {}) {
  const app = new Hono();
  app.post("/api/books/:bookId/conversation", async (c) => {
    const bookId = c.req.param("bookId");
    const body = await c.req.json().catch(() => ({}));
    const message = String((body as { message?: unknown })?.message ?? "");
    if (!message) return c.json({ error: "message 不能为空" }, 400);
    const mode = c.req.query("mode") ?? "echo";
    const model = deps.getModel?.();

    // 真实对话:意图识别 + 斜杠命令路由(spec §7.3 / §7.4)
    if (mode === "chat" && model && deps.registry) {
      const auditModel = deps.getAuditModel?.() ?? model;
      const handle = deps.registry.open(bookId);
      const inner = runConversation(
        {
          handle,
          model,
          auditModel,
          auditModelId: deps.auditModelInfo?.id ?? "unknown",
          abortSignal: c.req.raw.signal,
        },
        { message },
      );
      // 对话持久化 + 章节提交回调(写章成功后触发自动快照计数)
      async function* persisting() {
        handle.conversationsRepo.append({ role: "user", content: message, metadata: { kind: "chat" } });
        let buf = "";
        let wroteChapter = false;
        for await (const ev of inner) {
          if (ev.type === "text_delta") buf += ev.delta;
          if (ev.type === "tool_call_end" && ev.toolName === "record_chapter_state") wroteChapter = true;
          if (ev.type === "done") {
            if (buf.trim()) {
              handle.conversationsRepo.append({ role: "assistant", content: buf, metadata: { kind: "chat" } });
            }
            if (wroteChapter) deps.onChapterCommitted?.(bookId);
          }
          yield ev;
        }
      }
      return streamSseResponse(persisting());
    }

    return streamSseResponse(runEcho({ message }));
  });
  return app;
}
