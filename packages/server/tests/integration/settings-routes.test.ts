import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createBookRegistry } from "../../src/http/book-registry.js";
import { createApp } from "../../src/http/server.js";
import { createModelManager } from "../../src/ai/model-manager.js";
import { loadSecrets, saveSecret, maskKey, providerSecretName } from "../../src/config/secrets.js";

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

    // secrets.env 落盘:默认供应商为 AnyRouter
    expect(loadSecrets(paths.secretsEnv).ANYROUTER_API_KEY).toBe("sk-test1234567890abcd");
    // manager 热生效
    expect(mm.getModel()).toBeDefined();
  });

  it("DeepSeek 作为可选供应商时 key 写入 DeepSeek secret", async () => {
    const { app, mm, paths } = makeApp();
    const put = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "deepseek", apiKey: "sk-deepseek123456" }),
    });
    expect(put.status).toBe(200);
    expect(mm.getState().provider).toBe("deepseek");
    expect(loadSecrets(paths.secretsEnv).DEEPSEEK_API_KEY).toBe("sk-deepseek123456");
    expect(loadSecrets(paths.secretsEnv).ANYROUTER_API_KEY).toBeUndefined();
  });

  it("returns masked key status per provider", async () => {
    const { app, paths } = makeApp();
    saveSecret(paths.secretsEnv, "ANYROUTER_API_KEY", "sk-anyrouter11112222");
    saveSecret(paths.secretsEnv, "DEEPSEEK_API_KEY", "sk-deepseek33334444");

    const get = await app.request("/api/settings");
    const j = await get.json() as {
      providerKeys: Record<string, { hasApiKey: boolean; apiKeyMasked: string | null }>;
    };

    const anyrouter = j.providerKeys.anyrouter;
    const deepseek = j.providerKeys.deepseek;
    expect(anyrouter).toBeDefined();
    expect(deepseek).toBeDefined();
    expect(anyrouter!.hasApiKey).toBe(true);
    expect(anyrouter!.apiKeyMasked).toContain("****");
    expect(deepseek!.hasApiKey).toBe(true);
    expect(deepseek!.apiKeyMasked).toContain("****");
    expect(JSON.stringify(j)).not.toContain("anyrouter11112222");
    expect(JSON.stringify(j)).not.toContain("deepseek33334444");
  });

  it("supports a user-defined OpenAI-compatible provider with its own secret", async () => {
    const { app, mm, paths } = makeApp();
    const customProviders = [{
      id: "my-openai",
      name: "My OpenAI Proxy",
      type: "openai-compatible",
      baseUrl: "https://proxy.example.com/v1",
      auth: "bearer",
      defaultWriteModelId: "custom-write-model",
      defaultAuditModelId: "custom-audit-model",
    }];

    const put = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "my-openai",
        customProviders,
        apiKey: "sk-custom123456789",
        writeModelId: "custom-write-model",
        auditModelId: "custom-audit-model",
      }),
    });

    expect(put.status).toBe(200);
    const j = await put.json() as {
      provider: string;
      customProviders: typeof customProviders;
      hasApiKey: boolean;
      apiKeyMasked: string;
    };
    expect(j.provider).toBe("my-openai");
    expect(j.customProviders).toEqual(customProviders);
    expect(j.hasApiKey).toBe(true);
    expect(j.apiKeyMasked).not.toContain("custom123456789");
    expect(loadSecrets(paths.secretsEnv)[providerSecretName("my-openai")]).toBe("sk-custom123456789");
    expect(loadSecrets(paths.secretsEnv).ANYROUTER_API_KEY).toBeUndefined();
    expect(mm.getState().provider).toBe("my-openai");
    expect(mm.getState().customProviders).toEqual(customProviders);
    expect(mm.getModel()).toBeDefined();

    const get = await app.request("/api/settings");
    const persisted = await get.json() as { provider: string; customProviders: typeof customProviders };
    expect(persisted.provider).toBe("my-openai");
    expect(persisted.customProviders).toEqual(customProviders);
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

  it("persists editable global style references in settings", async () => {
    const { app } = makeApp();
    const styleReferences = [
      { id: "style-soft", name: "柔和散文", content: "句子舒缓,少用口号式总结。" },
      { id: "style-hard", name: "冷硬纪实", content: "动作清楚,少形容词。" },
    ];

    await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ styleReferences }),
    });

    const get = await app.request("/api/settings");
    const j = await get.json() as { styleReferences: typeof styleReferences };
    expect(j.styleReferences).toEqual(styleReferences);
  });

  it("persists the selected style reference per book", async () => {
    const { app } = makeApp();
    await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        styleReferences: [
          { id: "style-soft", name: "柔和散文", content: "句子舒缓。" },
        ],
      }),
    });
    const created = await app.request("/api/books", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "文风测试" }),
    });
    const book = await created.json() as { id: string };

    const put = await app.request(`/api/books/${book.id}/style-reference`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selectedId: "style-soft" }),
    });
    expect(put.status).toBe(200);

    const get = await app.request(`/api/books/${book.id}/style-reference`);
    const j = await get.json() as { selectedId: string; references: Array<{ id: string }> };
    expect(j.selectedId).toBe("style-soft");
    expect(j.references.map((item) => item.id)).toContain("style-soft");
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
