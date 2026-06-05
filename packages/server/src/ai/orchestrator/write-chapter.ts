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
  let success = false;
  for await (const ev of streamLlm({
    model: deps.model,
    messages,
    abortSignal: input.abortSignal,
  })) {
    if (ev.type === "text_delta") buffer += ev.delta;
    if (ev.type === "done") success = true;
    yield ev;
  }
  if (!success) return;
  if (!buffer.trim()) return;
  const saved = deps.chaptersRepo.saveVersion({
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
}
