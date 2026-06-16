import type { LanguageModel } from "ai";
import type { SseEvent } from "@scribe/shared";
import { streamLlm } from "../llm-call.js";
import { prependDeepestPrompt } from "../prompts/deepest-prompt.js";
import {
  REPAIR_PROMPT,
  buildRepairUserPrompt,
  type RepairContext,
} from "../prompts/repair-chapter.js";
import { sanitizeChapterOutput } from "./output-sanitize.js";

export interface ChaptersRepoLike {
  saveVersion(input: {
    chapterNo: number;
    source: "ai_write" | "ai_rewrite" | "user_edit" | "segment_revise";
    contentMd: string;
  }): { versionNo: number };
  deleteVersion(chapterNo: number, versionNo: number): void;
}

export interface ChapterFilesLike {
  save(input: {
    chapterNo: number;
    title: string;
    content: string;
    versionNo: number;
  }): void;
}

export interface RepairDeps {
  model: LanguageModel;
  chaptersRepo: ChaptersRepoLike;
  chapterFiles: ChapterFilesLike;
  abortSignal?: AbortSignal;
  /** 用户最深处提示词,原文拼到最前端 */
  deepestPrompt?: string;
}

export interface RepairInput {
  chapterNo: number;
  ctx: RepairContext;
}

/**
 * 章节修复编排器:在 audit 给出 critical/warning 后,基于审查报告对原文做最小化修复。
 *
 * 与 writeChapterSimple 类似的落盘契约:
 * - LLM 流式产出 → 收尾 done 事件之前先落盘
 * - 落盘失败时回滚已写入的 version 行,yield error 替代 done
 * - 空内容(buffer.trim() 为空)既不 yield done 也不落盘,作为 silent no-op
 *
 * source 固定为 "ai_rewrite",与人工编辑或 segment_revise 区分开。
 */
export async function* repairChapter(
  deps: RepairDeps,
  input: RepairInput,
): AsyncIterable<SseEvent> {
  const userPrompt = buildRepairUserPrompt(input.ctx);
  const messages = prependDeepestPrompt([
    { role: "system" as const, content: REPAIR_PROMPT },
    { role: "user" as const, content: userPrompt },
  ], deps.deepestPrompt);
  let buffer = "";
  let success = false;
  for await (const ev of streamLlm({
    model: deps.model,
    messages,
    abortSignal: deps.abortSignal,
  })) {
    if (ev.type === "text_delta") {
      buffer += ev.delta;
      yield ev;
      continue;
    }
    if (ev.type === "done") {
      // 暂存 done,等落盘成功再发,避免落盘失败时 done/error 双重终结事件
      success = true;
      continue;
    }
    if (ev.type === "error") {
      yield ev;
      return;
    }
    yield ev;
  }
  if (!success) return;
  const content = sanitizeChapterOutput(buffer);
  if (!content.trim()) return;

  let saved: { versionNo: number } | undefined;
  try {
    saved = deps.chaptersRepo.saveVersion({
      chapterNo: input.chapterNo,
      source: "ai_rewrite",
      contentMd: content,
    });
    deps.chapterFiles.save({
      chapterNo: input.chapterNo,
      title: `第${input.chapterNo}章`,
      content,
      versionNo: saved.versionNo,
    });
  } catch (e) {
    if (saved) {
      try {
        deps.chaptersRepo.deleteVersion(input.chapterNo, saved.versionNo);
      } catch {
        // 回滚失败暂无 logger,先吞;后续接入日志后补充
      }
    }
    yield {
      type: "error",
      errorClass: "save_failed",
      message: `修复章节落盘失败:${String((e as Error)?.message ?? e)}`,
    };
    return;
  }
  yield { type: "done" };
}
