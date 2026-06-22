import * as fs from "node:fs";
import * as path from "node:path";
import { Hono } from "hono";
import type { BookRegistry } from "../book-registry.js";
import { createSnapshot, listSnapshots, restoreSnapshot } from "../../fs/snapshot.js";
import type { AppPaths } from "../../config/paths.js";

export interface SnapshotRoutesDeps {
  registry: BookRegistry;
  paths: AppPaths;
}

export function snapshotRoutes(deps: SnapshotRoutesDeps) {
  const app = new Hono();

  app.get("/api/books/:bookId/snapshots", async (c) => {
    const bookId = c.req.param("bookId");
    const book = deps.registry.booksRepo.get(bookId);
    if (!book) return c.json({ error: "书不存在" }, 404);
    const dir = deps.paths.bookBackupsDir(bookId);
    const infos = await listSnapshots(dir);
    const snapshots = infos.map(info => {
      const stat = fs.statSync(info.path);
      return { filename: info.name, createdAt: stat.mtimeMs, sizeBytes: stat.size };
    }).sort((a, b) => b.createdAt - a.createdAt);
    return c.json({ snapshots });
  });

  app.post("/api/books/:bookId/snapshots/create", async (c) => {
    const bookId = c.req.param("bookId");
    const book = deps.registry.booksRepo.get(bookId);
    if (!book) return c.json({ error: "书不存在" }, 404);
    if (deps.registry.isBusy(bookId)) {
      return c.json({ error: "这本书正在写作/生成中,请稍后再创建快照" }, 409);
    }
    deps.registry.open(bookId); // 确保目录在
    // Windows 下打包打开中的 SQLite(WAL)会锁,先关连接
    deps.registry.closeBook(bookId);
    try {
      const snap = await createSnapshot({
        srcDir: deps.paths.bookDir(bookId),
        outDir: deps.paths.bookBackupsDir(bookId),
      });
      return c.json({ path: snap.path, filename: snap.name }, 201);
    } catch (e) {
      return c.json({ error: `创建快照失败:${(e as Error).message}` }, 500);
    }
  });

  app.post("/api/books/:bookId/snapshots/restore", async (c) => {
    const bookId = c.req.param("bookId");
    const book = deps.registry.booksRepo.get(bookId);
    if (!book) return c.json({ error: "书不存在" }, 404);
    const body = await c.req.json().catch(() => ({})) as { filename?: unknown; confirmText?: unknown };
    if (body.confirmText !== "RESTORE") {
      return c.json({ error: "请输入 RESTORE 确认恢复" }, 400);
    }
    const filename = String(body.filename ?? "");
    if (!/^\d{8}-\d{4,6}\.tar\.gz$/.test(filename)) {
      return c.json({ error: "快照文件名无效" }, 400);
    }
    const snapshotPath = path.posix.join(deps.paths.bookBackupsDir(bookId), filename);
    if (!fs.existsSync(snapshotPath)) return c.json({ error: "快照不存在" }, 404);

    if (deps.registry.isBusy(bookId)) {
      return c.json({ error: "这本书正在写作/生成中,请稍后再恢复快照" }, 409);
    }
    // 关闭当前 workspace 连接(restore 要覆盖 db 文件)
    deps.registry.closeBook(bookId);
    try {
      await restoreSnapshot({ snapshotPath, destDir: deps.paths.bookDir(bookId) });
    } catch (e) {
      return c.json({ error: `恢复快照失败:${(e as Error).message}` }, 500);
    }
    return c.json({ restored: filename });
  });

  return app;
}
