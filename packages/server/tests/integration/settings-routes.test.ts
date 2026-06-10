import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createBookRegistry } from "../../src/http/book-registry.js";
import { createApp } from "../../src/http/server.js";
import { createModelManager } from "../../src/ai/model-manager.js";
import { loadSecrets, saveSecret, maskKey } from "../../src/config/secrets.js";

let tmp: string;
let registry: ReturnType<typeof createBookRegistry>;

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
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scribe-settings-"));
  const paths = makePaths(tmp);
  fs.mkdirSync(paths.booksDir, { recursive: true });
  registry = createBookRegistry({ paths });
});

afterEach(() => {
  registry.closeAll();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("secrets 工具", () => {
  it("load/save 往返,保留其它行", () => {
    const p = path.posix.join(tmp, "secrets.env");
    saveSecret(p, "DEEPSEEK_API_KEY", "sk-abc123");
    saveSecret(p, "OTHER", "v");
    expect(loadSecrets(p)).toEqual({ DEEPSEEK_API_KEY: "sk-abc123", OTHER: "v" });
    saveSecret(p, "DEEPSEEK_API_KEY", "sk-new");
    expect(loadSecrets(p).DEEPSEEK_API_KEY).toBe("sk-new");
    expect(loadSecrets(p).OTHER).toBe("v");
  });

  it("maskKey 打码", () => {
    expect(maskKey("sk-2219acd344d0466d9438ab65f62d189f")).toBe("sk-22****189f");
    expect(maskKey("short")).toBe("****");
  });
});

describe("settings 路由(含 API key + 模型)", () => {
  function makeApp() {
    const paths = makePaths(tmp);
    const mm = createModelManager({ apiKey: null });
    return {
      app: createApp({
        bookRegistry: registry,
        configJsonPath: paths.configJson,
        secretsEnvPath: paths.secretsEnv,
        modelManager: mm,
      }),
      mm,
      paths,
    };
  }

  it("初始无 key:hasApiKey=false;PUT key 后打码返回 + secrets.env 落盘 + manager 热生效", async () => {
    const { app, mm, paths } = makeApp();
    const get1 = await app.request("/api/settings");
    const j1 = await get1.json() as { hasApiKey: boolean };
    expect(j1.hasApiKey).toBe(false);
    expect(mm.getModel()).toBeUndefined();

    const put = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: "sk-test1234567890abcd" }),
    });
    const j2 = await put.json() as { hasApiKey: boolean; apiKeyMasked: string };
    expect(j2.hasApiKey).toBe(true);
    expect(j2.apiKeyMasked).toContain("****");
    expect(j2.apiKeyMasked).not.toContain("test1234567890");

    // secrets.env 落盘
    expect(loadSecrets(paths.secretsEnv).DEEPSEEK_API_KEY).toBe("sk-test1234567890abcd");
    // manager 热生效
    expect(mm.getModel()).toBeDefined();
  });

  it("PUT 模型 ID 持久化 + manager 同步", async () => {
    const { app, mm } = makeApp();
    await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ writeModelId: "deepseek-v5-max", auditModelId: "deepseek-v5-mini" }),
    });
    const get = await app.request("/api/settings");
    const j = await get.json() as { writeModelId: string; auditModelId: string };
    expect(j.writeModelId).toBe("deepseek-v5-max");
    expect(j.auditModelId).toBe("deepseek-v5-mini");
    expect(mm.getState().writeModelId).toBe("deepseek-v5-max");
  });

  it("GET /api/models 无 key 时 503 + 中文提示", async () => {
    const { app } = makeApp();
    const res = await app.request("/api/models");
    expect(res.status).toBe(503);
    const j = await res.json() as { error: string };
    expect(j.error).toContain("API Key");
  });

  it("GET /api/settings 永不返回明文 key", async () => {
    const { app } = makeApp();
    await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: "sk-supersecret999888777" }),
    });
    const get = await app.request("/api/settings");
    const text = JSON.stringify(await get.json());
    expect(text).not.toContain("supersecret");
  });
});
