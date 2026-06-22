import * as fs from "node:fs";
import type {
  Character,
  OutlineNode,
  Foreshadowing,
  GenreSection,
  GenreSectionItem,
  ChapterSummary,
  WorldbookEntry,
  PromptBlock,
  PromptPreset,
  ReaderIssue,
} from "@scribe/shared";

export interface BookMeta {
  title: string;
  premise: string;
  tone?: string;
  genre?: string;
}

export interface ChapterFullContent {
  chapterNo: number;
  title: string;
  content: string;
}

export interface BookSnapshot {
  bookId: string;
  meta: BookMeta;
  rulesMd: string;
  characters: Character[];
  outline: OutlineNode[];
  activeForeshadowing: Foreshadowing[];
  paidForeshadowing: Foreshadowing[];
  /** 最近 10 章摘要，按 chapterNo desc */
  recentSummaries: ChapterSummary[];
  /** 最近 10 章正文全文，按 chapterNo asc */
  recentFullChapters: ChapterFullContent[];
  /** 11-20 章前的摘要（中距离记忆），按 chapterNo desc */
  midRangeSummaries: ChapterSummary[];
  allSummaries: ChapterSummary[]; // 全部, 按 chapterNo asc
  genreSections: { section: GenreSection; items: GenreSectionItem[] }[];
  worldbookEntries: WorldbookEntry[];
  promptPresets: PromptPreset[];
  promptBlocks: PromptBlock[];
  readerIssues: ReaderIssue[];
}

// 用 interface 定义最小依赖, 方便 mock
export interface SnapshotRepos {
  charactersRepo: { list(): Character[] };
  outlineRepo: { listAll(): OutlineNode[] };
  foreshadowingRepo: {
    list(filterStatus?: "active" | "paid" | "dropped"): Foreshadowing[];
  };
  chaptersRepo: { listSummaries(): ChapterSummary[] };
  /** 章节文件读取（正文全文）。可选，不传则不注入正文全文。 */
  chapterFiles?: {
    list(): Array<{ chapterNo: number; title: string; content: string }>;
    read(no: number): { chapterNo: number; title: string; content: string } | undefined;
  };
  genreSectionsRepo: {
    listSections(): GenreSection[];
    listItems(sectionId: string): GenreSectionItem[];
  };
  // book_meta 通过 db 直接查 key/value
  worldbookRepo?: {
    list(opts?: { enabledOnly?: boolean }): WorldbookEntry[];
  };
  promptPresetsRepo?: {
    listPresets(opts?: { enabledOnly?: boolean }): PromptPreset[];
    listBlocks(presetId: string, opts?: { enabledOnly?: boolean }): PromptBlock[];
  };
  readerIssuesRepo?: {
    listOpen(): ReaderIssue[];
  };
  bookMetaRepo: {
    get(key: string): string | undefined;
  };
}

export interface SnapshotPaths {
  rulesMd: string; // 完整文件路径
}

export function loadBookSnapshot(
  bookId: string,
  repos: SnapshotRepos,
  paths: SnapshotPaths
): BookSnapshot {
  const allSummaries = repos.chaptersRepo.listSummaries();
  const sortedDesc = [...allSummaries].sort((a, b) => b.chapterNo - a.chapterNo);

  // 最近 10 章摘要（按 chapterNo desc）
  const recentSummaries = sortedDesc.slice(0, 10);

  // 最近 10 章正文全文（按 chapterNo asc）
  let recentFullChapters: ChapterFullContent[] = [];
  if (repos.chapterFiles) {
    const recentNos = recentSummaries.map(s => s.chapterNo).sort((a, b) => a - b);
    recentFullChapters = recentNos
      .map(no => {
        const ch = repos.chapterFiles!.read(no);
        return ch ? { chapterNo: no, title: ch.title, content: ch.content } : undefined;
      })
      .filter((c): c is ChapterFullContent => c !== undefined);
  }

  // 11-20 章前的摘要（中距离记忆，按 chapterNo desc）
  const midRangeSummaries = sortedDesc.slice(10, 20);

  const sections = repos.genreSectionsRepo.listSections();
  const genreSections = sections.map((section) => ({
    section,
    items: repos.genreSectionsRepo.listItems(section.id),
  }));
  const meta: BookMeta = {
    title: repos.bookMetaRepo.get("title") ?? "未命名作品",
    premise: repos.bookMetaRepo.get("premise") ?? "",
    tone: repos.bookMetaRepo.get("tone"),
    genre: repos.bookMetaRepo.get("genre"),
  };
  const rulesMd = fs.existsSync(paths.rulesMd)
    ? fs.readFileSync(paths.rulesMd, "utf-8")
    : "";
  const promptPresets =
    repos.promptPresetsRepo?.listPresets({ enabledOnly: true }) ?? [];
  return {
    bookId,
    meta,
    rulesMd,
    characters: repos.charactersRepo.list(),
    outline: repos.outlineRepo.listAll(),
    activeForeshadowing: repos.foreshadowingRepo.list("active"),
    paidForeshadowing: repos.foreshadowingRepo.list("paid"),
    recentSummaries,
    recentFullChapters,
    midRangeSummaries,
    allSummaries,
    genreSections,
    worldbookEntries: repos.worldbookRepo?.list({ enabledOnly: true }) ?? [],
    promptPresets,
    promptBlocks:
      repos.promptPresetsRepo && promptPresets.length
        ? promptPresets.flatMap((preset) =>
            repos.promptPresetsRepo!.listBlocks(preset.id, { enabledOnly: true }),
          )
        : [],
    readerIssues: repos.readerIssuesRepo?.listOpen() ?? [],
  };
}

// 缓存: 每个 bookId 一份, withSnapshot 闭包内复用
export interface SnapshotCache {
  withSnapshot<T>(
    bookId: string,
    build: () => BookSnapshot,
    fn: (snap: BookSnapshot) => Promise<T> | T
  ): Promise<T>;
  invalidate(bookId: string): void;
}

export function createSnapshotCache(): SnapshotCache {
  const map = new Map<string, BookSnapshot>();
  return {
    async withSnapshot(bookId, build, fn) {
      let snap = map.get(bookId);
      if (!snap) {
        snap = build();
        map.set(bookId, snap);
      }
      return await fn(snap);
    },
    invalidate(bookId) {
      map.delete(bookId);
    },
  };
}
