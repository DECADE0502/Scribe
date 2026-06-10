import * as fs from "node:fs";
import { serve } from "@hono/node-server";
import { resolveAppPaths } from "./config/paths.js";
import { loadConfig } from "./config/load.js";
import { loadSecrets } from "./config/secrets.js";
import { createModelManager } from "./ai/model-manager.js";
import { createBookRegistry } from "./http/book-registry.js";
import { createApp } from "./http/server.js";

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

const port = Number(process.env.PORT ?? config.port);
const app = createApp({
  bookRegistry: registry,
  appPaths: paths,
  configJsonPath: paths.configJson,
  secretsEnvPath: paths.secretsEnv,
  budgetLimitUsd: config.singleBudgetUsd,
  modelManager,
});

const server = serve({ fetch: app.fetch, port, hostname: "127.0.0.1" });
console.log(`scribe server listening at http://127.0.0.1:${port}`);
console.log(
  secrets.DEEPSEEK_API_KEY
    ? `已加载 DeepSeek API Key,写作模型 ${config.writeModelId},审查模型 ${config.auditModelId}`
    : "尚未配置 API Key,可在前端「设置」页录入",
);

const cleanup = () => {
  console.log("\nshutting down...");
  registry.closeAll();
  server.close();
  process.exit(0);
};
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
