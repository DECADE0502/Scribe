import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export interface AppPaths {
  appRoot: string;
  libraryDb: string;
  booksDir: string;
  backupsDir: string;
  secretsEnv: string;
  configJson: string;
  bookDir(id: string): string;
  workspaceDb(id: string): string;
  chaptersDir(id: string): string;
  rulesMd(id: string): string;
  exportsDir(id: string): string;
  bookBackupsDir(id: string): string;
}

/** 向上查找项目根(以 pnpm-workspace.yaml 为标记),定位失败则退回当前工作目录。 */
function findProjectRoot(): string {
  let dir: string;
  try {
    dir = path.dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

/**
 * 解析数据根目录。默认把所有数据放在**项目目录**下的 `.scribe-data/`,
 * 这样删掉项目目录即可彻底清除,不会在系统配置目录(%APPDATA% 等)残留。
 * 可用环境变量 `SCRIBE_HOME` 覆盖到任意位置。
 */
export function resolveAppPaths(opts: { env: Record<string, string | undefined>; projectRoot?: string }): AppPaths {
  const env = opts.env;
  let root: string;
  if (env.SCRIBE_HOME) {
    root = env.SCRIBE_HOME.replace(/\\/g, "/");
  } else {
    const projectRoot = (opts.projectRoot ?? findProjectRoot()).replace(/\\/g, "/");
    root = path.posix.join(projectRoot, ".scribe-data");
  }
  const j = (...parts: string[]) => path.posix.join(root, ...parts);
  return {
    appRoot: root,
    libraryDb: j("library.db"),
    booksDir: j("books"),
    backupsDir: j("backups"),
    secretsEnv: j("secrets.env"),
    configJson: j("config.json"),
    bookDir: (id) => j("books", id),
    workspaceDb: (id) => j("books", id, "workspace.db"),
    chaptersDir: (id) => j("books", id, "chapters"),
    rulesMd: (id) => j("books", id, "rules.md"),
    exportsDir: (id) => j("books", id, "exports"),
    bookBackupsDir: (id) => j("backups", id),
  };
}
