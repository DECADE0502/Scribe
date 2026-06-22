import * as fs from "node:fs";
import type { Database } from "better-sqlite3";
import type { SseEvent } from "@scribe/shared";
import { openLibraryDb } from "../db/library.js";
import { openWorkspaceDb } from "../db/workspace.js";
import { createBooksRepo } from "../db/repositories/books.js";
import { createBookMetaRepo } from "../db/repositories/book-meta.js";
import { createCharactersRepo } from "../db/repositories/characters.js";
import { createOutlineRepo } from "../db/repositories/outline.js";
import { createForeshadowingRepo } from "../db/repositories/foreshadowing.js";
import { createTimelineRepo } from "../db/repositories/timeline.js";
import { createGenreSectionsRepo } from "../db/repositories/genre-sections.js";
import { createWorldbookRepo } from "../db/repositories/worldbook.js";
import { createImportArtifactsRepo } from "../db/repositories/import-artifacts.js";
import { createPromptPresetsRepo } from "../db/repositories/prompt-presets.js";
import { createReaderIssuesRepo } from "../db/repositories/reader-issues.js";
import { createChaptersRepo } from "../db/repositories/chapters.js";
import { createConversationsRepo } from "../db/repositories/conversations.js";
import { createTokenUsageRepo } from "../db/repositories/token-usage.js";
import { createChapterFiles } from "../fs/chapter-files.js";
import type { AppPaths } from "../config/paths.js";

export interface BookHandle {
  bookId: string;
  workspaceDb: Database;
  bookMetaRepo: ReturnType<typeof createBookMetaRepo>;
  charactersRepo: ReturnType<typeof createCharactersRepo>;
  outlineRepo: ReturnType<typeof createOutlineRepo>;
  foreshadowingRepo: ReturnType<typeof createForeshadowingRepo>;
  timelineRepo: ReturnType<typeof createTimelineRepo>;
  genreSectionsRepo: ReturnType<typeof createGenreSectionsRepo>;
  worldbookRepo: ReturnType<typeof createWorldbookRepo>;
  importArtifactsRepo: ReturnType<typeof createImportArtifactsRepo>;
  promptPresetsRepo: ReturnType<typeof createPromptPresetsRepo>;
  readerIssuesRepo: ReturnType<typeof createReaderIssuesRepo>;
  chaptersRepo: ReturnType<typeof createChaptersRepo>;
  conversationsRepo: ReturnType<typeof createConversationsRepo>;
  tokenUsageRepo: ReturnType<typeof createTokenUsageRepo>;
  chapterFiles: ReturnType<typeof createChapterFiles>;
  rulesMdPath: string;
}

export interface BookRegistry {
  libraryDb: Database;
  booksRepo: ReturnType<typeof createBooksRepo>;
  paths: AppPaths;
  open(bookId: string): BookHandle;
  /** 当前已打开(活跃)的书 id —— 自动快照只备份活跃的书 */
  openBookIds(): string[];
  /** 关闭某本书的 workspace 连接(快照恢复前必须调用) */
  closeBook(bookId: string): void;
  closeAll(): void;
  /** 标记一个长任务(SSE 写作流等)开始占用某书,期间禁止关连接/删书 */
  acquire(bookId: string): BookHandle;
  /** 长任务结束,释放占用 */
  release(bookId: string): void;
  /** 该书是否有进行中的长任务(快照/删书前应检查,避免 use-after-close 崩溃) */
  isBusy(bookId: string): boolean;
  /**
   * 尝试取得"破坏性互斥操作"锁(删章/导入/恢复快照/删书)。
   * 若该书有进行中的长任务或已有互斥操作,返回 false(调用方应回 409)。
   */
  tryBeginExclusive(bookId: string): boolean;
  /** 释放破坏性互斥锁 */
  endExclusive(bookId: string): void;
  /** 该书是否正在执行破坏性互斥操作(写作流开始前应检查) */
  isMutating(bookId: string): boolean;
}

export interface BookRegistryOpts {
  paths: AppPaths;
  libraryDb?: Database;
}

