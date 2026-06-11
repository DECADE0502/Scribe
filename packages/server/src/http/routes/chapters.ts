import { Hono } from "hono";
import { streamSseResponse } from "../sse.js";
import {
  writeChapterSimple,
  type WriteChapterDeps,
} from "../../ai/orchestrator/write-chapter.js";
import { buildChapterWriteMessages } from "../../ai/context-builder/book-context.js";
import type { BookRegistry } from "../book-registry.js";

export interface ChapterRoutesDeps {
  getDeps?: (bookId: string) => WriteChapterDeps | undefined;
  registry?: BookRegistry;
  onChapterCommitted?: (bookId: string) => void;
}

export function chapterRoutes(deps: ChapterRoutesDeps = {}) {
  const app = new Hono();

  app.post("/api/books/:bookId/chapters/:no/write", async (c) => {
    const bookId = c.req.param("bookId");
    const no = Number(c.req.param("no"));
    if (!Number.isInteger(no) || no < 1) {
      return c.json({ error: "章节号无效" }, 400);
    }
    const body = await c.req.json().catch(() => ({}));
    const userIntent = String((body as { userIntent?: unknown })?.userIntent ?? "");
    const wcDeps = deps.getDeps?.(bookId);
    if (!wcDeps) {
      return c.json({ error: "未配置模型,请先在设置中配置 API Key" }, 503);
    }
    // spec §6.1:普通写作同样注入完整防漂移上下文(召回+最近摘要+题材板块+伏笔)
    const prebuiltMessages = deps.registry
      ? buildChapterWriteMessages(deps.registry.open(bookId), no, userIntent).messages
      : undefined;
    const inner = writeChapterSimple(wcDeps, {
      chapterNo: no,
      userIntent,
      prebuiltMessages,
      abortSignal: c.req.raw.signal,
    });
    async function* withCommit() {
      for await (const ev of inner) {
        if (ev.type === "done") deps.onChapterCommitted?.(bookId);
        yield ev;
      }
    }
    return streamSseResponse(withCommit());
  });

  // 读取章节(编辑器加载)
  app.get("/api/books/:bookId/chapters/:no", async (c) => {
    const bookId = c.req.param("bookId");
    const no = Number(c.req.param("no"));
    if (!Number.isInteger(no) || no < 1) return c.json({ error: "章节号无效" }, 400);
    if (!deps.registry) return c.json({ error: "服务未就绪" }, 503);
    const book = deps.registry.booksRepo.get(bookId);
    if (!book) return c.json({ error: "书不存在" }, 404);
    const handle = deps.registry.open(bookId);
    const record = handle.chapterFiles.read(no);
    if (!record) return c.json({ error: "章节不存在" }, 404);
    return c.json(record);
  });

  // 章节列表
  app.get("/api/books/:bookId/chapters", async (c) => {
    const bookId = c.req.param("bookId");
    if (!deps.registry) return c.json({ error: "服务未就绪" }, 503);
    const book = deps.registry.booksRepo.get(bookId);
    if (!book) return c.json({ error: "书不存在" }, 404);
    const handle = deps.registry.open(bookId);
    return c.json({ chapters: handle.chapterFiles.list() });
  });

  // 用户手动保存(user_edit version)
  app.put("/api/books/:bookId/chapters/:no", async (c) => {
    const bookId = c.req.param("bookId");
    const no = Number(c.req.param("no"));
    if (!Number.isInteger(no) || no < 1) return c.json({ error: "章节号无效" }, 400);
    if (!deps.registry) return c.json({ error: "服务未就绪" }, 503);
    const book = deps.registry.booksRepo.get(bookId);
    if (!book) return c.json({ error: "书不存在" }, 404);

    const body = await c.req.json().catch(() => ({}));
    const content = String((body as { content?: unknown })?.content ?? "");
    if (!content.trim()) return c.json({ error: "content 不能为空" }, 400);
    const titleRaw = (body as { title?: unknown })?.title;
    const handle = deps.registry.open(bookId);
    const existing = handle.chapterFiles.read(no);
    const title = typeof titleRaw === "string" && titleRaw.trim()
      ? titleRaw.trim()
      : existing?.title ?? `第${no}章`;

    const saved = handle.chaptersRepo.saveVersion({
      chapterNo: no,
      source: "user_edit",
      contentMd: content,
    });
    try {
      handle.chapterFiles.save({ chapterNo: no, title, content, versionNo: saved.versionNo });
    } catch (fsErr) {
      try { handle.chaptersRepo.deleteVersion(no, saved.versionNo); } catch { /* ignore */ }
      return c.json({ error: `章节文件落盘失败:${(fsErr as Error).message ?? "unknown"}` }, 500);
    }
    deps.onChapterCommitted?.(bookId);
    return c.json({ versionNo: saved.versionNo });
  });

  return app;
}
