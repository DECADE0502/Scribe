import type { CoreMessage, LanguageModel } from "ai";
import type { SseEvent } from "@scribe/shared";
import { streamLlm } from "../llm-call.js";
import { SYSTEM_PROMPT } from "../prompts/system-prompt.js";
import { prependDeepestPrompt } from "../prompts/deepest-prompt.js";
import {
  buildWriteChapterPrompt,
  type WriteChapterContext,
} from "../prompts/write-chapter.js";
import { sanitizeChapterOutput } from "./output-sanitize.js";

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
  prebuiltMessages?: CoreMessage[];
  source?: "ai_write" | "ai_rewrite";
  deepestPrompt?: string;
  abortSignal?: AbortSignal;
}

export async function* writeChapterSimple(
  deps: WriteChapterDeps,
  input: WriteChapterInput,
): AsyncIterable<SseEvent> {
  const baseMessages: CoreMessage[] = input.prebuiltMessages ?? [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: buildWriteChapterPrompt({
        chapterNo: input.chapterNo,
        userIntent: input.userIntent,
        ...input.ctx,
      }),
    },
  ];
  const messages = prependDeepestPrompt(baseMessages, input.deepestPrompt);
  let buffer = "";

  for await (const ev of streamLlm({
    model: deps.model,
    messages,
    abortSignal: input.abortSignal,
  })) {
    if (ev.type === "text_delta") buffer += ev.delta;
    if (ev.type === "done") {
      const content = sanitizeChapterOutput(buffer);
      if (content.trim()) {
        let saved: { versionNo: number } | undefined;
        try {
          saved = deps.chaptersRepo.saveVersion({
            chapterNo: input.chapterNo,
            source: input.source ?? "ai_write",
            contentMd: content,
          });
          deps.chapterFiles.save({
            chapterNo: input.chapterNo,
            title: `第 ${input.chapterNo} 章`,
            content,
            versionNo: saved.versionNo,
          });
        } catch (error) {
          if (saved) {
            try {
              deps.chaptersRepo.deleteVersion(input.chapterNo, saved.versionNo);
            } catch {
              // Keep the original save error as the reported failure.
            }
          }
          yield {
            type: "error",
            errorClass: "save_failed",
            message: String((error as Error)?.message ?? error),
          };
          return;
        }
      }
    }
    yield ev;
  }
}
