import * as fs from "node:fs";
import type { Database } from "better-sqlite3";
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
  open(bookId: string): BookHandle;
  /** 当前已打开(活跃)的书 id —— 自动快照只备份活跃的书 */
  openBookIds(): string[];
  /** 关闭某本书的 workspace 连接(快照恢复前必须调用) */
  closeBook(bookId: string): void;
  closeAll(): void;
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

  return { libraryDb, booksRepo, open, openBookIds, closeBook, closeAll };
}
