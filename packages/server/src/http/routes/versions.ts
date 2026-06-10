import { Hono } from "hono";
import type { BookRegistry } from "../book-registry.js";

export interface VersionRoutesDeps {
  registry: BookRegistry;
}

export function versionRoutes(deps: VersionRoutesDeps) {
  const app = new Hono();

  app.get("/api/books/:bookId/chapters/:no/versions", async (c) => {
    const bookId = c.req.param("bookId");
    const no = Number(c.req.param("no"));
    if (!Number.isInteger(no) || no < 1) return c.json({ error: "章节号无效" }, 400);
    const book = deps.registry.booksRepo.get(bookId);
    if (!book) return c.json({ error: "书不存在" }, 404);
    const handle = deps.registry.open(bookId);
    return c.json({ versions: handle.chaptersRepo.listVersions(no) });
  });

  app.post("/api/books/:bookId/chapters/:no/restore-version", async (c) => {
    const bookId = c.req.param("bookId");
    const no = Number(c.req.param("no"));
    if (!Number.isInteger(no) || no < 1) return c.json({ error: "章节号无效" }, 400);
    const book = deps.registry.booksRepo.get(bookId);
    if (!book) return c.json({ error: "书不存在" }, 404);

    const body = await c.req.json().catch(() => ({})) as { versionNo?: unknown };
    const versionNo = Number(body.versionNo);
    if (!Number.isInteger(versionNo) || versionNo < 1) return c.json({ error: "versionNo 无效" }, 400);

    const handle = deps.registry.open(bookId);
    const target = handle.chaptersRepo.listVersions(no).find(v => v.versionNo === versionNo);
    if (!target) return c.json({ error: "版本不存在" }, 404);

    // 回滚 = 把目标版本内容存为新 version(user_edit),不删历史
    const existing = handle.chapterFiles.read(no);
    const title = existing?.title ?? `第${no}章`;
    const saved = handle.chaptersRepo.saveVersion({
      chapterNo: no,
      source: "user_edit",
      contentMd: target.contentMd,
    });
    try {
      handle.chapterFiles.save({ chapterNo: no, title, content: target.contentMd, versionNo: saved.versionNo });
    } catch (fsErr) {
      try { handle.chaptersRepo.deleteVersion(no, saved.versionNo); } catch { /* ignore */ }
      return c.json({ error: `章节文件落盘失败:${(fsErr as Error).message ?? "unknown"}` }, 500);
    }
    return c.json({ versionNo: saved.versionNo, restoredFrom: versionNo });
  });

  return app;
}
