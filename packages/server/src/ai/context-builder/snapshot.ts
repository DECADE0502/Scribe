import * as fs from "node:fs";
import type {
  Character,
  OutlineNode,
  Foreshadowing,
  GenreSection,
  GenreSectionItem,
  ChapterSummary,
} from "@scribe/shared";

export interface BookMeta {
  title: string;
  premise: string;
  tone?: string;
  genre?: string;
}

export interface BookSnapshot {
  bookId: string;
  meta: BookMeta;
  rulesMd: string;
  characters: Character[];
  outline: OutlineNode[];
  activeForeshadowing: Foreshadowing[];
  paidForeshadowing: Foreshadowing[];
  recentSummaries: ChapterSummary[]; // 最近 3 章, 按 chapterNo desc
  allSummaries: ChapterSummary[]; // 全部, 按 chapterNo asc
  genreSections: { section: GenreSection; items: GenreSectionItem[] }[];
}

// 用 interface 定义最小依赖, 方便 mock
export interface SnapshotRepos {
  charactersRepo: { list(): Character[] };
  outlineRepo: { listAll(): OutlineNode[] };
  foreshadowingRepo: {
    list(filterStatus?: "active" | "paid" | "dropped"): Foreshadowing[];
  };
  chaptersRepo: { listSummaries(): ChapterSummary[] };
  genreSectionsRepo: {
    listSections(): GenreSection[];
    listItems(sectionId: string): GenreSectionItem[];
  };
  // book_meta 通过 db 直接查 key/value
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
  const recentSummaries = [...allSummaries]
    .sort((a, b) => b.chapterNo - a.chapterNo)
    .slice(0, 3);
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
  return {
    bookId,
    meta,
    rulesMd,
    characters: repos.charactersRepo.list(),
    outline: repos.outlineRepo.listAll(),
    activeForeshadowing: repos.foreshadowingRepo.list("active"),
    paidForeshadowing: repos.foreshadowingRepo.list("paid"),
    recentSummaries,
    allSummaries,
    genreSections,
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
