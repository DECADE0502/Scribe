import { streamLlm } from "../llm-call.js";
import type { TaskContext, TaskDef, TaskStreamEvent } from "./types.js";

export interface ReviseParsed {
  chapterNo: number;
  mergedContent: string;
  newSegment: string;
  originalSegment: string;
  title: string;
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

      // 优先按 start/end 精确定位:同一段落在章内重复出现时(如"她笑了。"这种短句),
      // 单纯 indexOf 会命中第一处,与用户在 UI 里实际选中的位置错位。
      // start/end 命中即用;若坐标越界 / 内容不吻合(如用户选中后章节又被改过),
      // fall through 到 indexOf 兜底,而不是直接 selection_missing。
      let idx = -1;
      if (typeof range.start === "number" && typeof range.end === "number") {
        if (file.content.slice(range.start, range.end) === range.selectedText) {
          idx = range.start;
        }
      }
      if (idx < 0) {
        idx = file.content.indexOf(range.selectedText);
      }
      if (idx < 0) throw new Error("selection_missing");

      const newSegment = streamedText.trim();
      // 空输出 = 用户选段被静默删除,是数据破坏而非"改写"。宁可失败让上层重试。
      if (!newSegment) throw new Error("empty_revision");

      const mergedContent = file.content.slice(0, idx) + newSegment + file.content.slice(idx + range.selectedText.length);
      // 读原章标题(chapterFiles.read 返回 ChapterRecord.title),
      // 避免 apply() 硬编码 `第 N 章` 覆盖用户已改过的标题。
      // 冷启动/首版章节 title 可能为空字符串,退回默认命名。
      const title = file.title && file.title.length > 0 ? file.title : `第 ${range.chapterNo} 章`;

      return {
        chapterNo: range.chapterNo,
        mergedContent,
        newSegment,
        originalSegment: range.selectedText,
        title,
      };
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
          title: parsed.title, versionNo: versionNo!,
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
