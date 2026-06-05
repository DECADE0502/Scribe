// 把 src/db/migrations/**/*.sql 复制到 dist/db/migrations/ 下,保持目录结构。
// tsc 不会复制非 .ts 文件,生产 `node dist/main.js` 启动时 readdirSync 找不到 SQL 会 ENOENT。
// 跨平台 Node 实现,免得在 Windows 上依赖 cp -r。
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(__dirname, "..", "src", "db", "migrations");
const distRoot = path.resolve(__dirname, "..", "dist", "db", "migrations");

function copyDir(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDir(s, d);
    } else if (entry.isFile() && entry.name.endsWith(".sql")) {
      fs.copyFileSync(s, d);
    }
  }
}

copyDir(srcRoot, distRoot);
