import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createBookRegistry } from "../../src/http/book-registry.js";
import { createApp } from "../../src/http/server.js";
import type { AppPaths } from "../../src/config/paths.js";

let tmp: string;
let registry: ReturnType<typeof createBookRegistry>;
let app: ReturnType<typeof createApp>;
let appPaths: AppPaths;

function makePaths(root: string): AppPaths {
  return {
    appRoot: root,
    libraryDb: path.posix.join(root, "library.db"),
    booksDir: path.posix.join(root, "books"),
    backupsDir: path.posix.join(root, "backups"),
    secretsEnv: path.posix.join(root, "secrets.env"),
    configJson: path.posix.join(root, "config.json"),
    bookDir: (id: string) => path.posix.join(root, "books", id),
    workspaceDb: (id: string) => path.posix.join(root, "books", id, "workspace.db"),
    chaptersDir: (id: string) => path.posix.join(root, "books", id, "chapters"),
    rulesMd: (id: string) => path.posix.join(root, "books", id, "rules.md"),
    exportsDir: (id: string) => path.posix.join(root, "books", id, "exports"),
    bookBackupsDir: (id: string) => path.posix.join(root, "backups", id),
  };
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scribe-p10-"));
  appPaths = makePaths(tmp);
  fs.mkdirSync(appPaths.booksDir, { recursive: true });
  registry = createBookRegistry({ paths: appPaths });
  app = createApp({ bookRegistry: registry, appPaths, configJsonPath: appPaths.configJson });
});

afterEach(() => {
  registry.closeAll();
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function setupBookWithChapter(): Promise<string> {
  const res = await app.request("/api/books", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "收尾测试" }),
  });
  const { id } = await res.json() as { id: string };
  await app.request(`/api/books/${id}/chapters/1`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: "# 第一章\n\n**原始**正文内容。", title: "第一章" }),
  });
  return id;
}

describe("快照路由", () => {
  it("创建 → 列出 → 改坏 → 恢复(数据复原)", async () => {
    const id = await setupBookWithChapter();
    // 创建快照
    const create = await app.request(`/api/books/${id}/snapshots/create`, { method: "POST" });
    expect(create.status).toBe(201);

    // 列出
    const list = await app.request(`/api/books/${id}/snapshots`);
    const lj = await list.json() as { snapshots: Array<{ filename: string; sizeBytes: number }> };
    expect(lj.snapshots).toHaveLength(1);
    expect(lj.snapshots[0]!.sizeBytes).toBeGreaterThan(0);

    // 改坏 .md
    const mdPath = path.posix.join(appPaths.chaptersDir(id), "0001.md");
    fs.writeFileSync(mdPath, "已被改坏", "utf-8");

    // 不带确认词 → 400
    const noConfirm = await app.request(`/api/books/${id}/snapshots/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: lj.snapshots[0]!.filename }),
    });
    expect(noConfirm.status).toBe(400);

    // 正确恢复
    const restore = await app.request(`/api/books/${id}/snapshots/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: lj.snapshots[0]!.filename, confirmText: "RESTORE" }),
    });
    expect(restore.status).toBe(200);
    // .md 复原
    const restored = fs.readFileSync(mdPath, "utf-8");
    expect(restored).toContain("原始");
    // SQLite 重新可用
    const handle = registry.open(id);
    expect(handle.chaptersRepo.listVersions(1)).toHaveLength(1);
  });

  it("非法文件名 400;不存在快照 404", async () => {
    const id = await setupBookWithChapter();
    const bad = await app.request(`/api/books/${id}/snapshots/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "../../../etc/passwd", confirmText: "RESTORE" }),
    });
    expect(bad.status).toBe(400);
    const missing = await app.request(`/api/books/${id}/snapshots/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "20990101-0000.tar.gz", confirmText: "RESTORE" }),
    });
    expect(missing.status).toBe(404);
  });
});

describe("导出路由", () => {
  it("全书 .md 导出 + 下载", async () => {
    const id = await setupBookWithChapter();
    await app.request(`/api/books/${id}/chapters/2`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "第二章正文", title: "第二章" }),
    });
    const exp = await app.request(`/api/books/${id}/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format: "md" }),
    });
    expect(exp.status).toBe(200);
    const ej = await exp.json() as { filename: string };
    expect(ej.filename).toContain("全书");
    expect(ej.filename.endsWith(".md")).toBe(true);

    const dl = await app.request(`/api/books/${id}/exports/${encodeURIComponent(ej.filename)}`);
    expect(dl.status).toBe(200);
    const text = await dl.text();
    expect(text).toContain("# 收尾测试");
    expect(text).toContain("## 第 1 章 第一章");
    expect(text).toContain("## 第 2 章 第二章");
    expect(text.indexOf("第 1 章")).toBeLessThan(text.indexOf("第 2 章"));
  });

  it("单章 .txt 导出剥 markdown", async () => {
    const id = await setupBookWithChapter();
    const exp = await app.request(`/api/books/${id}/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format: "txt", chapter: 1 }),
    });
    const ej = await exp.json() as { filename: string };
    expect(ej.filename).toContain("第1章");
    const dl = await app.request(`/api/books/${id}/exports/${encodeURIComponent(ej.filename)}`);
    const text = await dl.text();
    expect(text).toContain("原始正文内容");
    expect(text).not.toContain("**");
    expect(text).not.toContain("# 第一章"); // 标题标记被剥掉
  });

  it("空书导出 400;下载路径穿越 400", async () => {
    const res = await app.request("/api/books", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "空书" }),
    });
    const { id } = await res.json() as { id: string };
    const exp = await app.request(`/api/books/${id}/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format: "md" }),
    });
    expect(exp.status).toBe(400);

    const evil = await app.request(`/api/books/${id}/exports/..%2F..%2Fsecrets.env`);
    expect([400, 404]).toContain(evil.status);
  });
});
