import * as fs from "node:fs";
import * as path from "node:path";
import { serve } from "@hono/node-server";
import { resolveAppPaths } from "./config/paths.js";
import { loadConfig } from "./config/load.js";
import { loadSecrets, providerSecretName } from "./config/secrets.js";
import { createModelManager } from "./ai/model-manager.js";
import { createBookRegistry } from "./http/book-registry.js";
import { createApp } from "./http/server.js";
import { createSnapshotScheduler } from "./jobs/snapshot-scheduler.js";
import { createSnapshot, pruneSnapshots } from "./fs/snapshot.js";

const paths = resolveAppPaths({ env: process.env });
// 首次启动:确保数据目录存在
fs.mkdirSync(paths.appRoot, { recursive: true });
fs.mkdirSync(paths.booksDir, { recursive: true });
fs.mkdirSync(paths.backupsDir, { recursive: true });
const config = loadConfig(paths.configJson);
const secrets = loadSecrets(paths.secretsEnv);
const registry = createBookRegistry({ paths });

// 按 provider 取对应的 key(内置与自定义 key 相互独立、不可混用)
const activeKey = secrets[providerSecretName(config.provider)] ?? null;
const modelManager = createModelManager({
  provider: config.provider,
  apiKey: activeKey,
  writeModelId: config.writeModelId,
  auditModelId: config.auditModelId,
  customProviders: config.customProviders,
  masterPrompt: config.masterPrompt,
});

// 自动快照备份(spec §3.4):周期 6 小时 + 累计 5 章触发。
// 一致性:tar 直接打包正在写入的 workspace.db 会与并发写撕裂。改为先用
// better-sqlite3 的在线备份 db.backup() 产出一致的 DB 拷贝到暂存目录,连同
// 章节 .md 一起打包暂存目录,从根本上避免边写边读。
const dirtyBooks = new Set<string>(); // 自上次快照后有章节提交的书
async function doSnapshot(bookId: string): Promise<void> {
  const staging = path.join(paths.appRoot, ".snapshot-tmp", bookId);
  try {
    dirtyBooks.delete(bookId);
    const handle = registry.open(bookId);
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });
    // 复制书目录(章节 .md / rules.md / exports 等),再用一致备份覆盖 DB
    fs.cpSync(paths.bookDir(bookId), staging, { recursive: true });
    await handle.workspaceDb.backup(path.join(staging, "workspace.db"));
    // 去掉可能被复制进来的 WAL/SHM(否则可能把撕裂的 WAL 回放到一致的主库上)
    for (const sfx of ["-wal", "-shm"]) {
      fs.rmSync(path.join(staging, `workspace.db${sfx}`), { force: true });
    }
    await createSnapshot({ srcDir: staging, outDir: paths.bookBackupsDir(bookId) });
    await pruneSnapshots(paths.bookBackupsDir(bookId));
  } catch (e) {
    console.error(`自动快照失败(${bookId}):`, (e as Error).message);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}
const snapshotScheduler = createSnapshotScheduler({ doSnapshot });

const port = Number(process.env.PORT ?? config.port);
const app = createApp({
  bookRegistry: registry,
  appPaths: paths,
  configJsonPath: paths.configJson,
  secretsEnvPath: paths.secretsEnv,
  budgetLimitUsd: config.singleBudgetUsd,
  modelManager,
  onChapterCommitted: (bookId) => {
    dirtyBooks.add(bookId);
    snapshotScheduler.onChapterCommitted(bookId);
  },
});
// 周期快照只覆盖"有改动"的书,而非所有曾被打开/浏览过的书
snapshotScheduler.start(() => [...dirtyBooks]);

const server = serve({ fetch: app.fetch, port, hostname: "127.0.0.1" });
console.log(`scribe server listening at http://127.0.0.1:${port}`);
console.log(
  activeKey
    ? `供应商 ${config.provider},已加载 API Key,写作模型 ${config.writeModelId},审查模型 ${config.auditModelId}`
    : `供应商 ${config.provider},尚未配置 API Key,可在前端「设置」页录入`,
);

const cleanup = () => {
  console.log("\nshutting down...");
  snapshotScheduler.stop();
  registry.closeAll();
  server.close();
  process.exit(0);
};
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
