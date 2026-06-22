import type { CoreMessage, LanguageModel } from "ai";
import type { SseEvent } from "@scribe/shared";
import { generateLlmText } from "../llm-call.js";
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
  /** 章节标题(通常取自大纲节点,如"第1章 雨夜重返");缺省回退"第 N 章" */
  chapterTitle?: string;
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

  yield { type: "tool_call_start", toolName: "chapter_write", args: { chapterNo: input.chapterNo } };

  let generated;
  try {
    generated = await generateLlmText({
      model: deps.model,
      messages,
      abortSignal: input.abortSignal,
    });
  } catch (error) {
    yield {
      type: "error",
      errorClass: "write_failed",
      message: String((error as Error)?.message ?? error),
    };
    return;
  }

  // 全量计费:写作是最大的 token 消耗,无论产出是否为空都先记账(token 已经花了)。
  yield {
    type: "usage",
    promptTokens: generated.usage.promptTokens,
    completionTokens: generated.usage.completionTokens,
    cachedTokens: generated.usage.cachedTokens,
    reasoningTokens: generated.usage.reasoningTokens,
  };

  const content = sanitizeChapterOutput(generated.text);
  if (!content.trim()) {
    yield { type: "tool_call_end", toolName: "chapter_write", result: { success: false, reason: "empty" } };
    yield { type: "done" };
    return;
  }

  let saved: { versionNo: number } | undefined;
  try {
    saved = deps.chaptersRepo.saveVersion({
      chapterNo: input.chapterNo,
      source: input.source ?? "ai_write",
      contentMd: content,
    });
    deps.chapterFiles.save({
      chapterNo: input.chapterNo,
      title: input.chapterTitle?.trim() || `第 ${input.chapterNo} 章`,
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

  yield {
    type: "tool_call_end",
    toolName: "chapter_write",
    result: { success: true, wordCount: content.length, versionNo: saved.versionNo },
  };
  yield { type: "done" };
}
