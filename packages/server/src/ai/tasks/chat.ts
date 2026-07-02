import { streamLlm } from "../llm-call.js";
import type { TaskContext, TaskDef, TaskStreamEvent } from "./types.js";

export interface ChatParsed { reply: string; }

interface ChatDeps {
  streamReply?: (ctx: TaskContext) => AsyncIterable<string>;
}

function makeTask(deps: ChatDeps = {}): TaskDef<ChatParsed> & { withDeps: (d: ChatDeps) => TaskDef<ChatParsed> } {
  const streamReply = deps.streamReply ?? defaultStreamReply;
  const task: TaskDef<ChatParsed> & { withDeps: (d: ChatDeps) => TaskDef<ChatParsed> } = {
    name: "chat",
    // 纯对话不写库:done.committed=false,前端不弹"已提交",不触发快照调度。
    mutates: false,
    async *stream(ctx): AsyncIterable<TaskStreamEvent> {
      for await (const chunk of streamReply(ctx)) if (chunk) yield { type: "text_delta", delta: chunk };
    },
    async parse(_ctx, text) { return { reply: text.trim() }; },
    apply() { /* 纯对话无副作用:不碰 workspaceDb,不碰任何 repo */ },
    withDeps: (d) => makeTask(d),
  };
  return task;
}

async function* defaultStreamReply(ctx: TaskContext): AsyncIterable<string> {
  // bookMetaRepo 是 get(key)/set(key,value) 的 KV store，没有无参 get()
  // (见 packages/server/src/db/repositories/book-meta.ts，与 onboard.ts 同一套路)。
  const title = ctx.handle.bookMetaRepo?.get?.("title") ?? "";
  const premise = ctx.handle.bookMetaRepo?.get?.("premise") ?? "";
  const meta = title || premise ? { title, premise } : undefined;
  const summaries = (ctx.handle.chaptersRepo?.listSummaries?.() ?? []).slice(-3);
  const messages = [
    {
      role: "system" as const,
      content: [
        "你是小说写作助手,和作者对话。回答简洁,不要提供正文,不要产出 JSON。",
        meta ? `# 当前书\n标题:${meta.title}\n主题:${meta.premise}` : "",
        summaries.length ? `# 最近章节梗概\n${summaries.map((s: any) => `- 第${s.chapterNo}章:${s.oneLiner ?? s.paragraph ?? ""}`).join("\n")}` : "",
      ].filter(Boolean).join("\n\n"),
    },
    { role: "user" as const, content: ctx.request.message },
  ];
  for await (const ev of streamLlm({ model: ctx.writeModel, messages, abortSignal: ctx.abortSignal })) {
    if (ev.type === "text_delta") yield ev.delta;
    else if (ev.type === "usage") {
      ctx.onUsage?.({
        promptTokens: ev.promptTokens,
        completionTokens: ev.completionTokens,
        cachedTokens: ev.cachedTokens,
        reasoningTokens: ev.reasoningTokens,
        modelRole: "write",
      });
    }
  }
}

export const chatTask = makeTask();
