import { streamLlm } from "../llm-call.js";
import type { TaskContext, TaskDef, TaskStreamEvent } from "./types.js";

export interface ReviseParsed {
  chapterNo: number;
  mergedContent: string;
  newSegment: string;
  originalSegment: string;
}

interface ReviseDeps {
  streamRevised?: (ctx: TaskContext) => AsyncIterable<string>;
}

function makeTask(deps: ReviseDeps = {}): TaskDef<ReviseParsed> & { withDeps: (d: ReviseDeps) => TaskDef<ReviseParsed> } {
  const streamRevised = deps.streamRevised ?? defaultStreamRevised;
  const task: TaskDef<ReviseParsed> & { withDeps: (d: ReviseDeps) => TaskDef<ReviseParsed> } = {
    name: "revise",
    async *stream(ctx): AsyncIterable<TaskStreamEvent> {
      for await (const chunk of streamRevised(ctx)) if (chunk) yield { type: "text_delta", delta: chunk };
    },
    async parse(ctx, streamedText) {
      const range = ctx.request.target?.revisionRange;
      if (!range?.chapterNo || !range.selectedText) throw new Error("bad_revision_range");
      const file = ctx.handle.chapterFiles.read(range.chapterNo);
      if (!file) throw new Error(`chapter_missing:${range.chapterNo}`);
      const idx = file.content.indexOf(range.selectedText);
      if (idx < 0) throw new Error("selection_missing");
      const newSegment = streamedText.trim();
      const mergedContent = file.content.slice(0, idx) + newSegment + file.content.slice(idx + range.selectedText.length);
      return { chapterNo: range.chapterNo, mergedContent, newSegment, originalSegment: range.selectedText };
    },
    apply(ctx, parsed) {
      const { handle } = ctx;
      let versionNo: number | undefined;
      const runDb = handle.workspaceDb.transaction(() => {
        const saved = handle.chaptersRepo.saveVersion({
          chapterNo: parsed.chapterNo, source: "segment_revise", contentMd: parsed.mergedContent,
        });
        versionNo = saved.versionNo;
      });
      runDb();
      try {
        handle.chapterFiles.save({
          chapterNo: parsed.chapterNo, content: parsed.mergedContent,
          title: `第 ${parsed.chapterNo} 章`, versionNo: versionNo!,
        });
      } catch (e) {
        try { handle.chaptersRepo.deleteVersion(parsed.chapterNo, versionNo!); } catch { /* rollback best-effort */ }
        throw e;
      }
    },
    withDeps: (d) => makeTask(d),
  };
  return task;
}

async function* defaultStreamRevised(ctx: TaskContext): AsyncIterable<string> {
  const range = ctx.request.target?.revisionRange;
  if (!range?.chapterNo || !range.selectedText) throw new Error("bad_revision_range");
  const messages = [
    {
      role: "system" as const,
      content: [
        "你是一名小说润色作者。",
        "只重写用户选中的段落,保持人称/时态/角色一致,输出只含新段落纯文本(无引导语,无标点包裹)。",
      ].join("\n"),
    },
    {
      role: "user" as const,
      content: [
        `# 第 ${range.chapterNo} 章原选段`,
        range.selectedText,
        "",
        `# 修改指令`,
        ctx.request.message,
      ].join("\n"),
    },
  ];
  for await (const ev of streamLlm({ model: ctx.writeModel, messages, abortSignal: ctx.abortSignal })) {
    if (ev.type === "text_delta") yield ev.delta;
  }
}

export const reviseTask = makeTask();
