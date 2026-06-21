BASE: 4219680
HEAD: 5d8832c

## Commits
5d8832c feat(server): accept conversation execution mode

## Stat
 .../ai/orchestrator/conversation-orchestrator.ts   |  6 +++++-
 packages/server/src/http/routes/conversation.ts    |  9 +++++++--
 .../tests/integration/chat-streaming.test.ts       | 22 ++++++++++++++++++++++
 3 files changed, 34 insertions(+), 3 deletions(-)

## Diff
diff --git a/packages/server/src/ai/orchestrator/conversation-orchestrator.ts b/packages/server/src/ai/orchestrator/conversation-orchestrator.ts
index 30787be..02d7abc 100644
--- a/packages/server/src/ai/orchestrator/conversation-orchestrator.ts
+++ b/packages/server/src/ai/orchestrator/conversation-orchestrator.ts
@@ -1,12 +1,12 @@
 import type { CoreMessage, LanguageModel } from "ai";
-import type { SseEvent } from "@scribe/shared";
+import type { ExecutionMode, SseEvent } from "@scribe/shared";
 import { parseSlashCommand, SLASH_COMMANDS } from "@scribe/shared";
 import type { BookHandle } from "../../http/book-registry.js";
 import { streamLlm } from "../llm-call.js";
 import { prependDeepestPrompt } from "../prompts/deepest-prompt.js";
 import { writeWithAudit } from "./write-with-audit.js";
 import { auditChapter } from "./audit-chapter.js";
 import { persistAuditResult } from "./audit-persist.js";
 import { recordChapterState, buildArchiveSummary } from "./record-state.js";
 import { recallChapters } from "../context-builder/recall.js";
 import {
@@ -93,20 +93,21 @@ export interface ConversationOrchestratorDeps {
   auditModel: LanguageModel;
   auditModelId: string;
   abortSignal?: AbortSignal;
   /** 用户最深处提示词,原文拼到最前端 */
   deepestPrompt?: string;
 }

 export interface ConversationInput {
   message: string;
   history?: CoreMessage[];
+  executionMode?: ExecutionMode;
 }

 const CHAT_SYSTEM = `你是 Scribe，一个对话式中文长篇小说创作助手。你能看到这本书的设定、角色、大纲、伏笔、时间线和已有章节。

 你的职责是理解用户的创作需求，然后直接调用工具执行操作，不要只口头描述。

 你有完整的工具库，可以：
 - 查看和修改书的设定（前提/调性/题材/书名）：update_book_meta
 - 查看和修改大纲：list_outline / add_outline_node / update_outline_node / delete_outline_node
 - 查看和管理角色：list_characters / create_character / update_character / delete_character
@@ -398,20 +399,23 @@ async function* auditFlow(
 /**
  * 对话总入口(spec §7.3 意图识别 + §7.4 斜杠命令路由)。
  * 1) 斜杠命令 → command_explicit,确定性分派
  * 2) 自然语言 → 意图分类 → 分派
  * 每一步先 yield 一个 intent 事件,前端可展示"识别到的意图"。
  */
 export async function* runConversation(
   deps: ConversationOrchestratorDeps,
   input: ConversationInput,
 ): AsyncIterable<SseEvent> {
+  const executionMode = input.executionMode ?? "low_risk_auto";
+  yield { type: "workflow_mode", mode: executionMode };
+
   const parsed = parseSlashCommand(input.message);

   if (parsed.kind === "command") {
     yield { type: "intent", category: "command_explicit", command: parsed.id };
     const maxNo = deps.handle.chaptersRepo.maxChapterNo();
     switch (parsed.id) {
       case "write":
         yield* writeChapterFlow(deps, maxNo + 1, parsed.args);
         yield { type: "done" };
         return;
diff --git a/packages/server/src/http/routes/conversation.ts b/packages/server/src/http/routes/conversation.ts
index 6d37ca2..1cdc08f 100644
--- a/packages/server/src/http/routes/conversation.ts
+++ b/packages/server/src/http/routes/conversation.ts
@@ -1,13 +1,13 @@
 import { Hono } from "hono";
 import type { LanguageModel } from "ai";
-import type { ModelInfo } from "@scribe/shared";
+import { ExecutionModeSchema, type ModelInfo } from "@scribe/shared";
 import { streamSseResponse } from "../sse.js";
 import { runEcho } from "../../ai/orchestrator/chat.js";
 import { runConversation } from "../../ai/orchestrator/conversation-orchestrator.js";
 import { resolveDeepestPrompt } from "../../ai/prompts/deepest-prompt.js";
 import type { BookRegistry } from "../book-registry.js";

 export interface ConversationDeps {
   getModel?: () => LanguageModel | undefined;
   getAuditModel?: () => LanguageModel | undefined;
   registry?: BookRegistry;
@@ -27,20 +27,25 @@ export function conversationRoutes(deps: ConversationDeps = {}) {
     const handle = deps.registry.open(bookId);
     const rows = handle.conversationsRepo.listLatest(limit).reverse();
     return c.json({ messages: rows });
   });

   app.post("/api/books/:bookId/conversation", async (c) => {
     const bookId = c.req.param("bookId");
     const body = await c.req.json().catch(() => ({}));
     const message = String((body as { message?: unknown })?.message ?? "");
     if (!message) return c.json({ error: "message 不能为空" }, 400);
+    const executionModeResult = ExecutionModeSchema.optional().safeParse(
+      (body as { executionMode?: unknown })?.executionMode,
+    );
+    if (!executionModeResult.success) return c.json({ error: "executionMode invalid" }, 400);
+    const executionMode = executionModeResult.data;
     const mode = c.req.query("mode") ?? "echo";
     const model = deps.getModel?.();

     // 真实对话:意图识别 + 斜杠命令路由(spec §7.3 / §7.4)
     if (mode === "chat" && model && deps.registry) {
       const auditModel = deps.getAuditModel?.() ?? model;
       const handle = deps.registry.open(bookId);
       // 多轮记忆:回放最近的 chat 历史(只取 chat,排除 note;不含当前这条)
       const history = handle.conversationsRepo
         .listLatest(12)
@@ -53,21 +58,21 @@ export function conversationRoutes(deps: ConversationDeps = {}) {
       });
       const inner = runConversation(
         {
           handle,
           model,
           auditModel,
           auditModelId: deps.auditModelInfo?.id ?? "unknown",
           abortSignal: c.req.raw.signal,
           deepestPrompt,
         },
-        { message, history },
+        { message, history, executionMode },
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
diff --git a/packages/server/tests/integration/chat-streaming.test.ts b/packages/server/tests/integration/chat-streaming.test.ts
index 9c8e131..11db300 100644
--- a/packages/server/tests/integration/chat-streaming.test.ts
+++ b/packages/server/tests/integration/chat-streaming.test.ts
@@ -94,20 +94,42 @@ describe("runChat 流式", () => {
     expect(text).toContain("event: text_delta");
     expect(text).toContain('"delta":"你"');
     expect(text).toContain('"delta":"好"');
     expect(text).toContain("event: usage");
     expect(text).toContain("event: done");
     expect(text).not.toContain("[echo]");
     registry.closeAll();
     fs.rmSync(tmp, { recursive: true, force: true });
   });

+  it("accepts executionMode and emits workflow_mode over SSE", async () => {
+    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scribe-chat-"));
+    const paths = makePaths(tmp);
+    fs.mkdirSync(paths.booksDir, { recursive: true });
+    const registry = createBookRegistry({ paths });
+    const app = createApp({ getModel: () => makeStubModel(["ok"]), bookRegistry: registry });
+
+    const res = await app.request("/api/books/b1/conversation?mode=chat", {
+      method: "POST",
+      headers: { "Content-Type": "application/json" },
+      body: JSON.stringify({ message: "hello", executionMode: "plan_only" }),
+    });
+    const text = await new Response(res.body).text();
+
+    expect(res.status).toBe(200);
+    expect(text).toContain("event: workflow_mode");
+    expect(text).toContain('"mode":"plan_only"');
+
+    registry.closeAll();
+    fs.rmSync(tmp, { recursive: true, force: true });
+  });
+
   it("无 model 注入或 mode=echo 时走回声", async () => {
     const app = createApp();
     const res = await app.request("/api/books/b1/conversation", {
       method: "POST",
       headers: { "Content-Type": "application/json" },
       body: JSON.stringify({ message: "你好" }),
     });
     const text = await new Response(res.body).text();
     expect(text).toContain("[echo]");
   });
