import * as os from "node:os";
import * as path from "node:path";

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

export function resolveAppPaths(opts: { env: Record<string, string | undefined> }): AppPaths {
  const env = opts.env;
  const home = os.homedir();
  let root: string;
  if (env.SCRIBE_HOME) {
    root = env.SCRIBE_HOME;
  } else if (os.platform() === "win32") {
    const appData = env.APPDATA ?? path.join(home, "AppData", "Roaming");
    root = path.posix.join(appData.replace(/\\/g, "/"), "scribe");
  } else if (os.platform() === "darwin") {
    root = path.posix.join(home, "Library", "Application Support", "scribe");
  } else {
    root = path.posix.join(home, ".config", "scribe");
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
