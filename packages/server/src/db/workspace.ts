import { type Database as DatabaseType } from "better-sqlite3";
import { openDbWithMigrations } from "./open.js";

/**
 * 打开 workspace(单本作品)数据库。每本作品一个独立 .db 文件,包含章节、角色、世界观等表。
 * 调用方负责 db.close()。
 */
export function openWorkspaceDb(dbPath: string): DatabaseType {
  return openDbWithMigrations(dbPath, "workspace");
}
