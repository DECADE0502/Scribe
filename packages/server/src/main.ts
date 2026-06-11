import * as fs from "node:fs";
import { serve } from "@hono/node-server";
import { resolveAppPaths } from "./config/paths.js";
import { loadConfig } from "./config/load.js";
import { loadSecrets } from "./config/secrets.js";
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

const modelManager = createModelManager({
  apiKey: secrets.DEEPSEEK_API_KEY ?? null,
  writeModelId: config.writeModelId,
  auditModelId: config.auditModelId,
});

// 自动快照备份(spec §3.4):周期 6 小时 + 累计 5 章触发。
// 背景备份不关闭连接(避免打断进行中的写作),而是先做 WAL checkpoint
// 把数据落进主库文件,再连同 .md 一起打包 —— SQLite 设计上 db+wal 同时
// 拷贝可得到可恢复状态,对本地单用户备份足够安全。
async function doSnapshot(bookId: string): Promise<void> {
  try {
    const handle = registry.open(bookId);
    try { handle.workspaceDb.pragma("wal_checkpoint(TRUNCATE)"); } catch { /* 忽略 checkpoint 失败 */ }
    await createSnapshot({
      srcDir: paths.bookDir(bookId),
      outDir: paths.bookBackupsDir(bookId),
    });
    await pruneSnapshots(paths.bookBackupsDir(bookId));
  } catch (e) {
    console.error(`自动快照失败(${bookId}):`, (e as Error).message);
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
  onChapterCommitted: (bookId) => snapshotScheduler.onChapterCommitted(bookId),
});
snapshotScheduler.start(() => registry.openBookIds());

const server = serve({ fetch: app.fetch, port, hostname: "127.0.0.1" });
console.log(`scribe server listening at http://127.0.0.1:${port}`);
console.log(
  secrets.DEEPSEEK_API_KEY
    ? `已加载 DeepSeek API Key,写作模型 ${config.writeModelId},审查模型 ${config.auditModelId}`
    : "尚未配置 API Key,可在前端「设置」页录入",
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
