import type { LanguageModel } from "ai";
import type { SseEvent } from "@scribe/shared";
import { streamLlm } from "../llm-call.js";
import { SYSTEM_PROMPT } from "../prompts/system-prompt.js";
import {
  buildWriteChapterPrompt,
  type WriteChapterContext,
} from "../prompts/write-chapter.js";

export interface ChapterFilesLike {
  save(input: {
    chapterNo: number;
    title: string;
    content: string;
    versionNo: number;
  }): void;
}

export interface ChaptersRepoLike {
  saveVersion(input: {
    chapterNo: number;
    source: "ai_write" | "ai_rewrite" | "user_edit" | "segment_revise";
    contentMd: string;
  }): { versionNo: number };
  deleteVersion(chapterNo: number, versionNo: number): void;
}

export interface WriteChapterDeps {
  model: LanguageModel;
  chaptersRepo: ChaptersRepoLike;
  chapterFiles: ChapterFilesLike;
}

export interface WriteChapterInput {
  chapterNo: number;
  userIntent: string;
  ctx?: Partial<WriteChapterContext>;
  abortSignal?: AbortSignal;
}

export async function* writeChapterSimple(
  deps: WriteChapterDeps,
  input: WriteChapterInput,
): AsyncIterable<SseEvent> {
  const userPrompt = buildWriteChapterPrompt({
    chapterNo: input.chapterNo,
    userIntent: input.userIntent,
    ...input.ctx,
  });
  const messages = [
    { role: "system" as const, content: SYSTEM_PROMPT },
    { role: "user" as const, content: userPrompt },
  ];
  let buffer = "";
  for await (const ev of streamLlm({
    model: deps.model,
    messages,
    abortSignal: input.abortSignal,
  })) {
    if (ev.type === "text_delta") buffer += ev.delta;
    if (ev.type === "done") {
      // 在 yield done 之前落盘,确保 SSE 终结事件契约:
      // - 落盘成功:正常 yield done(消费者据此 break)
      // - 落盘失败:yield error 替代 done,避免 done 之后再追 error
      //   破坏"done 是终结事件"的协议;同时早 return 不再 yield 后续事件。
      // 错误路径(LLM 直接 yield error)天然不会进入此分支,buffer 不落盘。
      // 原子性:DB 与文件双写,任意一侧失败都需要保持外部观察一致 ——
      // saveVersion 失败不会写文件;chapterFiles.save 失败需回滚已写入的
      // version 行,避免留下"DB 有 version、磁盘无 .md"的半成品。
      if (buffer.trim()) {
        let saved: { versionNo: number } | undefined;
        try {
          saved = deps.chaptersRepo.saveVersion({
            chapterNo: input.chapterNo,
            source: "ai_write",
            contentMd: buffer,
          });
          deps.chapterFiles.save({
            chapterNo: input.chapterNo,
            title: `第${input.chapterNo}章`,
            content: buffer,
            versionNo: saved.versionNo,
          });
        } catch (e) {
          // 文件侧失败时,回滚已插入的 version 行,保持 DB/FS 一致
          if (saved) {
            try {
              deps.chaptersRepo.deleteVersion(
                input.chapterNo,
                saved.versionNo,
              );
            } catch {
              // 回滚失败暂无 logger,先吞;后续接入日志后补充
            }
          }
          yield {
            type: "error",
            errorClass: "save_failed",
            message: String((e as Error)?.message ?? e),
          };
          return;
        }
      }
    }
    yield ev;
  }
}
