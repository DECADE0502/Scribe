import type { BookHandle } from "../http/book-registry.js";
import { log } from "../logger.js";

export interface DeleteResult {
  fromChapterNo: number;
  deletedChapters: number[];
  deletedSummaries: number;
  deletedVersions: number;
  deletedAudits: number;
  deletedTimeline: number;
  deletedReaderIssues: number;
  deletedForeshadowing: number;
  touchedCharacters: number;
  affectedCharacterNames: string[];
}

export function deleteChaptersFrom(
  handle: BookHandle,
  fromChapterNo: number,
): DeleteResult {
  log.info("delete-chapter", `Deleting chapters from ${fromChapterNo}`);

  const toDelete = handle.chapterFiles
    .list()
    .map((c: { chapterNo: number }) => c.chapterNo)
    .filter((n: number) => n >= fromChapterNo)
    .sort((a: number, b: number) => a - b);

  if (toDelete.length === 0) {
    return {
      fromChapterNo,
      deletedChapters: [],
      deletedSummaries: 0,
      deletedVersions: 0,
      deletedAudits: 0,
      deletedTimeline: 0,
      deletedReaderIssues: 0,
      deletedForeshadowing: 0,
      touchedCharacters: 0,
      affectedCharacterNames: [],
    };
  }

  const affectedCharacterNames = handle.charactersRepo
    .list()
    .filter((c: { appearances: Array<{ chapterNo: number }> }) =>
      c.appearances.some((a: { chapterNo: number }) => a.chapterNo >= fromChapterNo))
    .map((c: { name: string }) => c.name);

  const result = handle.workspaceDb.transaction(() => {
    const deletedSummaries = handle.chaptersRepo.deleteSummaryFrom(fromChapterNo);
    const deletedVersions = handle.chaptersRepo.deleteVersionsFrom(fromChapterNo);
    const deletedAudits = handle.chaptersRepo.deleteAuditFrom(fromChapterNo);
    const deletedTimeline = handle.timelineRepo.deleteFromChapter(fromChapterNo);
    const deletedReaderIssues = handle.readerIssuesRepo.deleteFromChapter(fromChapterNo);
    const deletedForeshadowing = handle.foreshadowingRepo.deleteFromChapter(fromChapterNo);
    const touchedCharacters = handle.charactersRepo.removeAppearancesFromChapter(fromChapterNo);
    return {
      deletedSummaries,
      deletedVersions,
      deletedAudits,
      deletedTimeline,
      deletedReaderIssues,
      deletedForeshadowing,
      touchedCharacters,
    };
  })();

  for (const chapterNo of toDelete) {
    handle.chapterFiles.delete(chapterNo);
  }

  return {
    fromChapterNo,
    deletedChapters: toDelete,
    affectedCharacterNames,
    ...result,
  };
}
