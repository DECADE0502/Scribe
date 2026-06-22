import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createBookRegistry } from "../../src/http/book-registry.js";
import { createApp } from "../../src/http/server.js";

let tmp: string;
let registry: ReturnType<typeof createBookRegistry>;
let app: ReturnType<typeof createApp>;
const TOKEN = "test-session-token-abcdef123456";

function makePaths(root: string) {
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
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scribe-sec-"));
  const paths = makePaths(tmp);
  fs.mkdirSync(paths.booksDir, { recursive: true });
  registry = createBookRegistry({ paths });
  app = createApp({ bookRegistry: registry, sessionToken: TOKEN });
});

afterEach(() => {
  registry.closeAll();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const mk = (title: string) => JSON.stringify({ title });

describe("本地会话令牌安全(启用 sessionToken 时)", () => {
  it("GET 读接口无需令牌", async () => {
    expect((await app.request("/api/books")).status).toBe(200);
  });

  it("写接口缺令牌 → 403", async () => {
    const res = await app.request("/api/books", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: mk("无令牌"),
    });
    expect(res.status).toBe(403);
  });

  it("写接口带正确令牌 → 放行", async () => {
    const res = await app.request("/api/books", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Scribe-Session": TOKEN },
      body: mk("有令牌"),
    });
    expect(res.status).toBe(201);
  });

  it("跨站 Origin(非 localhost)即使带令牌也 → 403", async () => {
    const res = await app.request("/api/books", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Scribe-Session": TOKEN, "Origin": "https://evil.example.com" },
      body: mk("恶意来源"),
    });
    expect(res.status).toBe(403);
  });

  it("localhost Origin + 令牌 → 放行", async () => {
    const res = await app.request("/api/books", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Scribe-Session": TOKEN, "Origin": "http://localhost:5173" },
      body: mk("本地来源"),
    });
    expect(res.status).toBe(201);
  });

  it("不传 sessionToken 时不启用(测试默认行为不变)", async () => {
    const open = createApp({ bookRegistry: registry });
    const res = await open.request("/api/books", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: mk("无防护"),
    });
    expect(res.status).toBe(201);
  });
});
