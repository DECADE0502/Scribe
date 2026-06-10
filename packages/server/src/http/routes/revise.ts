import { Hono } from "hono";
import type { LanguageModel } from "ai";
import { streamSseResponse } from "../sse.js";
import type { BookRegistry } from "../book-registry.js";
import { reviseSegment } from "../../ai/orchestrator/revise-segment.js";

export interface ReviseRoutesDeps {
  registry: BookRegistry;
  getModel?: () => LanguageModel | undefined;
}

export function reviseRoutes(deps: ReviseRoutesDeps) {
  const app = new Hono();

  // 流式改写选段(不落盘)
  app.post("/api/books/:bookId/chapters/:no/revise-segment", async (c) => {
    const bookId = c.req.param("bookId");
    const no = Number(c.req.param("no"));
    if (!Number.isInteger(no) || no < 1) return c.json({ error: "章节号无效" }, 400);
    const book = deps.registry.booksRepo.get(bookId);
    if (!book) return c.json({ error: "书不存在" }, 404);

    const body = await c.req.json().catch(() => ({}));
    const segmentText = String((body as { segmentText?: unknown })?.segmentText ?? "");
    const instruction = String((body as { instruction?: unknown })?.instruction ?? "");
    if (!segmentText.trim()) return c.json({ error: "segmentText 不能为空" }, 400);

    const model = deps.getModel?.();
    if (!model) return c.json({ error: "未配置模型,请先在设置中配置 API Key" }, 503);

    const handle = deps.registry.open(bookId);
    const chapter = handle.chapterFiles.read(no);
    if (!chapter) return c.json({ error: "章节不存在" }, 404);

    return streamSseResponse(reviseSegment(
      { model, abortSignal: c.req.raw.signal },
      { chapterContent: chapter.content, segmentText, instruction },
    ));
  });

  // 用户接受改写后落盘(source = segment_revise)
  app.post("/api/books/:bookId/chapters/:no/apply-revision", async (c) => {
    const bookId = c.req.param("bookId");
    const no = Number(c.req.param("no"));
    if (!Number.isInteger(no) || no < 1) return c.json({ error: "章节号无效" }, 400);
    const book = deps.registry.booksRepo.get(bookId);
    if (!book) return c.json({ error: "书不存在" }, 404);

    const body = await c.req.json().catch(() => ({}));
    const segmentText = String((body as { segmentText?: unknown })?.segmentText ?? "");
    const newSegment = String((body as { newSegment?: unknown })?.newSegment ?? "");
    if (!segmentText.trim() || !newSegment.trim()) {
      return c.json({ error: "segmentText 与 newSegment 不能为空" }, 400);
    }

    const handle = deps.registry.open(bookId);
    const chapter = handle.chapterFiles.read(no);
    if (!chapter) return c.json({ error: "章节不存在" }, 404);
    if (!chapter.content.includes(segmentText)) {
      return c.json({ error: "选中的段落与章节内容不匹配,可能已被修改" }, 409);
    }

    const newContent = chapter.content.replace(segmentText, newSegment);
    const saved = handle.chaptersRepo.saveVersion({
      chapterNo: no,
      source: "segment_revise",
      contentMd: newContent,
    });
    try {
      handle.chapterFiles.save({
        chapterNo: no,
        title: chapter.title,
        content: newContent,
        versionNo: saved.versionNo,
      });
    } catch (fsErr) {
      try { handle.chaptersRepo.deleteVersion(no, saved.versionNo); } catch { /* ignore */ }
      return c.json({ error: `章节文件落盘失败:${(fsErr as Error).message ?? "unknown"}` }, 500);
    }
    return c.json({ versionNo: saved.versionNo, content: newContent });
  });

  return app;
}
