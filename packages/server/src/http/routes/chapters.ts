import { Hono } from "hono";
import { streamSseResponse } from "../sse.js";
import {
  writeChapterSimple,
  type WriteChapterDeps,
} from "../../ai/orchestrator/write-chapter.js";

export interface ChapterRoutesDeps {
  getDeps?: (bookId: string) => WriteChapterDeps | undefined;
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
    return streamSseResponse(
      writeChapterSimple(wcDeps, { chapterNo: no, userIntent }),
    );
  });
  return app;
}