export function createBookRegistry(opts: BookRegistryOpts): BookRegistry {
  const libraryDb = opts.libraryDb ?? openLibraryDb(opts.paths.libraryDb);
  const booksRepo = createBooksRepo(libraryDb);
  const handles = new Map<string, BookHandle>();

  function open(bookId: string): BookHandle {
    const existing = handles.get(bookId);
    if (existing) return existing;

    fs.mkdirSync(opts.paths.bookDir(bookId), { recursive: true });
    fs.mkdirSync(opts.paths.chaptersDir(bookId), { recursive: true });

    const ws = openWorkspaceDb(opts.paths.workspaceDb(bookId));
    const handle: BookHandle = {
      bookId,
      workspaceDb: ws,
      bookMetaRepo: createBookMetaRepo(ws),
      charactersRepo: createCharactersRepo(ws),
      outlineRepo: createOutlineRepo(ws),
      foreshadowingRepo: createForeshadowingRepo(ws),
      timelineRepo: createTimelineRepo(ws),
      genreSectionsRepo: createGenreSectionsRepo(ws),
      worldbookRepo: createWorldbookRepo(ws),
      importArtifactsRepo: createImportArtifactsRepo(ws, bookId),
      promptPresetsRepo: createPromptPresetsRepo(ws, bookId),
      readerIssuesRepo: createReaderIssuesRepo(ws),
      chaptersRepo: createChaptersRepo(ws),
      conversationsRepo: createConversationsRepo(ws),
      tokenUsageRepo: createTokenUsageRepo(ws),
      chapterFiles: createChapterFiles(opts.paths.chaptersDir(bookId)),
      rulesMdPath: opts.paths.rulesMd(bookId),
    };
    handles.set(bookId, handle);
    return handle;
  }

  const inFlight = new Map<string, number>();

  function acquire(bookId: string): BookHandle {
    const handle = open(bookId);
    inFlight.set(bookId, (inFlight.get(bookId) ?? 0) + 1);
    return handle;
  }

  function release(bookId: string): void {
    const n = (inFlight.get(bookId) ?? 0) - 1;
    if (n <= 0) inFlight.delete(bookId);
    else inFlight.set(bookId, n);
  }

  function isBusy(bookId: string): boolean {
    return (inFlight.get(bookId) ?? 0) > 0;
  }

  const exclusiveLocks = new Set<string>();

  function tryBeginExclusive(bookId: string): boolean {
    if (isBusy(bookId) || exclusiveLocks.has(bookId)) return false;
    exclusiveLocks.add(bookId);
    return true;
  }

  function endExclusive(bookId: string): void {
    exclusiveLocks.delete(bookId);
  }

  function isMutating(bookId: string): boolean {
    return exclusiveLocks.has(bookId);
  }

  function closeBook(bookId: string): void {
    const h = handles.get(bookId);
    if (h) {
      try { h.workspaceDb.close(); } catch { /* ignore */ }
      handles.delete(bookId);
    }
  }

  function closeAll(): void {
    for (const h of handles.values()) {
      try { h.workspaceDb.close(); } catch { /* ignore */ }
    }
    handles.clear();
    try { libraryDb.close(); } catch { /* ignore */ }
  }

  function openBookIds(): string[] {
    return [...handles.keys()];
  }

  return { libraryDb, booksRepo, paths: opts.paths, open, openBookIds, closeBook, closeAll, acquire, release, isBusy, tryBeginExclusive, endExclusive, isMutating };
}

/**
 * 包裹一个 SSE 事件生成器,使其执行期间占用该书(acquire/release),
 * 这样快照/删书会因 isBusy 而被拒绝,不会在写作中途关掉数据库连接导致崩溃。
 * 同时:若该书正在执行破坏性互斥操作(删章/导入/恢复快照),直接发 error 事件拒绝,
 * 不开始写作流(避免与之冲突)。
 */
export async function* holdBook(
  registry: Pick<BookRegistry, "acquire" | "release" | "isMutating">,
  bookId: string,
  gen: AsyncIterable<SseEvent>,
): AsyncIterable<SseEvent> {
  if (registry.isMutating(bookId)) {
    yield {
      type: "error",
      errorClass: "mutation_in_progress",
      message: "这本书正在执行删除/导入/恢复快照等操作,请稍后再试。",
    };
    return;
  }
  registry.acquire(bookId);
  try {
    yield* gen;
  } finally {
    registry.release(bookId);
  }
}
