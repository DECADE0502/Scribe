/**
 * 删章统筹：回档语义。删 fromChapterNo 及之后所有章 + 所有派生数据。
 *
 * 一个 DB 事务包住 7 张表的级联清理 + characters.appearances 过滤。
 * .md 文件在事务外删（FS 操作不在 DB 事务里）。
 *
 * 不扣减 books.total_cost_usd（历史成本保留）。
 * characters.current_state 和 genre_section_items 无章级快照，无法自动回滚，
 * 返回受影响角色列表供前端提示用户手动核对。
 */
import type { BookHandle } from "../../http/book-registry.js";
import { log } from "../../logger.js";

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
  /** current_state / genre_section_items 无法自动回滚，提示用户检查的角色 */
  affectedCharacterNames: string[];
}

export function deleteChaptersFrom(
  handle: BookHandle,
  fromChapterNo: number,
): DeleteResult {
  log.info("delete-chapter", `开始回档删除：从第 ${fromChapterNo} 章起`);

  // 先列出要删的章号（用于删 .md 文件和返回结果）
  const existingChapters = handle.chapterFiles.list();
  const toDelete: number[] = existingChapters
    .map((c: { chapterNo: number }) => c.chapterNo)
    .filter((n: number) => n >= fromChapterNo)
    .sort((a: number, b: number) => a - b);

  if (toDelete.length === 0) {
    log.info("delete-chapter", `没有 >= ${fromChapterNo} 的章节，空操作`);
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

  // 记录受影响角色（删之前快照 appearances 有变化的）
  const charactersBefore = handle.charactersRepo.list();
  const affectedCharacterNames: string[] = charactersBefore
    .filter((c: { appearances: Array<{ chapterNo: number }> }) =>
      c.appearances.some((a: { chapterNo: number }) => a.chapterNo >= fromChapterNo))
    .map((c: { name: string }) => c.name);

  // DB 事务：级联清理（token_usage 保留，是历史用量账本不影响 AI 判断）
  const db = handle.workspaceDb;
  const r = db.transaction(() => {
    const ds = handle.chaptersRepo.deleteSummaryFrom(fromChapterNo);
    const dv = handle.chaptersRepo.deleteVersionsFrom(fromChapterNo);
    const da = handle.chaptersRepo.deleteAuditFrom(fromChapterNo);
    const dt = handle.timelineRepo.deleteFromChapter(fromChapterNo);
    const dri = handle.readerIssuesRepo.deleteFromChapter(fromChapterNo);
    const df = handle.foreshadowingRepo.deleteFromChapter(fromChapterNo);
    const dc = handle.charactersRepo.removeAppearancesFromChapter(fromChapterNo);
    return { ds, dv, da, dt, dri, df, dc };
  })();

  // 删 .md 文件
  for (const n of toDelete) {
    handle.chapterFiles.delete(n);
  }

  log.info("delete-chapter", `完成：删章 ${toDelete.join(",")}，summary=${r.ds} ver=${r.dv} audit=${r.da} timeline=${r.dt} issues=${r.dri} foreshadow=${r.df} characters=${r.dc}`);

  return {
    fromChapterNo,
    deletedChapters: toDelete,
    deletedSummaries: r.ds,
    deletedVersions: r.dv,
    deletedAudits: r.da,
    deletedTimeline: r.dt,
    deletedReaderIssues: r.dri,
    deletedForeshadowing: r.df,
    touchedCharacters: r.dc,
    affectedCharacterNames,
  };
}
