import { type Database as DatabaseType } from "better-sqlite3";
import { openDbWithMigrations } from "./open.js";

/**
 * 打开作品库数据库(全局元数据,跨 workspace 共享:books 列表、累计成本等)。
 * 调用方负责 db.close()。
 */
export function openLibraryDb(dbPath: string): DatabaseType {
  return openDbWithMigrations(dbPath, "library");
}
