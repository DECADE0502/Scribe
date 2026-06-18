# Scribe(小说引擎)实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 `docs/superpowers/specs/2026-06-04-novel-engine-design.md` 落地 Scribe MVP —— 一个对话式本地 Web 小说创作引擎,跑在 Node.js,带 DeepSeek + 三栏 UI + 防漂移防 OOC 机制。

**Architecture:** 单 Node 进程 + 浏览器 UI;Hono HTTP + SSE 流式;Vercel AI SDK 抽象 LLM;better-sqlite3 元数据 + .md 章节正文;前端 Vite + React + TipTap;全栈 TypeScript,共享 Zod schema。

**Tech Stack:** TypeScript / Node.js 20+ / Hono / better-sqlite3 / Vercel AI SDK (`ai` + `@ai-sdk/openai-compatible`) / Zod / Vite / React 18 / TipTap / Zustand / pino / Vitest / Playwright。

**全文规约:**
- **UI 全中文**(包括按钮、菜单、错误提示、空状态文案)
- 每个 Task 都有自测步骤(单元测试 + 集成测试),无测试不算完成
- 测试用 Vitest,E2E 用 Playwright
- 每个 Task 完成后必须 commit,commit message 用中文动词开头(如"添加 X / 修复 Y")
- 路径使用 POSIX 风格(`/`),Windows 上 Node fs 自动处理
- 项目代号 `scribe`,根目录 `D:/DESKTOP/Scribe/`

**参考项目对照(实现时随时查阅):**

| 我们的功能 | ainovel-cli 参考点 | CharacterArc 参考点 |
|---|---|---|
| Provider Adapter | `internal/bootstrap/models.go` 错误分类 | `electron/main/ai/provider.ts` `createModel` + `providerSupportsTools` |
| Context Builder | `internal/tools/novel_context.go:91-121` 预算+裁剪 | `electron/main/ai/runtime/context-builder.ts` |
| 章节召回 | `internal/tools/novel_context_builders.go` 四维评分 | `electron/main/ai/knowledge-retrieval.ts` 双轨 |
| Audit + Repair | `internal/diag/rules_quality.go` 7 维 | `electron/main/ai/tasks/chapter-assistant.ts` audit/repair |
| Tool Use 状态更新 | `internal/tools/commit_chapter.go` checkpoint | `electron/main/ai/agent/run-agent.ts` `tools` 参数 |
| 摘要生成 | `internal/tools/save_arc_summary.go` | `chapter-summary` 任务 |
| 流式输出 | `internal/host/stream_extract.go` | IPC `characterarc:ai-stream-event` |
| 状态机(自动模式) | `internal/domain/transitions.go` Phase × Flow | 无 |
| Token 用量 | `internal/host/usage.go` per-message + autosave | 无 |
| 三栏布局 | 无 | `renderer/src/components/chapterWorkspace/` |
| 富文本 + 选段改写 | 无 | TipTap + `editorContent.ts` |
| 风格字典 | `rules.md.example` forbidden_phrases | `community-skills/humanizer-zh/SKILL.md` 替换字典 |
| Skill 系统 | 无 | `electron/main/ai/skills/` 整套(我们不抄,但理解) |

**实现阶段总览(对应 spec §12):**

| 阶段 | 名称 | Tasks | 交付物 |
|---|---|---|---|
| 0 | 项目骨架 | T0.1 - T0.5 | 仓库就绪、依赖装好、Vitest 跑得通、空 server 启得起来 |
| 1 | 数据层 | T1.1 - T1.6 | SQLite schema、章节文件 IO、备份调度、Zod 类型 |
| 2 | DeepSeek Adapter | T2.1 - T2.5 | Provider 接口、DS adapter、模型列表实时拉取、错误分类、Token 追踪 |
| 3 | 简单写作链路 | T3.1 - T3.5 | 对话 API + SSE、写一章、存 SQLite + .md(无 audit/无召回) |
| 4 | Audit + Summarize | T4.1 - T4.5 | 7 维审查、三层摘要、Tool Use 状态更新 |
| 5 | Context Builder + 召回 | T5.1 - T5.4 | 完整 prompt 组装、章节召回、prompt cache 优化 |
| 6 | 题材板块 AI 自创 | T6.1 - T6.4 | `create_genre_section` 等 5 个工具、UI 双向 |
| 7 | 新建书对话流程 | T7.1 - T7.3 | 引导对话 + 信息够判定 + 跳过 |
| 8 | 前端三栏 UI | T8.1 - T8.8 | 书架页、工作台三栏、TipTap、选段改写、斜杠命令 |
| 9 | 自动模式 + 撤销 + 用量 | T9.1 - T9.4 | `/auto N` 状态机、章节版本、用量明细 |
| 10 | 备份 + 导出 + 收尾 | T10.1 - T10.4 | 快照、`.txt`/`.md` 导出、错误处理打磨、E2E |

---

<!-- ANCHOR-CONTENT-BEGINS-HERE -->

## 文件结构(规划)

完整目录(每个文件的职责),分两栏 server 和 client:

```
scribe/
├── package.json              # workspaces: server, client, shared
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .gitignore                # 忽略 node_modules, secrets, dist, .scribe-data
├── README.md                 # 启动说明(中文)
│
├── packages/
│   ├── shared/                       # 前后端共享类型/Zod schema
│   │   ├── src/
│   │   │   ├── types/
│   │   │   │   ├── book.ts           # Book / BookMeta
│   │   │   │   ├── character.ts      # Character + Zod
│   │   │   │   ├── chapter.ts        # Chapter / ChapterVersion / Summary
│   │   │   │   ├── outline.ts
│   │   │   │   ├── foreshadowing.ts
│   │   │   │   ├── timeline.ts
│   │   │   │   ├── genre-section.ts  # GenreSection / Field / Item
│   │   │   │   ├── audit.ts          # AuditReport / Severity
│   │   │   │   ├── conversation.ts
│   │   │   │   ├── token-usage.ts
│   │   │   │   ├── intent.ts         # IntentLabel(7 类)
│   │   │   │   └── sse-events.ts     # SSE 事件类型联合
│   │   │   ├── tools/
│   │   │   │   └── tool-schemas.ts   # 所有 AI Tool 的 Zod 入参/出参
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── server/                       # Node 后端
│   │   ├── src/
│   │   │   ├── main.ts               # 入口:加载 config → 启 server → 打开浏览器
│   │   │   ├── config/
│   │   │   │   ├── paths.ts          # 路径解析(~/.config/scribe/...)
│   │   │   │   ├── load.ts           # config.json + secrets.env
│   │   │   │   └── default-config.ts
│   │   │   ├── db/
│   │   │   │   ├── library.ts        # ~/.config/scribe/library.db
│   │   │   │   ├── workspace.ts      # books/<id>/workspace.db
│   │   │   │   ├── migrations/
│   │   │   │   │   ├── 001_init.sql
│   │   │   │   │   └── runner.ts
│   │   │   │   └── repositories/
│   │   │   │       ├── books.ts
│   │   │   │       ├── characters.ts
│   │   │   │       ├── outline.ts
│   │   │   │       ├── foreshadowing.ts
│   │   │   │       ├── timeline.ts
│   │   │   │       ├── genre-sections.ts
│   │   │   │       ├── chapters.ts          # 含 versions, summaries, audits
│   │   │   │       ├── conversations.ts
│   │   │   │       └── token-usage.ts
│   │   │   ├── fs/
│   │   │   │   ├── chapter-files.ts  # .md 章节读写,frontmatter 解析
│   │   │   │   └── snapshot.ts       # tar.gz 备份
│   │   │   ├── ai/
│   │   │   │   ├── providers/
│   │   │   │   │   ├── _interface.ts          # ProviderAdapter
│   │   │   │   │   ├── deepseek.ts            # 第一版唯一实现
│   │   │   │   │   ├── openai-compatible.ts   # OpenAI 协议家族基类
│   │   │   │   │   ├── enrich-from-openrouter.ts
│   │   │   │   │   └── local-model-table.ts
│   │   │   │   ├── prompts/
│   │   │   │   │   ├── system-prompt.ts       # 全局风格定位
│   │   │   │   │   ├── write-chapter.ts
│   │   │   │   │   ├── audit-summarize.ts     # 7 维 + 摘要联合 prompt
│   │   │   │   │   ├── intent-classify.ts
│   │   │   │   │   ├── plan-chapter.ts
│   │   │   │   │   ├── new-book-onboard.ts
│   │   │   │   │   └── repair-chapter.ts
│   │   │   │   ├── context-builder/
│   │   │   │   │   ├── builder.ts             # 主组装器
│   │   │   │   │   ├── recall.ts              # 章节召回评分
│   │   │   │   │   ├── budget.ts              # token 预算与裁剪
│   │   │   │   │   └── snapshot.ts            # 当前书状态快照
│   │   │   │   ├── tools/
│   │   │   │   │   ├── registry.ts            # 工具注册表
│   │   │   │   │   ├── chapter-tools.ts       # plan_chapter, query_active_*, ...
│   │   │   │   │   ├── state-tools.ts         # update_character_state 等
│   │   │   │   │   ├── genre-section-tools.ts # create/update/delete genre sections
│   │   │   │   │   └── book-meta-tools.ts     # set_book_meta, create_character...
│   │   │   │   ├── orchestrator/
│   │   │   │   │   ├── chat.ts                # 普通对话编排
│   │   │   │   │   ├── write-chapter.ts       # 写一章完整流程
│   │   │   │   │   ├── audit-chapter.ts       # 审 + 摘要 + 状态
│   │   │   │   │   ├── revise-segment.ts      # 选段改写
│   │   │   │   │   ├── auto-mode.ts           # /auto N 状态机
│   │   │   │   │   └── new-book.ts            # 新建书对话引导
│   │   │   │   ├── intent/
│   │   │   │   │   ├── classifier.ts          # 7 类意图识别
│   │   │   │   │   └── slash-parser.ts        # 斜杠命令解析(中英 alias)
│   │   │   │   └── usage-tracker.ts           # Token 用量记录
│   │   │   ├── http/
│   │   │   │   ├── server.ts         # Hono app 装配
│   │   │   │   ├── sse.ts            # SSE 通用工具
│   │   │   │   ├── routes/
│   │   │   │   │   ├── books.ts
│   │   │   │   │   ├── chapters.ts
│   │   │   │   │   ├── conversation.ts
│   │   │   │   │   ├── characters.ts
│   │   │   │   │   ├── outline.ts
│   │   │   │   │   ├── foreshadowing.ts
│   │   │   │   │   ├── timeline.ts
│   │   │   │   │   ├── genre-sections.ts
│   │   │   │   │   ├── settings.ts
│   │   │   │   │   ├── models.ts     # 拉模型列表
│   │   │   │   │   ├── snapshots.ts
│   │   │   │   │   └── export.ts
│   │   │   │   └── errors.ts         # 错误分类 → HTTP 状态
│   │   │   ├── jobs/
│   │   │   │   ├── snapshot-scheduler.ts   # 6h + 5 章触发
│   │   │   │   └── model-list-refresh.ts   # 24h 缓存
│   │   │   ├── logger.ts             # pino 配置
│   │   │   └── error-classifier.ts   # 中央错误分类(给 provider 用)
│   │   ├── tests/
│   │   │   ├── unit/                 # 各 module 单测,目录镜像 src
│   │   │   ├── integration/          # 跨 module 集成测
│   │   │   └── fixtures/             # 假 LLM、假数据库、假章节
│   │   └── package.json
│   │
│   └── client/                       # Vite + React 前端
│       ├── index.html
│       ├── vite.config.ts
│       ├── src/
│       │   ├── main.tsx
│       │   ├── App.tsx               # Router
│       │   ├── pages/
│       │   │   ├── library.tsx       # 书架页
│       │   │   ├── workspace.tsx     # 三栏工作台
│       │   │   ├── settings.tsx      # 模型/API key/备份配置
│       │   │   └── new-book.tsx      # 新建书对话页
│       │   ├── components/
│       │   │   ├── conversation/
│       │   │   │   ├── conversation-pane.tsx
│       │   │   │   ├── message.tsx
│       │   │   │   ├── slash-suggestions.tsx
│       │   │   │   └── streaming-message.tsx
│       │   │   ├── editor/
│       │   │   │   ├── chapter-editor.tsx    # TipTap 包装
│       │   │   │   ├── selection-toolbar.tsx # 选段改写浮条
│       │   │   │   └── version-history.tsx
│       │   │   ├── sidebar/
│       │   │   │   ├── side-panel.tsx        # 右栏容器
│       │   │   │   ├── characters-panel.tsx
│       │   │   │   ├── outline-panel.tsx
│       │   │   │   ├── foreshadowing-panel.tsx
│       │   │   │   ├── timeline-panel.tsx
│       │   │   │   ├── rules-panel.tsx
│       │   │   │   └── genre-section-panel.tsx
│       │   │   ├── audit-banner.tsx          # 章末审查结果横幅
│       │   │   └── usage-meter.tsx
│       │   ├── stores/
│       │   │   ├── conversation.ts           # zustand
│       │   │   ├── chapter.ts
│       │   │   ├── book.ts
│       │   │   └── ui.ts
│       │   ├── api/
│       │   │   ├── client.ts                 # fetch + SSE 封装
│       │   │   └── streaming.ts
│       │   ├── i18n/
│       │   │   └── zh-CN.ts                  # 全部 UI 文案
│       │   └── styles/
│       │       └── global.css
│       └── package.json
│
└── e2e/                              # Playwright
    ├── fixtures/
    └── tests/
        ├── library.spec.ts
        ├── new-book.spec.ts
        ├── write-chapter.spec.ts
        └── auto-mode.spec.ts
```

**关键设计原则**:
- `shared` 包不依赖任何 runtime,只导出 type/schema
- `server` 用 dependency injection 风格组织(repository、orchestrator 通过构造函数传依赖,方便测试 mock)
- `client` 用 React 18 + Suspense + Zustand,不用 Redux
- 测试目录镜像源码目录,1:1 对应

---

## 阶段 0:项目骨架

### Task 0.1:monorepo 与依赖管理

**文件:**
- 创建:`package.json`、`pnpm-workspace.yaml`、`tsconfig.base.json`、`.gitignore`、`.npmrc`

- [ ] **步骤 1:写 root `package.json`**

```json
{
  "name": "scribe",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "pnpm -r --parallel run dev",
    "build": "pnpm -r run build",
    "test": "pnpm -r run test",
    "test:e2e": "pnpm --filter scribe-e2e run test",
    "typecheck": "pnpm -r run typecheck"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "@types/node": "^22.0.0"
  },
  "engines": { "node": ">=20.0.0" },
  "packageManager": "pnpm@9.0.0"
}
```

- [ ] **步骤 2:写 `pnpm-workspace.yaml`**

```yaml
packages:
  - "packages/*"
  - "e2e"
```

- [ ] **步骤 3:写 `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": false
  }
}
```

- [ ] **步骤 4:写 `.gitignore`**

```
node_modules/
dist/
.scribe-data/
*.log
.env
.env.local
secrets.env
.vite/
playwright-report/
test-results/
```

- [ ] **步骤 5:写 `.npmrc`**(锁版本到 lockfile)

```
strict-peer-dependencies=false
auto-install-peers=true
```

- [ ] **步骤 6:验证**

```bash
pnpm install
```
预期:无报错,生成 `node_modules` 和 `pnpm-lock.yaml`。

- [ ] **步骤 7:初始化 git 并提交**

```bash
git init
git add .
git commit -m "初始化 monorepo 骨架"
```

---

### Task 0.2:shared 包(类型与 Zod schema 骨架)

**文件:**
- 创建:`packages/shared/package.json`、`packages/shared/tsconfig.json`、`packages/shared/src/index.ts`、`packages/shared/tests/smoke.test.ts`

- [ ] **步骤 1:`packages/shared/package.json`**

```json
{
  "name": "@scribe/shared",
  "version": "0.0.1",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "vitest": "^2.1.0",
    "typescript": "^5.6.0"
  }
}
```

- [ ] **步骤 2:`packages/shared/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **步骤 3:写失败测试 `packages/shared/tests/smoke.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { ProjectName, smokeTest } from "../src/index.js";

describe("shared smoke", () => {
  it("项目名为 scribe", () => {
    expect(ProjectName).toBe("scribe");
  });
  it("smokeTest 返回 ok", () => {
    expect(smokeTest()).toBe("ok");
  });
});
```

- [ ] **步骤 4:运行测试,验证失败**

```bash
pnpm --filter @scribe/shared test
```
预期:FAIL,因为 `index.ts` 不存在。

- [ ] **步骤 5:写最小实现 `packages/shared/src/index.ts`**

```ts
export const ProjectName = "scribe";
export function smokeTest(): "ok" {
  return "ok";
}
```

- [ ] **步骤 6:运行测试,验证通过**

```bash
pnpm --filter @scribe/shared test
```
预期:PASS,2 测试。

- [ ] **步骤 7:commit**

```bash
git add packages/shared
git commit -m "添加 shared 包基础结构"
```

---

### Task 0.3:server 包骨架 + Hono hello world

**文件:**
- 创建:`packages/server/package.json`、`packages/server/tsconfig.json`、`packages/server/src/main.ts`、`packages/server/src/http/server.ts`、`packages/server/tests/unit/http/server.test.ts`

- [ ] **步骤 1:写 `packages/server/package.json`**(声明依赖 Hono / @hono/node-server / better-sqlite3 / ai / @ai-sdk/openai-compatible / zod / pino / tar / gray-matter,以及 dev 依赖 tsx / vitest / @types/better-sqlite3 / @types/tar)

- [ ] **步骤 2:写 `packages/server/tsconfig.json`**(`extends: "../../tsconfig.base.json"`、`outDir: "dist"`、`rootDir: "src"`、`include: ["src/**/*", "tests/**/*"]`)

- [ ] **步骤 3:写失败测试 `packages/server/tests/unit/http/server.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { createApp } from "../../../src/http/server.js";

describe("HTTP server smoke", () => {
  it("GET /api/health 返回 ok", async () => {
    const app = createApp();
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", name: "scribe" });
  });
});
```

- [ ] **步骤 4:运行 `pnpm --filter @scribe/server test`,预期 FAIL(模块不存在)**

- [ ] **步骤 5:实现 `packages/server/src/http/server.ts`**

```ts
import { Hono } from "hono";

export function createApp() {
  const app = new Hono();
  app.get("/api/health", (c) => c.json({ status: "ok", name: "scribe" }));
  return app;
}
```

- [ ] **步骤 6:实现 `packages/server/src/main.ts`**

```ts
import { serve } from "@hono/node-server";
import { createApp } from "./http/server.js";

const port = Number(process.env.PORT ?? 6789);
serve({ fetch: createApp().fetch, port, hostname: "127.0.0.1" });
console.log(`scribe server listening at http://127.0.0.1:${port}`);
```

- [ ] **步骤 7:`pnpm install && pnpm --filter @scribe/server test && pnpm --filter @scribe/server typecheck` 全绿**

- [ ] **步骤 8:commit**

```bash
git add packages/server
git commit -m "添加 server 包骨架与健康检查接口"
```

---

### Task 0.4:client 包骨架 + Vite + React + i18n 文件

**文件:**
- 创建:`packages/client/package.json`、`packages/client/vite.config.ts`、`packages/client/tsconfig.json`、`packages/client/index.html`、`packages/client/src/main.tsx`、`packages/client/src/App.tsx`、`packages/client/src/i18n/zh-CN.ts`、`packages/client/tests/smoke.test.tsx`

- [ ] **步骤 1:`packages/client/package.json`**(依赖 react / react-dom / zustand / @scribe/shared;dev 依赖 vite / @vitejs/plugin-react / typescript / vitest / @testing-library/react / @testing-library/jest-dom / jsdom / @types/react / @types/react-dom)

- [ ] **步骤 2:`packages/client/vite.config.ts`** —— 注册 `@vitejs/plugin-react`,`server.port: 5173`,`server.proxy: { "/api": "http://127.0.0.1:6789", "/sse": "http://127.0.0.1:6789" }`,Vitest 配 `environment: "jsdom"`、`globals: true`

- [ ] **步骤 3:`packages/client/tsconfig.json`** —— extends base,`jsx: "react-jsx"`、`lib: ["ES2022", "DOM", "DOM.Iterable"]`、`include: ["src/**/*", "tests/**/*"]`

- [ ] **步骤 4:`packages/client/index.html`**(挂 `#root`,标题 `<title>Scribe 小说引擎</title>`,`<html lang="zh-CN">`,引入 `/src/main.tsx`)

- [ ] **步骤 5:写 i18n 文件 `packages/client/src/i18n/zh-CN.ts`**(占位骨架,后续 Task 8.1 全量补全)

```ts
export const zhCN = {
  app: { title: "Scribe 小说引擎", loading: "加载中..." },
  library: { newBook: "新建书", emptyHint: "还没有作品,点上方按钮新建一本" },
  common: { confirm: "确认", cancel: "取消", save: "保存", delete: "删除", retry: "重试" },
} as const;
export type I18n = typeof zhCN;
export const t = zhCN;
```

- [ ] **步骤 6:写失败测试 `packages/client/tests/smoke.test.tsx`**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { App } from "../src/App.js";

describe("App smoke", () => {
  it("渲染应用标题", () => {
    render(<App />);
    expect(screen.getByText(/Scribe 小说引擎/)).toBeInTheDocument();
  });
});
```

- [ ] **步骤 7:`pnpm --filter @scribe/client test` 预期 FAIL**

- [ ] **步骤 8:实现 `App.tsx`**

```tsx
import { t } from "./i18n/zh-CN.js";
export function App() {
  return <div><h1>{t.app.title}</h1></div>;
}
```

- [ ] **步骤 9:实现 `main.tsx`**(`createRoot(document.getElementById("root")!).render(<App />)`)

- [ ] **步骤 10:加测试 setup `packages/client/tests/setup.ts` 引 `@testing-library/jest-dom`,在 vite.config.ts 的 test 配 `setupFiles: ["./tests/setup.ts"]`**

- [ ] **步骤 11:测试 + typecheck 全绿,commit**

```bash
git add packages/client
git commit -m "添加 client 包骨架与首屏渲染"
```

---

### Task 0.5:e2e 包骨架 + Playwright dummy spec

**文件:**
- 创建:`e2e/package.json`、`e2e/playwright.config.ts`、`e2e/tests/smoke.spec.ts`

- [ ] **步骤 1:`e2e/package.json`**

```json
{
  "name": "scribe-e2e",
  "version": "0.0.1",
  "type": "module",
  "private": true,
  "scripts": {
    "test": "playwright test",
    "install-browsers": "playwright install chromium"
  },
  "devDependencies": {
    "@playwright/test": "^1.48.0",
    "typescript": "^5.6.0"
  }
}
```

- [ ] **步骤 2:`e2e/playwright.config.ts`**

```ts
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  use: { baseURL: "http://127.0.0.1:6789", locale: "zh-CN" },
  reporter: [["list"], ["html", { open: "never" }]],
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
```

- [ ] **步骤 3:写 dummy spec `e2e/tests/smoke.spec.ts`**

```ts
import { test, expect } from "@playwright/test";

test("dummy:确保 Playwright 装好且能跑", async () => {
  // 不依赖真实 server,纯环境验证
  expect(1 + 1).toBe(2);
});
```

- [ ] **步骤 4:`pnpm install && pnpm --filter scribe-e2e exec playwright install chromium`**

- [ ] **步骤 5:`pnpm test:e2e`**,预期通过 1 个 spec

- [ ] **步骤 6:commit**

```bash
git add e2e
git commit -m "添加 e2e 包骨架与 Playwright 配置"
```

---

## 阶段 1:数据层

### Task 1.1:跨平台路径配置

**文件:**
- 创建:`packages/server/src/config/paths.ts`、`packages/server/tests/unit/config/paths.test.ts`

- [ ] **步骤 1:写失败测试 `paths.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as os from "node:os";
import { resolveAppPaths } from "../../../src/config/paths.js";

describe("resolveAppPaths", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("Linux:使用 ~/.config/scribe", () => {
    vi.spyOn(os, "platform").mockReturnValue("linux");
    vi.spyOn(os, "homedir").mockReturnValue("/home/u");
    const p = resolveAppPaths({ env: {} });
    expect(p.appRoot).toBe("/home/u/.config/scribe");
    expect(p.libraryDb).toBe("/home/u/.config/scribe/library.db");
    expect(p.booksDir).toBe("/home/u/.config/scribe/books");
    expect(p.backupsDir).toBe("/home/u/.config/scribe/backups");
    expect(p.secretsEnv).toBe("/home/u/.config/scribe/secrets.env");
  });

  it("macOS:使用 ~/Library/Application Support/scribe", () => {
    vi.spyOn(os, "platform").mockReturnValue("darwin");
    vi.spyOn(os, "homedir").mockReturnValue("/Users/u");
    expect(resolveAppPaths({ env: {} }).appRoot)
      .toBe("/Users/u/Library/Application Support/scribe");
  });

  it("Windows:使用 %APPDATA%/scribe", () => {
    vi.spyOn(os, "platform").mockReturnValue("win32");
    const p = resolveAppPaths({ env: { APPDATA: "C:/Users/u/AppData/Roaming" } });
    expect(p.appRoot).toBe("C:/Users/u/AppData/Roaming/scribe");
  });

  it("SCRIBE_HOME 环境变量优先生效", () => {
    const p = resolveAppPaths({ env: { SCRIBE_HOME: "/tmp/x" } });
    expect(p.appRoot).toBe("/tmp/x");
  });

  it("bookDir(id) 拼接正确", () => {
    vi.spyOn(os, "platform").mockReturnValue("linux");
    vi.spyOn(os, "homedir").mockReturnValue("/h");
    const p = resolveAppPaths({ env: {} });
    expect(p.bookDir("abc")).toBe("/h/.config/scribe/books/abc");
    expect(p.workspaceDb("abc")).toBe("/h/.config/scribe/books/abc/workspace.db");
    expect(p.chaptersDir("abc")).toBe("/h/.config/scribe/books/abc/chapters");
  });
});
```

- [ ] **步骤 2:运行测试 → FAIL**

- [ ] **步骤 3:实现 `paths.ts`**

```ts
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
```

- [ ] **步骤 4:测试通过,commit**

```bash
git commit -am "实现跨平台应用路径解析"
```

---

### Task 1.2:SQLite 连接 + migrations runner

**文件:**
- 创建:`packages/server/src/db/library.ts`、`packages/server/src/db/workspace.ts`、`packages/server/src/db/migrations/runner.ts`、`packages/server/src/db/migrations/library/001_init.sql`、`packages/server/src/db/migrations/workspace/001_init.sql`、`packages/server/tests/unit/db/runner.test.ts`

- [ ] **步骤 1:写失败测试 `runner.test.ts`** —— 在内存 DB(`:memory:`)上跑 runner,断言:首次执行后所有迁移在 `_migrations` 表里有记录;再次执行不会重复跑;迁移按文件名升序执行。

```ts
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../../src/db/migrations/runner.js";

describe("runMigrations", () => {
  it("首次执行所有迁移并记录,二次执行幂等", () => {
    const db = new Database(":memory:");
    const migs = [
      { name: "001_a.sql", sql: "CREATE TABLE a(id INTEGER);" },
      { name: "002_b.sql", sql: "CREATE TABLE b(id INTEGER);" },
    ];
    runMigrations(db, migs);
    const applied1 = db.prepare("SELECT name FROM _migrations ORDER BY name").all();
    expect(applied1).toEqual([{ name: "001_a.sql" }, { name: "002_b.sql" }]);
    runMigrations(db, migs);
    const applied2 = db.prepare("SELECT COUNT(*) AS c FROM _migrations").get() as any;
    expect(applied2.c).toBe(2);
  });

  it("失败迁移整体回滚", () => {
    const db = new Database(":memory:");
    expect(() => runMigrations(db, [{ name: "bad.sql", sql: "CREATE TABLE x(); -- syntax error" }]))
      .toThrow();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    expect(tables.find((t: any) => t.name === "x")).toBeUndefined();
  });
});
```

- [ ] **步骤 2:运行 → FAIL**

- [ ] **步骤 3:实现 runner**

```ts
// packages/server/src/db/migrations/runner.ts
import type { Database } from "better-sqlite3";
export interface Migration { name: string; sql: string; }
export function runMigrations(db: Database, migrations: Migration[]): void {
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL
  )`);
  const sorted = [...migrations].sort((a, b) => a.name.localeCompare(b.name));
  for (const m of sorted) {
    const row = db.prepare("SELECT 1 FROM _migrations WHERE name=?").get(m.name);
    if (row) continue;
    const tx = db.transaction(() => {
      db.exec(m.sql);
      db.prepare("INSERT INTO _migrations(name, applied_at) VALUES(?, ?)").run(m.name, Date.now());
    });
    tx();
  }
}
```

- [ ] **步骤 4:实现 `db/library.ts`**:导出 `openLibraryDb(path: string): Database`,内部 `new Database(path)`、`pragma journal_mode = WAL`、`pragma foreign_keys = ON`,加载并执行 `migrations/library/*.sql`(用 fs.readdirSync 读目录)

- [ ] **步骤 5:实现 `db/workspace.ts`**:同样导出 `openWorkspaceDb(path: string)`,加载 `migrations/workspace/*.sql`

- [ ] **步骤 6:写 `001_init.sql`(library)**

```sql
CREATE TABLE books (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  genre TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  total_cost_usd REAL NOT NULL DEFAULT 0
);
CREATE INDEX idx_books_updated ON books(updated_at DESC);
```

- [ ] **步骤 7:`workspace/001_init.sql` 留空(下个 Task 1.4 一次性铺完整 schema)**

- [ ] **步骤 8:测试通过,commit**

```bash
git commit -am "添加 SQLite 连接与迁移运行器"
```

---

### Task 1.3:library.db 的 books 表 + Books repository

**文件:**
- 创建:`packages/shared/src/types/book.ts`、`packages/server/src/db/repositories/books.ts`、`packages/server/tests/unit/db/repositories/books.test.ts`

- [ ] **步骤 1:在 shared 中加 `book.ts`**

```ts
import { z } from "zod";
export const BookSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  genre: z.string().nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  totalCostUsd: z.number().nonnegative(),
});
export type Book = z.infer<typeof BookSchema>;
export const NewBookInputSchema = z.object({
  title: z.string().min(1),
  genre: z.string().nullable().optional(),
});
export type NewBookInput = z.infer<typeof NewBookInputSchema>;
```
并在 `shared/src/index.ts` re-export。

- [ ] **步骤 2:写失败测试覆盖 create / list / get / rename / delete / addCost**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../../../src/db/migrations/runner.js";
import { createBooksRepo } from "../../../../src/db/repositories/books.js";
import libraryInit from "../../../../src/db/migrations/library/001_init.sql?raw";

let db: any, repo: ReturnType<typeof createBooksRepo>;
beforeEach(() => {
  db = new Database(":memory:");
  runMigrations(db, [{ name: "001_init.sql", sql: libraryInit }]);
  repo = createBooksRepo(db);
});

describe("books repo", () => {
  it("create + get + list", () => {
    const b = repo.create({ title: "测试书", genre: "仙侠" });
    expect(b.id).toBeTruthy();
    expect(repo.get(b.id)?.title).toBe("测试书");
    expect(repo.list()).toHaveLength(1);
  });
  it("rename 更新 updatedAt", async () => {
    const b = repo.create({ title: "A" });
    await new Promise(r => setTimeout(r, 5));
    const b2 = repo.rename(b.id, "B");
    expect(b2.title).toBe("B");
    expect(b2.updatedAt).toBeGreaterThan(b.updatedAt);
  });
  it("delete 后 get 返回 undefined", () => {
    const b = repo.create({ title: "X" });
    repo.delete(b.id);
    expect(repo.get(b.id)).toBeUndefined();
  });
  it("addCost 累加", () => {
    const b = repo.create({ title: "X" });
    repo.addCost(b.id, 0.12);
    repo.addCost(b.id, 0.03);
    expect(repo.get(b.id)?.totalCostUsd).toBeCloseTo(0.15);
  });
});
```

(测试内 `?raw` 用 vitest 的 `test.server.deps.inline` 或 `vite-plugin-raw`;若工具链不便,改为 `fs.readFileSync` 读 sql 文件。)

- [ ] **步骤 3:实现 `repositories/books.ts`**

```ts
import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import { type Book, type NewBookInput, BookSchema } from "@scribe/shared";

export function createBooksRepo(db: Database) {
  const rowToBook = (r: any): Book => BookSchema.parse({
    id: r.id, title: r.title, genre: r.genre,
    createdAt: r.created_at, updatedAt: r.updated_at, totalCostUsd: r.total_cost_usd,
  });
  return {
    create(input: NewBookInput): Book {
      const id = randomUUID();
      const now = Date.now();
      db.prepare(`INSERT INTO books(id,title,genre,created_at,updated_at,total_cost_usd)
                  VALUES(?,?,?,?,?,0)`).run(id, input.title, input.genre ?? null, now, now);
      return this.get(id)!;
    },
    get(id: string): Book | undefined {
      const r = db.prepare("SELECT * FROM books WHERE id=?").get(id);
      return r ? rowToBook(r) : undefined;
    },
    list(): Book[] {
      return db.prepare("SELECT * FROM books ORDER BY updated_at DESC").all().map(rowToBook);
    },
    rename(id: string, title: string): Book {
      db.prepare("UPDATE books SET title=?, updated_at=? WHERE id=?").run(title, Date.now(), id);
      return this.get(id)!;
    },
    delete(id: string): void {
      db.prepare("DELETE FROM books WHERE id=?").run(id);
    },
    addCost(id: string, deltaUsd: number): void {
      db.prepare("UPDATE books SET total_cost_usd = total_cost_usd + ?, updated_at=? WHERE id=?")
        .run(deltaUsd, Date.now(), id);
    },
  };
}
```

- [ ] **步骤 4:测试通过 → commit**

```bash
git commit -am "添加 books 表与 Books 仓库"
```

---

### Task 1.4:workspace.db 全部 schema + 各 repository

**文件:**
- 修改:`packages/server/src/db/migrations/workspace/001_init.sql`
- 创建:`packages/server/src/db/repositories/{characters,outline,foreshadowing,timeline,genre-sections,chapters,conversations,token-usage}.ts`、对应 `tests/unit/db/repositories/*.test.ts`
- 创建/修改:`packages/shared/src/types/{character,outline,foreshadowing,timeline,genre-section,chapter,audit,conversation,token-usage}.ts`

- [ ] **步骤 1:`workspace/001_init.sql` 一次性铺规格 §3.2 全部表**(`book_meta`、`characters`、`outline_nodes`、`foreshadowing`、`timeline_events`、`genre_sections`、`genre_section_items`、`chapter_summaries`、`chapter_versions`、`chapter_audits`、`conversations`、`token_usage`),完全照抄 spec §3.2,加索引:`idx_chapter_versions_no(chapter_no, version_no DESC)`、`idx_conversations_created(created_at)`、`idx_token_usage_chapter(chapter_no)`、`idx_genre_section_items_section(section_id)`、`idx_outline_parent(parent_id)`、`idx_foreshadowing_status(status)`

- [ ] **步骤 2:在 shared 中加各 Zod schema**,字段命名用 camelCase,`metadata`/`schema` 等 JSON 字段用 `z.unknown()` 或更精确类型

```ts
// character.ts
export const CharacterSchema = z.object({
  id: z.string(), name: z.string(), role: z.enum(["protagonist","antagonist","supporting"]).nullable(),
  baseData: z.record(z.unknown()), currentState: z.record(z.unknown()),
  appearances: z.array(z.object({ chapterNo: z.number().int(), brief: z.string() })),
  updatedAt: z.number().int(),
});
```

(其余文件类似:Outline 有 `parentId/level/sortOrder`;Foreshadowing 有 `plantedChapter/paidChapter/status`;Timeline 有 `chapterNo/storyTime/event/participants`;GenreSectionField 有 `name/type/required/values?/description?`;Chapter 相关含 `Summary/Audit/Version` 三套。)

- [ ] **步骤 3:为每个 repository 写一个失败测试 + 实现**(每个 repo 至少覆盖 create/get/list/update/delete;chapters repo 含 `saveVersion/listVersions/saveSummary/saveAudit`;conversations repo 有 append/listSince/listLatest;token-usage repo 有 record/sumByChapter/sumByTaskType)

- [ ] **步骤 4:每个 repo 单独 commit**

```bash
git commit -m "实现 characters 仓库"
git commit -m "实现 outline 仓库"
git commit -m "实现 foreshadowing 仓库"
git commit -m "实现 timeline 仓库"
git commit -m "实现 genre-sections 仓库"
git commit -m "实现 chapters 仓库(含 versions/summaries/audits)"
git commit -m "实现 conversations 仓库"
git commit -m "实现 token-usage 仓库"
```

- [ ] **步骤 5:运行 `pnpm test && pnpm typecheck` 全绿**

---

### Task 1.5:章节 .md 文件 IO + frontmatter

**文件:**
- 创建:`packages/server/src/fs/chapter-files.ts`、`packages/server/tests/unit/fs/chapter-files.test.ts`

- [ ] **步骤 1:写失败测试**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createChapterFiles } from "../../../src/fs/chapter-files.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scribe-test-"));
});

describe("chapter files", () => {
  it("save 写入 0001.md 含 frontmatter,read 解析回正文 + 元", () => {
    const cf = createChapterFiles(tmp);
    cf.save({ chapterNo: 1, title: "初见", content: "# 初见\n\n云雾间...", versionNo: 1 });
    expect(fs.existsSync(path.join(tmp, "0001.md"))).toBe(true);
    const r = cf.read(1);
    expect(r?.title).toBe("初见");
    expect(r?.versionNo).toBe(1);
    expect(r?.content).toContain("云雾间");
    expect(r?.wordCount).toBeGreaterThan(0);
  });
  it("read 不存在的章节返回 undefined", () => {
    expect(createChapterFiles(tmp).read(99)).toBeUndefined();
  });
  it("list 返回所有 .md 章节号升序", () => {
    const cf = createChapterFiles(tmp);
    cf.save({ chapterNo: 2, title: "B", content: "二", versionNo: 1 });
    cf.save({ chapterNo: 1, title: "A", content: "一", versionNo: 1 });
    expect(cf.list().map(c => c.chapterNo)).toEqual([1, 2]);
  });
  it("delete 删除文件", () => {
    const cf = createChapterFiles(tmp);
    cf.save({ chapterNo: 1, title: "T", content: "正文", versionNo: 1 });
    cf.delete(1);
    expect(cf.read(1)).toBeUndefined();
  });
});
```

- [ ] **步骤 2:实现 `chapter-files.ts`**(用 `gray-matter`)

```ts
import * as fs from "node:fs";
import * as path from "node:path";
import matter from "gray-matter";

export interface ChapterRecord {
  chapterNo: number; title: string; content: string;
  versionNo: number; wordCount: number; updatedAt: number;
}
export interface SaveInput {
  chapterNo: number; title: string; content: string; versionNo: number;
}

const pad = (n: number) => String(n).padStart(4, "0");

export function createChapterFiles(chaptersDir: string) {
  fs.mkdirSync(chaptersDir, { recursive: true });
  const filePath = (n: number) => path.posix.join(chaptersDir, `${pad(n)}.md`);
  const countWords = (s: string) =>
    (s.match(/[一-龥]/g)?.length ?? 0) +
    (s.match(/[A-Za-z]+/g)?.length ?? 0);

  return {
    save(input: SaveInput) {
      const fm = {
        title: input.title, version: input.versionNo,
        wordCount: countWords(input.content), updatedAt: Date.now(),
      };
      const md = matter.stringify(input.content, fm);
      fs.writeFileSync(filePath(input.chapterNo), md, "utf-8");
    },
    read(no: number): ChapterRecord | undefined {
      const fp = filePath(no);
      if (!fs.existsSync(fp)) return undefined;
      const { data, content } = matter(fs.readFileSync(fp, "utf-8"));
      return {
        chapterNo: no,
        title: String(data.title ?? ""),
        content: content.replace(/^\n+/, ""),
        versionNo: Number(data.version ?? 1),
        wordCount: Number(data.wordCount ?? countWords(content)),
        updatedAt: Number(data.updatedAt ?? 0),
      };
    },
    list(): ChapterRecord[] {
      if (!fs.existsSync(chaptersDir)) return [];
      const files = fs.readdirSync(chaptersDir).filter(f => /^\d{4}\.md$/.test(f)).sort();
      return files.map(f => this.read(Number(f.slice(0, 4)))!).filter(Boolean);
    },
    delete(no: number) {
      const fp = filePath(no);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    },
  };
}
```

- [ ] **步骤 3:测试通过 → commit `添加章节 .md 文件读写`**

---

### Task 1.6:快照(tar.gz)调度 + 滚动保留

**文件:**
- 创建:`packages/server/src/fs/snapshot.ts`、`packages/server/src/jobs/snapshot-scheduler.ts`、`packages/server/tests/unit/fs/snapshot.test.ts`、`packages/server/tests/unit/jobs/snapshot-scheduler.test.ts`

- [ ] **步骤 1:写 `snapshot.test.ts` 失败测试**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createSnapshot, listSnapshots, restoreSnapshot, pruneSnapshots } from "../../../src/fs/snapshot.js";

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "snap-")); });

describe("snapshot", () => {
  it("createSnapshot 打包目录到 tar.gz,listSnapshots 列出", async () => {
    const src = path.join(tmp, "books", "abc"); fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, "rules.md"), "# 规则");
    const out = path.join(tmp, "backups", "abc");
    const snap = await createSnapshot({ srcDir: src, outDir: out });
    expect(fs.existsSync(snap.path)).toBe(true);
    expect(snap.path.endsWith(".tar.gz")).toBe(true);
    expect(await listSnapshots(out)).toHaveLength(1);
  });
  it("restoreSnapshot 解压覆盖目标目录", async () => {
    const src = path.join(tmp, "src"); fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, "a.md"), "原始");
    const out = path.join(tmp, "out");
    const snap = await createSnapshot({ srcDir: src, outDir: out });
    fs.writeFileSync(path.join(src, "a.md"), "被改坏");
    await restoreSnapshot({ snapshotPath: snap.path, destDir: src });
    expect(fs.readFileSync(path.join(src, "a.md"), "utf-8")).toBe("原始");
  });
  it("pruneSnapshots 保留 30 天 + 每周 1 份", async () => {
    // 用 fake names 模拟历史:90 天前每天一份 → 期望仅留近 30 天 + 每周代表(共 ~37 份)
    // 详细断言略,核心:90 - kept >= 50
  });
});
```

- [ ] **步骤 2:实现 `snapshot.ts`** —— 用 `tar.create` / `tar.extract`,文件名 `YYYYMMDD-HHMM.tar.gz`(本地时区);`pruneSnapshots(dir)` 解析文件名 → 计算 ageDays:age <= 30 留;>30 但属于该 ISO 周第一份留;其余删

- [ ] **步骤 3:写 `snapshot-scheduler.test.ts` 失败测试** —— mock 时钟,断言 `start()` 每 6 小时调一次 `snapshotTrigger`,`onChapterCommitted()` 每累计 5 章触发一次

- [ ] **步骤 4:实现 `jobs/snapshot-scheduler.ts`**

```ts
export function createSnapshotScheduler(opts: {
  intervalMs?: number; chaptersThreshold?: number;
  doSnapshot: (bookId: string) => Promise<void>;
}) {
  const interval = opts.intervalMs ?? 6 * 3600 * 1000;
  const threshold = opts.chaptersThreshold ?? 5;
  const counters = new Map<string, number>();
  let timer: NodeJS.Timeout | undefined;
  return {
    start(activeBooks: () => string[]) {
      timer = setInterval(() => activeBooks().forEach(opts.doSnapshot), interval);
    },
    stop() { if (timer) clearInterval(timer); },
    onChapterCommitted(bookId: string) {
      const n = (counters.get(bookId) ?? 0) + 1;
      if (n >= threshold) { counters.set(bookId, 0); void opts.doSnapshot(bookId); }
      else counters.set(bookId, n);
    },
  };
}
```

- [ ] **步骤 5:测试通过 → commit `实现项目快照与滚动保留`**

---

## 阶段 2:DeepSeek Adapter

### Task 2.1:ProviderAdapter 接口

**文件:**
- 创建:`packages/shared/src/types/provider.ts`(ModelInfo / ErrorClass 联合)、`packages/server/src/ai/providers/_interface.ts`、`packages/server/tests/unit/ai/providers/interface.test.ts`

- [ ] **步骤 1:在 shared 加 `provider.ts`**

```ts
import { z } from "zod";
export const ModelPricingSchema = z.object({
  input: z.number(), output: z.number(), cachedInput: z.number().optional(),
});
export const ModelInfoSchema = z.object({
  id: z.string(),
  ownedBy: z.string().optional(),
  contextWindow: z.number().int().positive().optional(),
  supportsTools: z.boolean().optional(),
  supportsReasoning: z.boolean().optional(),
  pricing: ModelPricingSchema.optional(),
});
export type ModelInfo = z.infer<typeof ModelInfoSchema>;
export const ErrorClassSchema = z.enum([
  "rate_limit","timeout","stream_idle","auth","context_overflow","unknown",
]);
export type ErrorClass = z.infer<typeof ErrorClassSchema>;
```

- [ ] **步骤 2:写 `_interface.ts`(只 type,无运行时)**

```ts
import type { LanguageModel } from "ai";
import type { ModelInfo, ErrorClass } from "@scribe/shared";

export interface ModelOpts {
  apiKey: string;
  baseUrl?: string;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface ProviderAdapter {
  id: string;
  listModels(): Promise<ModelInfo[]>;
  enrichModel(modelId: string): Promise<ModelInfo>;
  testToolUse(modelId: string, opts: ModelOpts): Promise<boolean>;
  createModel(modelId: string, opts: ModelOpts): LanguageModel;
  classifyError(err: unknown): ErrorClass;
}
```

- [ ] **步骤 3:写一个"interface compliance"伪测试**

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { ProviderAdapter } from "../../../../src/ai/providers/_interface.js";

describe("ProviderAdapter type", () => {
  it("有 6 个公开方法/属性", () => {
    expectTypeOf<keyof ProviderAdapter>().toEqualTypeOf<
      "id"|"listModels"|"enrichModel"|"testToolUse"|"createModel"|"classifyError"
    >();
  });
});
```

- [ ] **步骤 4:`pnpm test && pnpm typecheck` 全绿**

- [ ] **步骤 5:commit**

```bash
git commit -am "定义 Provider Adapter 接口与模型元类型"
```

---

### Task 2.2:OpenAI 兼容基类

**文件:**
- 创建:`packages/server/src/ai/providers/openai-compatible.ts`、`packages/server/tests/unit/ai/providers/openai-compatible.test.ts`

- [ ] **步骤 1:写失败测试** —— 用 mock fetch 模拟 `/v1/models` 端点,断言 `listModels()` 解析 `data: [{id, ...}]` 为 ModelInfo[];`createModel()` 返回非空对象;构造时缺 apiKey 抛错

```ts
import { describe, it, expect, vi } from "vitest";
import { OpenAICompatibleProvider } from "../../../../src/ai/providers/openai-compatible.js";

describe("OpenAICompatibleProvider", () => {
  it("listModels 命中 /v1/models", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "deepseek-v4-pro", owned_by: "deepseek" }] }),
    });
    const p = new OpenAICompatibleProvider({
      id: "deepseek", baseUrl: "https://api.deepseek.com",
      apiKey: "sk-x", fetchImpl: fetchMock as any,
    });
    const models = await p.listModels();
    expect(models[0]?.id).toBe("deepseek-v4-pro");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.deepseek.com/v1/models",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer sk-x" }) })
    );
  });
  it("无 apiKey 抛错", () => {
    expect(() => new OpenAICompatibleProvider({ id: "x", baseUrl: "u", apiKey: "" })).toThrow();
  });
  it("classifyError 默认 unknown", () => {
    const p = new OpenAICompatibleProvider({ id: "x", baseUrl: "u", apiKey: "k" });
    expect(p.classifyError(new Error("?"))).toBe("unknown");
  });
});
```

- [ ] **步骤 2:实现基类**

```ts
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import type { ProviderAdapter, ModelOpts } from "./_interface.js";
import type { ModelInfo, ErrorClass } from "@scribe/shared";

interface Cfg { id: string; baseUrl: string; apiKey: string; fetchImpl?: typeof fetch; }

export class OpenAICompatibleProvider implements ProviderAdapter {
  readonly id: string;
  protected readonly baseUrl: string;
  protected readonly apiKey: string;
  protected readonly fetchImpl: typeof fetch;

  constructor(cfg: Cfg) {
    if (!cfg.apiKey) throw new Error("apiKey 不能为空");
    this.id = cfg.id; this.baseUrl = cfg.baseUrl.replace(/\/+$/, "");
    this.apiKey = cfg.apiKey; this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  async listModels(): Promise<ModelInfo[]> {
    const res = await this.fetchImpl(`${this.baseUrl}/v1/models`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!res.ok) throw new Error(`listModels 失败 HTTP ${res.status}`);
    const j: any = await res.json();
    return (j.data ?? []).map((m: any) => ({ id: m.id, ownedBy: m.owned_by }));
  }
  async enrichModel(id: string): Promise<ModelInfo> { return { id }; }
  async testToolUse(): Promise<boolean> { return true; }

  createModel(modelId: string, opts: ModelOpts): LanguageModel {
    const provider = createOpenAICompatible({
      name: this.id, baseURL: `${this.baseUrl}/v1`,
      apiKey: opts.apiKey ?? this.apiKey,
    });
    return provider.chatModel(modelId);
  }
  classifyError(_err: unknown): ErrorClass { return "unknown"; }
}
```

- [ ] **步骤 3:测试通过 → commit `添加 OpenAI 兼容协议基类`**

---

### Task 2.3:DeepSeek adapter

**文件:**
- 创建:`packages/server/src/ai/providers/deepseek.ts`、`packages/server/tests/unit/ai/providers/deepseek.test.ts`

- [ ] **步骤 1:写失败测试**

```ts
import { describe, it, expect } from "vitest";
import { DeepSeekProvider } from "../../../../src/ai/providers/deepseek.js";

describe("DeepSeekProvider", () => {
  it("id 为 deepseek、baseUrl 为官方端点", () => {
    const p = new DeepSeekProvider({ apiKey: "sk-x" });
    expect(p.id).toBe("deepseek");
    expect((p as any).baseUrl).toBe("https://api.deepseek.com");
  });
  it("classifyError 识别 429", () => {
    const p = new DeepSeekProvider({ apiKey: "sk-x" });
    const e = Object.assign(new Error("429"), { status: 429 });
    expect(p.classifyError(e)).toBe("rate_limit");
  });
  it("classifyError 识别上下文超长(message 包含 context length)", () => {
    const p = new DeepSeekProvider({ apiKey: "sk-x" });
    expect(p.classifyError(new Error("maximum context length exceeded"))).toBe("context_overflow");
  });
  it("classifyError 识别 401 认证", () => {
    const p = new DeepSeekProvider({ apiKey: "sk-x" });
    expect(p.classifyError(Object.assign(new Error("auth"), { status: 401 }))).toBe("auth");
  });
});
```

- [ ] **步骤 2:实现**

```ts
import { OpenAICompatibleProvider } from "./openai-compatible.js";
import type { ErrorClass } from "@scribe/shared";

export class DeepSeekProvider extends OpenAICompatibleProvider {
  constructor(cfg: { apiKey: string; baseUrl?: string; fetchImpl?: typeof fetch }) {
    super({ id: "deepseek", baseUrl: cfg.baseUrl ?? "https://api.deepseek.com",
            apiKey: cfg.apiKey, fetchImpl: cfg.fetchImpl });
  }
  override classifyError(err: unknown): ErrorClass {
    const e = err as any;
    const msg = String(e?.message ?? "");
    const status = Number(e?.status ?? e?.statusCode ?? 0);
    if (status === 429) return "rate_limit";
    if (status === 401 || status === 403) return "auth";
    if (/timeout|ETIMEDOUT/i.test(msg)) return "timeout";
    if (/aborted|stream.*idle/i.test(msg)) return "stream_idle";
    if (/context length|context_length|too long|maximum context/i.test(msg)) return "context_overflow";
    return "unknown";
  }
  override async listModels() {
    // DS 接口可能不返回元数据,后续 enrichModel 兜底补
    return super.listModels();
  }
}
```

- [ ] **步骤 3:测试通过 → commit `添加 DeepSeek adapter`**

---

### Task 2.4:OpenRouter 元数据兜底 + 本地表

**文件:**
- 创建:`packages/server/src/ai/providers/local-model-table.ts`、`packages/server/src/ai/providers/enrich-from-openrouter.ts`、对应测试

- [ ] **步骤 1:写本地表 `local-model-table.ts`**

```ts
import type { ModelInfo } from "@scribe/shared";
export const LOCAL_MODEL_TABLE: Record<string, Partial<ModelInfo>> = {
  "deepseek-v4-pro": {
    contextWindow: 128_000, supportsTools: true, supportsReasoning: true,
    pricing: { input: 0.27, output: 1.10, cachedInput: 0.07 },
  },
  "deepseek-v4-flash": {
    contextWindow: 64_000, supportsTools: true, supportsReasoning: false,
    pricing: { input: 0.07, output: 0.28 },
  },
};
export function lookupLocal(id: string): Partial<ModelInfo> | undefined {
  return LOCAL_MODEL_TABLE[id];
}
```

- [ ] **步骤 2:写失败测试 `enrich-from-openrouter.test.ts`** —— mock fetch 返回 OpenRouter 风格 `{data: [{id, context_length, pricing: {prompt, completion}, supported_parameters: ["tools"]}]}`,断言 `enrichFromOpenRouter("deepseek-v4-pro")` 返回 `contextWindow/pricing/supportsTools` 已填充

- [ ] **步骤 3:实现 `enrich-from-openrouter.ts`**

```ts
import type { ModelInfo } from "@scribe/shared";

interface Cache { fetchedAt: number; data: Map<string, Partial<ModelInfo>>; }
let cache: Cache | undefined;
const TTL = 24 * 3600 * 1000;

export async function enrichFromOpenRouter(
  modelId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Partial<ModelInfo>> {
  if (!cache || Date.now() - cache.fetchedAt > TTL) {
    try {
      const res = await fetchImpl("https://openrouter.ai/api/v1/models");
      const j: any = await res.json();
      const map = new Map<string, Partial<ModelInfo>>();
      for (const m of j.data ?? []) {
        const baseId = String(m.id).split("/").pop() ?? m.id;
        map.set(baseId, {
          contextWindow: m.context_length,
          supportsTools: Array.isArray(m.supported_parameters) && m.supported_parameters.includes("tools"),
          pricing: m.pricing && {
            input: Number(m.pricing.prompt) * 1e6,
            output: Number(m.pricing.completion) * 1e6,
          },
        });
      }
      cache = { fetchedAt: Date.now(), data: map };
    } catch { return {}; }
  }
  return cache.data.get(modelId) ?? {};
}
```

- [ ] **步骤 4:在 `OpenAICompatibleProvider.enrichModel` 改为三档兜底:provider 自身的 listModels 元数据 → OpenRouter → 本地表;加测试覆盖三档优先级**

- [ ] **步骤 5:测试通过 → commit `添加 OpenRouter 与本地兜底元数据`**

---

### Task 2.5:错误重试策略 + Token 用量追踪

**文件:**
- 创建:`packages/server/src/ai/retry.ts`、`packages/server/src/ai/usage-tracker.ts`、对应测试

- [ ] **步骤 1:`retry.test.ts` 失败测试** —— 七种 ErrorClass 各写一组用例,断言重试次数 / 是否重试

```ts
import { describe, it, expect, vi } from "vitest";
import { withRetry } from "../../../src/ai/retry.js";

describe("withRetry", () => {
  it("rate_limit 指数退避至多 3 次", async () => {
    let n = 0;
    const op = vi.fn(async () => { n++; if (n < 3) throw Object.assign(new Error("429"), { status: 429 }); return "ok"; });
    const r = await withRetry(op, { classify: () => "rate_limit", sleepImpl: async () => {} });
    expect(r).toBe("ok"); expect(op).toHaveBeenCalledTimes(3);
  });
  it("auth 不重试", async () => {
    const op = vi.fn(async () => { throw Object.assign(new Error("auth"), { status: 401 }); });
    await expect(withRetry(op, { classify: () => "auth" })).rejects.toThrow();
    expect(op).toHaveBeenCalledTimes(1);
  });
  it("timeout 立刻重试 1 次", async () => {
    let n = 0;
    const op = vi.fn(async () => { n++; if (n === 1) throw new Error("timeout"); return "ok"; });
    const r = await withRetry(op, { classify: () => "timeout" });
    expect(r).toBe("ok"); expect(op).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **步骤 2:实现 `retry.ts`**

```ts
import type { ErrorClass } from "@scribe/shared";

export interface RetryOpts {
  classify: (e: unknown) => ErrorClass;
  sleepImpl?: (ms: number) => Promise<void>;
  onAttempt?: (n: number, cls: ErrorClass) => void;
}
const POLICY: Record<ErrorClass, { maxRetries: number; backoff: (n: number) => number }> = {
  rate_limit:       { maxRetries: 3, backoff: (n) => 1000 * 2 ** (n - 1) },
  timeout:          { maxRetries: 1, backoff: () => 0 },
  stream_idle:      { maxRetries: 1, backoff: () => 0 },
  auth:             { maxRetries: 0, backoff: () => 0 },
  context_overflow: { maxRetries: 1, backoff: () => 0 },  // 调用方在 catch 里降级再 retry
  unknown:          { maxRetries: 0, backoff: () => 0 },
};
export async function withRetry<T>(op: () => Promise<T>, opts: RetryOpts): Promise<T> {
  const sleep = opts.sleepImpl ?? ((ms) => new Promise(r => setTimeout(r, ms)));
  let attempt = 0;
  while (true) {
    try { return await op(); }
    catch (e) {
      const cls = opts.classify(e);
      const policy = POLICY[cls];
      if (attempt >= policy.maxRetries) throw e;
      attempt += 1;
      opts.onAttempt?.(attempt, cls);
      await sleep(policy.backoff(attempt));
    }
  }
}
```

- [ ] **步骤 3:`usage-tracker.test.ts` 失败测试** —— 注入 mock token-usage repo 与 books repo,调用 `record({...})` 后断言 `tokenUsageRepo.record` 被以正确参数调用、`booksRepo.addCost` 被以正确金额累加

- [ ] **步骤 4:实现 `usage-tracker.ts`** —— 输入 `{ taskType, model, promptTokens, completionTokens, cachedTokens, reasoningTokens?, chapterNo?, modelInfo }` → 算 cost(`(prompt-cached)*input + cached*cachedInput + completion*output`,均 per 1M tokens)→ 写 token_usage + library.books.addCost

- [ ] **步骤 5:测试通过 → commit `添加重试策略与用量追踪`**

---

## 阶段 3:简单写作链路

### Task 3.1:SSE 工具 + 事件类型

**文件:**
- 创建:`packages/shared/src/types/sse-events.ts`、`packages/server/src/http/sse.ts`、`packages/server/tests/unit/http/sse.test.ts`

- [ ] **步骤 1:在 shared 加 SSE 事件联合**

```ts
import { z } from "zod";
export const SseEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text_delta"), delta: z.string() }),
  z.object({ type: z.literal("reasoning_delta"), delta: z.string() }),
  z.object({ type: z.literal("tool_call_start"), toolName: z.string(), args: z.unknown() }),
  z.object({ type: z.literal("tool_call_end"), toolName: z.string(), result: z.unknown() }),
  z.object({ type: z.literal("usage"), promptTokens: z.number(), completionTokens: z.number(),
             cachedTokens: z.number().optional(), reasoningTokens: z.number().optional() }),
  z.object({ type: z.literal("done") }),
  z.object({ type: z.literal("error"), errorClass: z.string(), message: z.string() }),
]);
export type SseEvent = z.infer<typeof SseEventSchema>;
```

- [ ] **步骤 2:写 `sse.test.ts`** —— 调 `streamSseResponse(generator)`、用 `Response.body!.getReader()` 读出每个 chunk,断言格式 `event: <type>\ndata: <json>\n\n`,且 `done` 事件后流结束

- [ ] **步骤 3:实现 `sse.ts`**

```ts
import type { SseEvent } from "@scribe/shared";
export function streamSseResponse(events: AsyncIterable<SseEvent>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      try {
        for await (const ev of events) {
          ctrl.enqueue(encoder.encode(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`));
          if (ev.type === "done" || ev.type === "error") break;
        }
      } catch (e) {
        const ev = { type: "error", errorClass: "unknown", message: String((e as Error).message) };
        ctrl.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify(ev)}\n\n`));
      } finally { ctrl.close(); }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
```

- [ ] **步骤 4:测试通过 → commit `添加 SSE 工具与事件类型`**

---

### Task 3.2:对话 API 骨架(回声版)

**文件:**
- 创建:`packages/server/src/http/routes/conversation.ts`、`packages/server/src/ai/orchestrator/chat.ts`、`packages/server/tests/integration/conversation-echo.test.ts`

- [ ] **步骤 1:写集成测试** —— 启 in-memory app,POST `/api/books/:id/conversation` `{ message: "你好" }`,断言响应是 SSE,先收到 1+ 个 `text_delta`,最后收到 `done`,正文片段拼起来包含"你好"

- [ ] **步骤 2:实现 `chat.ts` 的 echo 模式**

```ts
import type { SseEvent } from "@scribe/shared";

export async function* runEcho(input: { message: string }): AsyncIterable<SseEvent> {
  const reply = `[echo] ${input.message}`;
  for (const ch of reply) {
    yield { type: "text_delta", delta: ch };
    await new Promise(r => setTimeout(r, 5));
  }
  yield { type: "done" };
}
```

- [ ] **步骤 3:实现路由 `routes/conversation.ts`**

```ts
import { Hono } from "hono";
import { streamSseResponse } from "../sse.js";
import { runEcho } from "../../ai/orchestrator/chat.js";

export function conversationRoutes() {
  const app = new Hono();
  app.post("/api/books/:bookId/conversation", async (c) => {
    const body = await c.req.json();
    const message = String(body?.message ?? "");
    if (!message) return c.json({ error: "message 不能为空" }, 400);
    return streamSseResponse(runEcho({ message }));
  });
  return app;
}
```

- [ ] **步骤 4:在 `http/server.ts` 中 `app.route("/", conversationRoutes())`**

- [ ] **步骤 5:测试通过 → commit `添加对话 API 回声实现`**

---

### Task 3.3:接入 DeepSeek 流式输出

**文件:**
- 修改:`packages/server/src/ai/orchestrator/chat.ts`
- 创建:`packages/server/src/ai/llm-call.ts`(包装 Vercel AI SDK 的 streamText)、`packages/server/tests/integration/chat-streaming.test.ts`

- [ ] **步骤 1:写 `llm-call.ts`**

```ts
import { streamText, type LanguageModel, type CoreMessage, type Tool } from "ai";
import type { SseEvent } from "@scribe/shared";

export interface LlmCallInput {
  model: LanguageModel;
  messages: CoreMessage[];
  tools?: Record<string, Tool>;
  abortSignal?: AbortSignal;
}

export async function* streamLlm(input: LlmCallInput): AsyncIterable<SseEvent> {
  const result = streamText({ model: input.model, messages: input.messages,
                              tools: input.tools, abortSignal: input.abortSignal });
  for await (const part of result.fullStream) {
    if (part.type === "text-delta") yield { type: "text_delta", delta: part.textDelta };
    else if (part.type === "reasoning") yield { type: "reasoning_delta", delta: part.textDelta };
    else if (part.type === "tool-call") yield { type: "tool_call_start", toolName: part.toolName, args: part.args };
    else if (part.type === "tool-result") yield { type: "tool_call_end", toolName: part.toolName, result: part.result };
    else if (part.type === "error") yield { type: "error", errorClass: "unknown", message: String((part as any).error) };
  }
  const usage = await result.usage;
  yield { type: "usage", promptTokens: usage.promptTokens, completionTokens: usage.completionTokens };
  yield { type: "done" };
}
```

- [ ] **步骤 2:测试用 mock LanguageModel(`MockLanguageModelV1` from `ai/test`)** —— 输入 stream 三个 text-delta + 一个 finish,断言 SSE 事件序列正确;mock 抛 401 → SSE 收到 `error` 且 errorClass = "auth"

- [ ] **步骤 3:在 `orchestrator/chat.ts` 加 `runChat({ provider, modelId, history, message })`**,组装 messages 数组 `[system, ...history, {role:"user",content:message}]` 调 `streamLlm`,echo 模式作为 fallback 当未配置 API key 时启用

- [ ] **步骤 4:`/api/books/:id/conversation` 改用 `runChat`,在 `c.var.ctx`(中间件注入 provider)中读取 modelId**

- [ ] **步骤 5:加集成测试 mock provider → 端到端验证 chunk → SSE → JSON 拼接**

- [ ] **步骤 6:commit `接入 DeepSeek 流式对话`**

---

### Task 3.4:plan_chapter 工具 + write_chapter orchestrator(无 audit、无召回最简版)

**文件:**
- 创建:`packages/server/src/ai/tools/chapter-tools.ts`(`planChapter` 工具定义)、`packages/server/src/ai/prompts/{system-prompt,write-chapter,plan-chapter}.ts`、`packages/server/src/ai/orchestrator/write-chapter.ts`、`packages/server/tests/integration/write-chapter-simple.test.ts`

- [ ] **步骤 1:写 `system-prompt.ts`**

```ts
export const SYSTEM_PROMPT = `你是 Scribe,一个对话式中文长篇小说创作助手。
- 写作风格优先级:画面感 > 动作/对话 > 心理 > 评价说明
- 严格遵守用户给的 rules.md 与世界观设定;有冲突时按 rules.md 为准
- 中文叙述,避免欧化句式与"AI 味"(如频繁的"仿佛"、"似乎"、"无尽")
- 章节字数控制在用户指定的范围内,默认 2500-4500 字
- 不杜撰未在角色卡 / 大纲中出现的关键设定;若必要,通过工具创建`;
```

- [ ] **步骤 2:写 `plan-chapter.ts`(prompt 文本)**:接受 `{ premise, recentSummaries, userIntent }`,输出"先写一段不超过 200 字的本章计划:开场情境 / 核心冲突 / 章末钩子"

- [ ] **步骤 3:写 `write-chapter.ts`(prompt 模板)**:输入 `{ system, premise, rules, characters, outlineThis, planSummary, userIntent }`,要求"直接输出章节正文,不要标题、不要前言"

- [ ] **步骤 4:实现 orchestrator `write-chapter.ts`**

```ts
export interface WriteChapterDeps {
  provider: ProviderAdapter; modelId: string; apiKey: string;
  chaptersRepo: ChaptersRepo; chapterFiles: ChapterFiles;
  usageTracker: UsageTracker;
}
export async function* writeChapterSimple(deps: WriteChapterDeps, input: {
  bookId: string; chapterNo: number; userIntent: string;
}): AsyncIterable<SseEvent> {
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildWritePrompt({ chapterNo: input.chapterNo, userIntent: input.userIntent }) },
  ];
  let buffer = "";
  for await (const ev of streamLlm({ model: deps.provider.createModel(deps.modelId, { apiKey: deps.apiKey }), messages })) {
    if (ev.type === "text_delta") buffer += ev.delta;
    if (ev.type === "usage") deps.usageTracker.record({ taskType: "write", model: deps.modelId, ...ev, chapterNo: input.chapterNo });
    yield ev;
  }
  // 落盘:.md + chapter_versions
  const versionNo = deps.chaptersRepo.nextVersionNo(input.chapterNo);
  deps.chapterFiles.save({ chapterNo: input.chapterNo, title: `第${input.chapterNo}章`, content: buffer, versionNo });
  deps.chaptersRepo.saveVersion({ chapterNo: input.chapterNo, versionNo, source: "ai_write", contentMd: buffer });
}
```

- [ ] **步骤 5:加路由 `POST /api/books/:bookId/chapters/:no/write` body `{ userIntent }`,SSE 流回**

- [ ] **步骤 6:写集成测试,mock LLM 返回固定 text-delta 序列,断言 .md 落地、chapter_versions 表有 1 行、source = "ai_write"**

- [ ] **步骤 7:commit `添加最简版章节写作流程`**

---

### Task 3.5:章节存盘集成测试

**文件:**
- 创建:`packages/server/tests/integration/chapter-roundtrip.test.ts`、`packages/server/tests/fixtures/mock-llm.ts`

- [ ] **步骤 1:写 fixture `mock-llm.ts`** 提供 `makeMockProvider(chunks: string[])` 返回最小 ProviderAdapter,`createModel` 返回的 LanguageModel 在被 streamText 调时按 chunks 输出 text-delta + usage

- [ ] **步骤 2:写集成测试场景** —— 真实 SQLite + 临时目录:
  1. 通过 `writeChapterSimple` 写第 1 章,mock LLM 流出 "黎明时,雾气浸透山道。"
  2. 检查 `chapters/0001.md` 存在且正文匹配,frontmatter `version: 1`
  3. SQLite `chapter_versions` 有一行,`content_md` 含同样正文
  4. 重新写一次(同章节,新 version)→ frontmatter `version: 2`,SQLite 有 2 行,版本号严格递增
  5. `chapterFiles.list().length === 1`(一章)

- [ ] **步骤 3:写错误路径测试** —— mock LLM 抛 `Error("timeout")` → SSE 收到 `error` 事件;验证已开始的部分内容被丢弃(无 .md 落地、SQLite 无写入,即原子性)

- [ ] **步骤 4:把 orchestrator 的落盘逻辑包进 try/finally 仅在成功完成时落盘**

- [ ] **步骤 5:测试通过 → commit `补全章节写入的端到端集成测试`**

---

## 阶段 4:Audit + Summarize

### Task 4.1:audit-summarize prompt(7 维 + 三层摘要)

**文件:**
- 创建:`packages/server/src/ai/prompts/audit-summarize.ts`、`packages/shared/src/types/audit.ts`、`packages/server/tests/unit/ai/prompts/audit-summarize.test.ts`

- [ ] **步骤 1:在 shared 加 `audit.ts`**

```ts
import { z } from "zod";
export const SeveritySchema = z.enum(["ok","warning","critical"]);
export const AuditDimensionKey = z.enum([
  "setting_consistency","character_behavior","pacing","narrative_coherence",
  "foreshadowing","hook_strength","aesthetic_quality",
]);
export const AuditIssueSchema = z.object({
  dimension: AuditDimensionKey,
  severity: SeveritySchema,
  score: z.number().int().min(0).max(10),
  excerpt: z.string().optional(),
  note: z.string(),
});
export const ChapterAuditOutputSchema = z.object({
  verdict: SeveritySchema,
  issues: z.array(AuditIssueSchema),
  summary: z.object({
    oneLiner: z.string().min(1).max(60),
    paragraph: z.string().min(50).max(800),
    keyEvents: z.array(z.object({
      event: z.string(),
      characters: z.array(z.string()),
      foreshadowingRefs: z.array(z.string()),
    })),
  }),
  stateUpdates: z.array(z.unknown()).optional(),
});
export type ChapterAuditOutput = z.infer<typeof ChapterAuditOutputSchema>;
```

- [ ] **步骤 2:写 prompt(中文)**

```ts
export const AUDIT_SUMMARIZE_PROMPT = `你是 Scribe 的章末审读员,同时负责生成本章摘要。
你将收到:
1) 本书 premise + tone + rules.md
2) 主要角色卡 + 活跃伏笔列表
3) 本章正文
4) 本章计划(若有)

请只输出一个 JSON,字段如下(严格不要多余文字、不要 Markdown 包裹):

{
  "verdict": "ok" | "warning" | "critical",
  "issues": [
    {
      "dimension": "setting_consistency"|"character_behavior"|"pacing"
                  |"narrative_coherence"|"foreshadowing"|"hook_strength"|"aesthetic_quality",
      "severity": "ok"|"warning"|"critical",
      "score": 0-10,
      "excerpt": "原文片段(可选)",
      "note": "中文说明问题或亮点"
    }
  ],
  "summary": {
    "oneLiner": "15-30 字一句话章节摘要",
    "paragraph": "200-500 字段落摘要,服务于后续章节的上下文召回",
    "keyEvents": [
      { "event": "事件描述", "characters": ["角色名"], "foreshadowingRefs": ["伏笔标签"] }
    ]
  }
}

判断 verdict 的规则:任一 issue 为 critical → critical;否则任一 warning → warning;全部 ok → ok。
七个维度都要给出 score 和 note(没问题就 note "无明显问题")。`;
```

- [ ] **步骤 3:写 prompt 单元测试** —— `parseAuditOutput(rawJson)` 函数经过 ChapterAuditOutputSchema 校验,断言:合法 JSON 返回对象、缺 verdict 抛错、verdict 非法值抛错

- [ ] **步骤 4:实现 `parseAuditOutput(text)`**(去掉可能的 \`\`\`json fences,JSON.parse,Schema 校验)

- [ ] **步骤 5:测试通过 → commit `添加章末审查与摘要 prompt`**

---

### Task 4.2:audit_chapter orchestrator

**文件:**
- 创建:`packages/server/src/ai/orchestrator/audit-chapter.ts`、`packages/server/tests/unit/ai/orchestrator/audit-chapter.test.ts`

- [ ] **步骤 1:写失败测试** —— mock LLM 返回固定 JSON 字符串(覆盖 ok / warning / critical 三种 verdict),断言 orchestrator 调 `parseAuditOutput`,返回结构化结果;mock 返回非法 JSON → 抛 ParseError

- [ ] **步骤 2:实现**

```ts
import { generateText } from "ai";
import { AUDIT_SUMMARIZE_PROMPT } from "../prompts/audit-summarize.js";
import { parseAuditOutput } from "../prompts/audit-summarize.js";
import type { ChapterAuditOutput } from "@scribe/shared";

export interface AuditDeps {
  provider: ProviderAdapter; auditModelId: string; apiKey: string;
  usageTracker: UsageTracker;
}
export async function auditChapter(deps: AuditDeps, ctx: {
  bookId: string; chapterNo: number; chapterContent: string;
  premise: string; rulesMd: string; characters: Character[]; activeForeshadowing: Foreshadowing[];
  chapterPlan?: string;
}): Promise<ChapterAuditOutput> {
  const userMsg = buildAuditUserPrompt(ctx); // 见步骤 3
  const result = await generateText({
    model: deps.provider.createModel(deps.auditModelId, { apiKey: deps.apiKey }),
    messages: [
      { role: "system", content: AUDIT_SUMMARIZE_PROMPT },
      { role: "user", content: userMsg },
    ],
  });
  deps.usageTracker.record({
    taskType: "audit", model: deps.auditModelId,
    promptTokens: result.usage.promptTokens, completionTokens: result.usage.completionTokens,
    chapterNo: ctx.chapterNo,
  });
  return parseAuditOutput(result.text);
}
```

- [ ] **步骤 3:`buildAuditUserPrompt` 拼接所有上下文为人类可读的中文段落**(规约:每段以 `## 标题` 开头,角色按 `名字: 描述(关键特征)` 列出,伏笔按 `[标签] 描述(状态)`)

- [ ] **步骤 4:测试通过 → commit `实现 audit_chapter 编排器`**

---

### Task 4.3:audit 结果落盘

**文件:**
- 修改:`packages/server/src/db/repositories/chapters.ts`(确保有 `saveAudit / saveSummary / getAudit / getSummary`)
- 创建:`packages/server/tests/integration/audit-persistence.test.ts`

- [ ] **步骤 1:在 `chapters` repo 上加方法**

```ts
saveAudit(chapterNo: number, audit: ChapterAuditOutput, model: string) {
  db.prepare(`INSERT OR REPLACE INTO chapter_audits
    (chapter_no, verdict, issues, audit_model, audited_at)
    VALUES(?,?,?,?,?)`).run(chapterNo, audit.verdict,
      JSON.stringify(audit.issues), model, Date.now());
}
saveSummary(chapterNo: number, s: ChapterAuditOutput["summary"], reasoning?: string) {
  db.prepare(`INSERT OR REPLACE INTO chapter_summaries
    (chapter_no, one_liner, paragraph, key_events, generated_at, reasoning_content)
    VALUES(?,?,?,?,?,?)`).run(chapterNo, s.oneLiner, s.paragraph,
      JSON.stringify(s.keyEvents), Date.now(), reasoning ?? null);
}
```

- [ ] **步骤 2:audit-orchestrator 末尾调 `saveAudit + saveSummary`**

- [ ] **步骤 3:写集成测试** —— 用真 SQLite 跑 auditChapter(mock LLM 返一个 warning verdict + 完整 summary),断言:
  - `chapter_audits` 表对该 chapterNo 有 1 行,verdict = "warning",`issues` JSON 解析后 length = 7
  - `chapter_summaries` 表 `one_liner` / `paragraph` 与 mock 一致
  - 二次 audit(同章节)→ INSERT OR REPLACE 覆盖,行数仍为 1

- [ ] **步骤 4:测试通过 → commit `实现审查结果与摘要的持久化`**

---

### Task 4.4:critical issue 触发 repair

**文件:**
- 创建:`packages/server/src/ai/prompts/repair-chapter.ts`、`packages/server/src/ai/orchestrator/repair-chapter.ts`、对应测试

- [ ] **步骤 1:写 prompt `repair-chapter.ts`**

```ts
export const REPAIR_PROMPT = `你正在修复一段已经写好的章节。
你将收到:
1) 原章节正文
2) 审查报告(列出每个 critical / warning 问题)
3) 上下文(角色 / 伏笔 / rules)

请只输出修复后的完整章节正文(不输出标题、不输出说明)。
修复原则:
- 仅修复 critical / warning 标出的问题,**不要重写整章**
- 保持原作叙述视角与节奏不变
- 涉及伏笔或角色状态时,严格遵循上下文,不要新增设定`;
```

- [ ] **步骤 2:实现 `repairChapter` orchestrator** —— 输入 `{ chapterContent, audit, contextSnapshot }` → 调写作模型 streamText → 拼成新正文 → 与 writeChapterSimple 同样写入新 version,`source: "ai_rewrite"`,`saveAudit` 重新 audit 一次(若 critical 仍存在则不覆盖原文,UI 提示用户决定)

- [ ] **步骤 3:写集成测试** —— mock 第一次 LLM 返回有 critical 的正文 + audit;mock 第二次 LLM 返回修复后正文 + ok 的 audit;调 `writeChapterWithAudit` 期望:
  - chapter_versions 有 2 行(`ai_write` + `ai_rewrite`)
  - 最终 `chapter_audits.verdict = "ok"`

- [ ] **步骤 4:写 critical 仍存在的路径测试** —— 第二次 audit 仍 critical,断言保留两个 version,`chapter_audits` 是新一次结果(critical),并通过 SSE 推送 `tool_call_end` 类型 `repair_failed`,UI 后续会问用户

- [ ] **步骤 5:commit `实现 critical 触发的章节修复流程`**

---

### Task 4.5:写章节 → audit → 落盘 端到端集成测试

**文件:**
- 创建:`packages/server/tests/integration/write-then-audit.test.ts`

- [ ] **步骤 1:写测试** —— 用真实 SQLite + 临时目录 + mock LLM(写作模型 + audit 模型 两个 mock):
  1. mock writer 返回固定章节正文 "..."
  2. mock auditor 返回固定 JSON(verdict = "ok",一个完整 summary)
  3. 调 `writeChapterWithAudit({bookId, chapterNo: 1, userIntent: "..."})`
  4. 断言:
     - .md 文件存在
     - `chapter_versions` 有 1 行
     - `chapter_audits` verdict = "ok"
     - `chapter_summaries.one_liner` 不为空
     - `token_usage` 至少 2 行(write + audit 各一)
     - books.total_cost_usd 大于 0

- [ ] **步骤 2:写性能软断言** —— 整个流程在 mock 模式下 < 1 秒

- [ ] **步骤 3:加状态广播测试** —— 在 conversations 表中追加一条 `system` 角色的消息 `"AI 完成第 1 章并通过审查"`(为后续 UI 显示与 §6.4 一致)

- [ ] **步骤 4:commit `添加章节写作与审查端到端集成测试`**

---

## 阶段 5:Context Builder + 召回

### Task 5.1:BookSnapshot

**文件:**
- 创建:`packages/server/src/ai/context-builder/snapshot.ts`、`packages/server/tests/unit/ai/context-builder/snapshot.test.ts`

- [ ] **步骤 1:写失败测试** —— 用真 SQLite + 几条 fixture(2 个角色、3 个大纲节点、2 个伏笔、1 章 summary),调 `loadBookSnapshot(repos, bookId)` 后断言返回结构

```ts
export interface BookSnapshot {
  meta: { title: string; premise: string; tone?: string; genre?: string };
  rulesMd: string;
  characters: Character[];
  outline: OutlineNode[];
  activeForeshadowing: Foreshadowing[];
  paidForeshadowing: Foreshadowing[];     // 用于 audit 校验
  recentSummaries: ChapterSummary[];      // 最近 3 章
  allSummaries: ChapterSummary[];         // 全部,供召回
  genreSections: { section: GenreSection; items: GenreSectionItem[] }[];
}
```

- [ ] **步骤 2:实现 `loadBookSnapshot(repos, paths, bookId)`** —— 一次性把 8 个数据来源全拉进内存,顺便读 rules.md 文件;`recentSummaries` 是按 chapterNo desc 取前 3

- [ ] **步骤 3:加缓存层** —— 同一 bookId 的 snapshot 在 1 个 LLM 调用周期内只构建一次(对外提供 `withSnapshot(bookId, fn)`),避免一次写章+审章构造两遍

- [ ] **步骤 4:测试通过 → commit `添加书状态快照构建`**

---

### Task 5.2:章节召回算法

**文件:**
- 创建:`packages/server/src/ai/context-builder/recall.ts`、`packages/server/tests/unit/ai/context-builder/recall.test.ts`

- [ ] **步骤 1:写失败测试** —— 构造 10 章 summaries,每章 keyEvents 含若干 character / foreshadowing 标签;调 `recallChapters({ allSummaries, currentChapterNo: 11, intentCharacters: ["林尘"], intentForeshadowing: ["黑剑之谜"], topK: 5 })`,断言:
  - 返回 5 章
  - 第 1 名是同时含两个标签的章节
  - 排除最近 3 章(currentChapterNo - 3 之内)
  - 评分公式:`5 * |相同角色集合| + 10 * |相同伏笔集合|`

```ts
it("评分按公式 5*角色 + 10*伏笔", () => {
  const summaries = [
    sum(1, ["林尘"], ["黑剑之谜"]),
    sum(2, ["林尘", "师妹"], []),
    sum(3, [], ["黑剑之谜"]),
  ];
  const top = recallChapters({
    allSummaries: summaries, currentChapterNo: 10,
    intentCharacters: ["林尘"], intentForeshadowing: ["黑剑之谜"], topK: 3,
  });
  expect(top.map(s => s.chapterNo)).toEqual([1, 3, 2]); // 1: 5+10=15; 3: 0+10=10; 2: 5+0=5
});
```

- [ ] **步骤 2:实现**

```ts
export function recallChapters(input: {
  allSummaries: ChapterSummary[]; currentChapterNo: number;
  intentCharacters: string[]; intentForeshadowing: string[]; topK?: number;
}): ChapterSummary[] {
  const cs = new Set(input.intentCharacters), fs = new Set(input.intentForeshadowing);
  const scored = input.allSummaries
    .filter(s => s.chapterNo < input.currentChapterNo - 3)
    .map(s => {
      let cScore = 0, fScore = 0;
      for (const ev of s.keyEvents) {
        for (const c of ev.characters) if (cs.has(c)) cScore += 1;
        for (const f of ev.foreshadowingRefs) if (fs.has(f)) fScore += 1;
      }
      return { s, score: 5 * cScore + 10 * fScore };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, input.topK ?? 5);
  return scored.map(x => x.s);
}
```

- [ ] **步骤 3:加性能测试** —— 200 章 summaries,1000 次召回 < 1 秒

- [ ] **步骤 4:commit `实现章节召回评分算法`**

---

### Task 5.3:Token budget + 裁剪

**文件:**
- 创建:`packages/server/src/ai/context-builder/budget.ts`、对应测试

- [ ] **步骤 1:写失败测试**

```ts
import { describe, it, expect } from "vitest";
import { estimateTokens, fitWithinBudget } from "../../../../src/ai/context-builder/budget.ts";

describe("budget", () => {
  it("estimateTokens 中英混合粗估(每个汉字 1.5,字母 / 4)", () => {
    expect(estimateTokens("你好world")).toBeGreaterThan(0);
  });
  it("fitWithinBudget 按优先级保留", () => {
    const sections = [
      { id: "rules", priority: 100, text: "x".repeat(1000) },
      { id: "characters", priority: 90, text: "y".repeat(2000) },
      { id: "recall", priority: 50, text: "z".repeat(4000) },
    ];
    const r = fitWithinBudget(sections, { budgetTokens: 600 });
    expect(r.kept.find(s => s.id === "rules")).toBeTruthy();
    expect(r.dropped.length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **步骤 2:实现**

```ts
export function estimateTokens(text: string): number {
  const cn = (text.match(/[一-龥]/g)?.length ?? 0) * 1.5;
  const en = Math.ceil((text.match(/[A-Za-z0-9]+/g)?.join("").length ?? 0) / 4);
  return Math.ceil(cn + en + (text.length - cn - en * 4) * 0.3);
}

export interface Section { id: string; priority: number; text: string; }
export function fitWithinBudget(
  sections: Section[],
  opts: { budgetTokens: number; truncate?: (s: Section, max: number) => Section },
): { kept: Section[]; dropped: Section[]; usedTokens: number } {
  const sorted = [...sections].sort((a, b) => b.priority - a.priority);
  const kept: Section[] = [], dropped: Section[] = [];
  let used = 0;
  for (const s of sorted) {
    const tk = estimateTokens(s.text);
    if (used + tk <= opts.budgetTokens) { kept.push(s); used += tk; }
    else if (opts.truncate && opts.budgetTokens - used > 200) {
      const trimmed = opts.truncate(s, opts.budgetTokens - used);
      kept.push(trimmed); used += estimateTokens(trimmed.text);
    } else dropped.push(s);
  }
  return { kept, dropped, usedTokens: used };
}
```

- [ ] **步骤 3:加裁剪策略默认实现** —— 对召回类 section,按 paragraph 长度截前 80%;对角色卡,只留 main characters(role=protagonist)

- [ ] **步骤 4:测试通过 → commit `实现 token 预算与分级裁剪`**

---

### Task 5.4:完整 ContextBuilder 装配

**文件:**
- 创建:`packages/server/src/ai/context-builder/builder.ts`、`packages/server/tests/integration/context-builder.test.ts`

- [ ] **步骤 1:写集成测试** —— 真 SQLite + fixture(20 章 summaries 含交叉角色伏笔),调 `buildWriteContext({ snapshot, currentChapterNo: 21, intent })`,断言 messages 顺序固定为:

```
1. system:           SYSTEM_PROMPT
2. user (静态包):    [premise + tone + genre]
                     [rules.md 全文]
                     [活跃伏笔]
                     [题材专属板块全量]
                     [完整角色卡]
3. user (动态包):    [滑窗最近 3 章 paragraph]
                     [召回 5 章 paragraph]
                     [本章大纲]
                     [用户最新指令]
```

确保静态包永远在前(prompt cache 友好),动态包在后。

- [ ] **步骤 2:实现 `buildWriteContext`**

```ts
export interface BuildOptions {
  snapshot: BookSnapshot;
  currentChapterNo: number;
  intent: { characters: string[]; foreshadowing: string[]; userMessage: string; chapterPlan?: string };
  budgetTokens?: number;  // default: 模型上下文 - 输出预留
}
export function buildWriteContext(opts: BuildOptions): CoreMessage[] {
  const recent = opts.snapshot.recentSummaries.slice(0, 3);
  const recalled = recallChapters({
    allSummaries: opts.snapshot.allSummaries,
    currentChapterNo: opts.currentChapterNo,
    intentCharacters: opts.intent.characters,
    intentForeshadowing: opts.intent.foreshadowing, topK: 5,
  });

  const staticBlock = renderStaticBlock(opts.snapshot);
  const dynamicBlock = renderDynamicBlock({ recent, recalled, intent: opts.intent });

  const sections: Section[] = [
    { id: "static", priority: 100, text: staticBlock },
    { id: "dynamic", priority: 90, text: dynamicBlock },
  ];
  const fitted = fitWithinBudget(sections, { budgetTokens: opts.budgetTokens ?? 32_000 });
  return [
    { role: "system", content: SYSTEM_PROMPT },
    ...fitted.kept.map(s => ({ role: "user" as const, content: s.text })),
  ];
}
```

- [ ] **步骤 2.5:实现 `renderStaticBlock` 与 `renderDynamicBlock`** —— 用固定 markdown 子节标题(`## 设定 / ## 角色 / ## 活跃伏笔 / ## 本章大纲`),便于人工调试

- [ ] **步骤 3:把 writeChapterSimple、auditChapter、reviseSegment 全部改为通过 ContextBuilder 取 messages,删除原本散落的拼装代码**

- [ ] **步骤 4:回归测试通过 → commit `统一通过 ContextBuilder 装配 prompt`**

---

## 阶段 6:题材板块 AI 自创

### Task 6.1:GenreSection schema 校验

**文件:**
- 修改:`packages/shared/src/types/genre-section.ts`(把 schema 字段类型集合枚举化)

- [ ] **步骤 1:加 Zod schema**

```ts
import { z } from "zod";
export const FieldTypeSchema = z.union([
  z.literal("string"), z.literal("text"), z.literal("number"),
  z.object({ kind: z.literal("enum"), values: z.array(z.string()).min(2) }),
  z.literal("ref:character"),
  z.string().regex(/^ref:section:[\w一-龥\-]+$/),  // ref:section:<name>
  z.string().regex(/^list:(string|text|number|ref:character|ref:section:[\w一-龥\-]+)$/),
]);
export const GenreSectionFieldSchema = z.object({
  name: z.string().min(1),
  type: FieldTypeSchema,
  required: z.boolean().default(false),
  description: z.string().optional(),
});
export const GenreSectionSchema = z.object({
  id: z.string(), name: z.string().min(1),
  schema: z.array(GenreSectionFieldSchema).min(1),
  createdBy: z.enum(["ai","user"]),
  createdAt: z.number().int(),
});
export type GenreSection = z.infer<typeof GenreSectionSchema>;
```

- [ ] **步骤 2:写测试覆盖**

```ts
it("接受合法 schema", () => {
  GenreSectionSchema.parse({ id: "x", name: "功法", createdBy: "ai", createdAt: 1,
    schema: [{ name: "tier", type: { kind: "enum", values: ["下品","中品","上品"] }, required: true }]});
});
it("拒绝 enum 少于 2 项", () => {
  expect(() => GenreSectionSchema.parse({ /* schema: enum values: ["仅一项"] */ })).toThrow();
});
it("拒绝未知类型", () => {
  expect(() => GenreSectionSchema.parse({ /* type: "magic" */ })).toThrow();
});
it("接受 ref:section:功法", () => { /* OK */ });
it("接受 list:ref:character", () => { /* OK */ });
```

- [ ] **步骤 3:加 item 数据校验函数 `validateItemAgainstSchema(section, data)`** —— 字段缺失(required)抛错;type 不匹配抛错;`ref:character` 检查存在性需注入 charactersRepo

- [ ] **步骤 4:测试通过 → commit `添加 GenreSection schema 校验`**

---

### Task 6.2:6 个 GenreSection AI Tools

**文件:**
- 创建:`packages/server/src/ai/tools/genre-section-tools.ts`、`packages/server/src/ai/tools/registry.ts`、对应测试

- [ ] **步骤 1:工具定义** —— 用 `ai` 包的 `tool({ description, parameters, execute })`,共 6 个:

```ts
import { tool } from "ai";
import { z } from "zod";

export function makeGenreSectionTools(deps: GenreToolsDeps) {
  return {
    create_genre_section: tool({
      description: "创建一个题材专属板块,用于追踪本题材独有的世界观元素",
      parameters: z.object({
        name: z.string().describe("板块名,如 '功法体系'"),
        schema: z.array(GenreSectionFieldSchema).min(1),
      }),
      execute: async ({ name, schema }) => deps.repo.create({ name, schema, createdBy: "ai" }),
    }),
    update_genre_section_schema: tool({ /* ... */ }),
    delete_genre_section: tool({ /* ... */ }),
    add_genre_section_item: tool({
      description: "向某个板块添加一个条目(必须先有板块)",
      parameters: z.object({ sectionName: z.string(), data: z.record(z.unknown()) }),
      execute: async ({ sectionName, data }) => {
        const section = deps.repo.getByName(sectionName);
        if (!section) throw new Error(`板块不存在:${sectionName}`);
        validateItemAgainstSchema(section, data, deps.charactersRepo);
        return deps.repo.addItem(section.id, data);
      },
    }),
    update_genre_section_item: tool({ /* ... */ }),
    delete_genre_section_item: tool({ /* ... */ }),
  };
}
```

- [ ] **步骤 2:实现 `registry.ts`** —— 注册函数 `buildToolRegistry(deps): Record<string, Tool>`,把所有 tools 收集到一起,后续在 orchestrator 里按需注入

- [ ] **步骤 3:测试覆盖每个工具的 happy path 与错误 path**(板块不存在、schema 校验失败、删除一个还有 items 的板块时是否级联或拒绝)

- [ ] **步骤 4:决定语义** —— 删板块时同时删 items(级联),并记日志;改 schema 时若已有 item 不符合新 schema → 抛错并要求 AI 处理

- [ ] **步骤 5:commit `添加题材板块 6 个 AI 工具`**

---

### Task 6.3:GenreSection 工具单元测试加固

**文件:**
- 创建:`packages/server/tests/unit/ai/tools/genre-section-tools.test.ts`(扩充)

- [ ] **步骤 1:用 in-memory SQLite + 真实 repo 跑工具,断言**:
  - 创建一个 schema 含 `ref:character` 字段、且对应角色存在 → 成功
  - 创建一个含 `ref:character` 字段但目标 character_id 不存在 → 抛错(在 add_item 时校验)
  - 创建两个名字相同的板块 → 第二次抛"板块名已存在"
  - 改 schema 删字段时,已有 items 仍能加载(忽略多余字段)
  - 改 schema 加 required 字段后,旧 items 用 fallback `null`(并记 warning,而非抛错)
  - delete_genre_section 删除后 items 同步删除

- [ ] **步骤 2:再加"非法 schema"被工具入参 Zod 拦截测试**(如 type = "magic"、enum.values 长度 1)

- [ ] **步骤 3:测试通过 → commit `加强 GenreSection 工具的单元测试`**

---

### Task 6.4:对话触发 AI 自创板块的集成测试

**文件:**
- 创建:`packages/server/tests/integration/genre-section-conversation.test.ts`

- [ ] **步骤 1:写测试** —— mock LLM 在收到"我想写仙侠,主角废功法"后输出 tool_call 序列:

```
1. tool_call: create_genre_section({ name: "功法体系", schema: [...] })
2. tool_call: create_genre_section({ name: "境界", schema: [...] })
3. tool_call: add_genre_section_item({ sectionName: "境界", data: {name: "炼气", order: 1} })
4. text: "我建了功法体系和境界两个板块,要补法器吗?"
```

调 `runChat({ ... })` 让其执行多步工具调用(Vercel AI SDK 自动连续 tool-use)

- [ ] **步骤 2:断言**:
  - SQLite `genre_sections` 表有 2 行
  - `genre_section_items` 表有 1 行,含 "炼气"
  - SSE 事件序列包含 `tool_call_start` × 3、`tool_call_end` × 3、最终 text_delta + done
  - assistant 消息落到 conversations 表(role="assistant",含 toolCalls 元数据)

- [ ] **步骤 3:错误路径** —— mock LLM 试图 `delete_genre_section("不存在")` → 工具抛错 → SSE 收到 `tool_call_end.result = { error: "..." }`,LLM 在第二轮收到错误后改正为成功,通过 happy path

- [ ] **步骤 4:commit `添加题材板块 AI 自创集成测试`**

---

## 阶段 7:新建书对话流程

### Task 7.1:new-book orchestrator + onboard prompt

**文件:**
- 创建:`packages/server/src/ai/prompts/new-book-onboard.ts`、`packages/server/src/ai/orchestrator/new-book.ts`、`packages/server/src/ai/tools/book-meta-tools.ts`

- [ ] **步骤 1:写 onboard prompt(中文)**

```ts
export const NEW_BOOK_ONBOARD_PROMPT = `你正在帮助一位作者新建一本小说。
你的任务:通过对话收集足够的基础信息,然后调用工具落地。

询问纪律:
- 一次只问最关键的下一个缺失项,不要一次问多个
- 简短、口语化、避免复制问卷的语气
- 用户答得模糊时,给一两个具体方向让他选(而不是再追问"能更具体吗?")

需要的最少信息:
1) 题材(必备)
2) 至少一个主角(名字、关键人设要素)
3) 至少一个一级大纲(卷或主线弧)
4) 调性 / 篇幅 / premise 至少给到两项

识别到题材后立即调用 create_genre_section 创建对应板块(默认 3-5 个常用板块,告诉用户可改可删)。

信息够了立即收尾:用工具 set_book_meta + create_character + create_outline_node 落盘,然后输出一句"基础设定好了,要不要现在开始写第一章?"`;
```

- [ ] **步骤 2:实现 6 个 book-meta tools**:`set_book_meta`(title/premise/tone/genre/lengthTarget,partial 合并)、`create_character`、`update_character`、`create_outline_node`、`update_outline_node`、`set_rules_md`

- [ ] **步骤 3:实现 orchestrator `runNewBookConversation`** —— 与 runChat 类似,但 system prompt 用 NEW_BOOK_ONBOARD_PROMPT,工具集为 genre-section-tools + book-meta-tools 合集

- [ ] **步骤 4:加路由 `POST /api/books/:bookId/onboard`(其中 bookId 是占位,创建空书后才有)** —— 流程:`POST /api/books` 创建空书 → 跳转 `onboard`

- [ ] **步骤 5:测试覆盖工具调用副作用**(单元测试每个工具)

- [ ] **步骤 6:commit `添加新建书 orchestrator 与提示`**

---

### Task 7.2:信息够判断逻辑

**文件:**
- 创建:`packages/server/src/ai/orchestrator/onboard-completeness.ts`、对应测试

- [ ] **步骤 1:写函数 `isOnboardComplete(snapshot: BookSnapshot): { ok: boolean; missing: string[] }`**

```ts
export function isOnboardComplete(s: BookSnapshot) {
  const missing: string[] = [];
  if (!s.meta.genre) missing.push("题材");
  if (!s.characters.some(c => c.role === "protagonist")) missing.push("主角");
  if (!s.outline.some(n => n.level === "volume" || n.level === "arc")) missing.push("一级大纲");
  let extras = 0;
  if (s.meta.premise) extras += 1;
  if (s.meta.tone) extras += 1;
  if ((s.meta as any).lengthTarget) extras += 1;
  if (extras < 2) missing.push("调性/篇幅/premise(至少两项)");
  return { ok: missing.length === 0, missing };
}
```

- [ ] **步骤 2:写测试覆盖**:全空 → ok=false, missing 含 4 项;只有 genre + 1 protagonist + 1 volume + premise + tone → ok=true;少 1 项 → ok=false 且 missing 准确

- [ ] **步骤 3:在 runNewBookConversation 的每轮 LLM 之间插入"完整性提示"** —— 把 `missing` 列表通过 system tool message 塞回 LLM,引导其问下一个缺项

- [ ] **步骤 4:加 endpoint `GET /api/books/:bookId/onboard-status` 返回 `{ ok, missing }`**(供前端显示进度)

- [ ] **步骤 5:commit `实现新建书完成度判断`**

---

### Task 7.3:新建书完整流程集成测试

**文件:**
- 创建:`packages/server/tests/integration/new-book-flow.test.ts`

- [ ] **步骤 1:用 mock LLM 编写脚本化对话**(三轮 user / assistant):

```
轮 1 user: "我想写个仙侠的,主角是被废功法的弃婴重修崛起。"
轮 1 assistant: tool_calls = [
  set_book_meta({genre:"仙侠", premise:"被废功法的弃婴重修崛起"}),
  create_genre_section({name:"功法体系", schema:[...]}),
  create_genre_section({name:"境界", schema:[...]}),
  create_genre_section({name:"法器丹药", schema:[...]}),
] → text: "题材是仙侠对吧?主角叫什么?调性想要热血还是清冷?"

轮 2 user: "叫林尘,清冷克制点。"
轮 2 assistant: tool_calls = [
  create_character({name:"林尘", role:"protagonist", baseData:{...}}),
  set_book_meta({tone:"清冷"}),
] → text: "卷一打算从他重修开始,讲到第一次复仇可以吗?"

轮 3 user: "可以。"
轮 3 assistant: tool_calls = [
  create_outline_node({level:"volume", title:"卷一:重生", summary:"..."}),
] → text: "基础设定好了,要不要现在开始写第一章?"
```

- [ ] **步骤 2:执行三轮 `runNewBookConversation`,断言**:
  - SQLite `book_meta` 含 genre/premise/tone
  - `characters` 表有林尘
  - `outline_nodes` 有卷一
  - `genre_sections` 有 3 行
  - `isOnboardComplete()` 在第三轮后返回 ok=true

- [ ] **步骤 3:跳过测试** —— 调 `POST /api/books/:bookId/onboard/skip` → 仅创建空 book_meta(`title="未命名"`),`isOnboardComplete` 返回 false,但用户后续可手动添加

- [ ] **步骤 4:commit `添加新建书完整流程集成测试`**

---

## 阶段 8:前端三栏 UI

### Task 8.1:i18n 全量补全 + Library 页

**文件:**
- 修改:`packages/client/src/i18n/zh-CN.ts`(全量补全所有按钮、菜单、错误、空状态、tooltip 文案)
- 创建:`packages/client/src/pages/library.tsx`、`packages/client/src/api/client.ts`、`packages/client/tests/pages/library.test.tsx`

- [ ] **步骤 1:补全 i18n** —— 至少包含:
  - `library`: title, newBook, deleteConfirm, deleteWarning, emptyHint, lastUpdated, totalCost
  - `workspace`: tabs, autoMode, stopAuto
  - `conversation`: placeholder, sendButton, slashHint, streamingPaused
  - `editor`: title, save, history, exportTxt, exportMd
  - `sidebar`: characters, outline, foreshadowing, timeline, rules, addCharacter, deleteSection
  - `settings`: model, apiKey, savedTip, refreshModels, modelLoadFailed
  - `errors`: rateLimit, timeout, auth, contextOverflow, unknown, networkOffline
  - `common`: confirm/cancel/save/delete/retry/loading/empty/yes/no
  - `audit`: verdictOk/Warning/Critical, viewIssues, repair, accept, rewrite

- [ ] **步骤 2:写 API client `api/client.ts`** —— 封装 `fetch` + Content-Type JSON、错误抛带 `errorClass` 的 Error;封装 `streamSse(url, body, onEvent)`(用 fetch ReadableStream 解析 `event:`/`data:`)

- [ ] **步骤 3:写测试 `library.test.tsx`** —— mock `fetch /api/books` 返回 2 本书,渲染后断言列表显示书名、`点新建` 触发 `POST /api/books`、删除时弹中文确认对话框、空时显示 emptyHint

- [ ] **步骤 4:实现 `library.tsx`**

```tsx
export function LibraryPage() {
  const [books, setBooks] = useState<Book[]>([]);
  useEffect(() => { api.listBooks().then(setBooks); }, []);
  const newBook = async () => {
    const b = await api.createBook({ title: "未命名" });
    nav(`/books/${b.id}/onboard`);
  };
  return (
    <main>
      <header><h1>{t.library.title}</h1>
        <button onClick={newBook}>{t.library.newBook}</button></header>
      {books.length === 0 ? <p>{t.library.emptyHint}</p>
        : <ul>{books.map(b => <BookCard key={b.id} book={b} onDelete={...}/>)}</ul>}
    </main>
  );
}
```

- [ ] **步骤 5:测试通过 → commit `添加书架页与中文 i18n`**

---

### Task 8.2:Workspace 三栏布局壳子

**文件:**
- 创建:`packages/client/src/pages/workspace.tsx`、`packages/client/src/components/workspace/three-pane-layout.tsx`、对应测试

- [ ] **步骤 1:写测试** —— 渲染 `<WorkspacePage bookId="x" />`,断言 DOM 中存在三个 `data-testid="pane-conversation"`、`pane-editor`、`pane-sidebar`,栏宽通过 CSS grid 控制(默认 30/45/25,用户拖拽改 — 这里不实现拖拽,只先固定)

- [ ] **步骤 2:实现 layout**

```tsx
export function ThreePaneLayout(p: { left: ReactNode; center: ReactNode; right: ReactNode }) {
  return (
    <div className="three-pane" style={{
      display: "grid", gridTemplateColumns: "30% 45% 25%",
      height: "100vh", gap: 0,
    }}>
      <section data-testid="pane-conversation">{p.left}</section>
      <section data-testid="pane-editor">{p.center}</section>
      <section data-testid="pane-sidebar">{p.right}</section>
    </div>
  );
}
```

- [ ] **步骤 3:`workspace.tsx` 装配** —— 三栏内各塞一个占位 `<EmptyPane label={t.xxx.placeholder}/>`,后续 Task 8.3-8.7 替换为真实组件

- [ ] **步骤 4:加全局 CSS reset(`box-sizing: border-box`、`html,body { height:100%, margin:0 }`、中文系统字体栈)**

- [ ] **步骤 5:测试通过 → commit `添加工作台三栏布局壳子`**

---

### Task 8.3:Conversation 面板 + SSE 客户端 + 流式渲染

**文件:**
- 创建:`packages/client/src/components/conversation/conversation-pane.tsx`、`packages/client/src/components/conversation/message.tsx`、`packages/client/src/components/conversation/streaming-message.tsx`、`packages/client/src/api/streaming.ts`、`packages/client/src/stores/conversation.ts`、对应测试

- [ ] **步骤 1:写 zustand store**

```ts
interface ConversationStore {
  messages: Message[];
  streaming: { id: string; text: string; reasoning: string; toolEvents: ToolEvent[] } | null;
  appendUserMessage(content: string): void;
  beginStream(id: string): void;
  appendDelta(delta: string): void;
  appendReasoning(delta: string): void;
  pushToolEvent(ev: ToolEvent): void;
  finishStream(): void;
  setError(message: string, errorClass: string): void;
}
```

- [ ] **步骤 2:实现 `streaming.ts`** —— `streamSse(url, body, on: (ev: SseEvent) => void): { cancel(): void }`,内部用 `fetch` + `body.getReader()` 解析 SSE 文本协议,把每个 `data:` JSON parse 后送 `on`

- [ ] **步骤 3:写 RTL 测试** —— mock `streamSse` 接收一组事件后,断言 UI:依次出现"加载中"占位 → 文本逐字浮现 → 工具调用气泡 → 最终消息固化到 messages 列表

- [ ] **步骤 4:实现 `ConversationPane`**

```tsx
export function ConversationPane({ bookId }: { bookId: string }) {
  const { messages, streaming, send } = useConversation(bookId);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  return (
    <div className="conv">
      <div className="msgs">
        {messages.map(m => <Message key={m.id} m={m} />)}
        {streaming && <StreamingMessage state={streaming} />}
      </div>
      <Composer onSend={(text) => send(text)} ref={inputRef} />
    </div>
  );
}
```

- [ ] **步骤 5:Composer 支持 Cmd/Ctrl+Enter 发送、Esc 中止流(调 fetch AbortController)、Enter 换行**

- [ ] **步骤 6:错误处理** —— SSE error 事件 → store.setError → UI 用 ToastBanner 显示中文提示 + 重试按钮

- [ ] **步骤 7:commit `添加对话面板与流式渲染`**

---

### Task 8.4:ChapterEditor(TipTap)

**文件:**
- 创建:`packages/client/src/components/editor/chapter-editor.tsx`、`packages/client/src/components/editor/markdown-bridge.ts`、对应测试

- [ ] **步骤 1:加依赖**(`@tiptap/react`、`@tiptap/starter-kit`、`@tiptap/extension-character-count`、`marked`、`turndown`)

- [ ] **步骤 2:写 markdown 双向桥接 `markdown-bridge.ts`**

```ts
import { marked } from "marked";
import TurndownService from "turndown";
const td = new TurndownService({ headingStyle: "atx" });
export function mdToHtml(md: string): string { return marked.parse(md, { async: false }) as string; }
export function htmlToMd(html: string): string { return td.turndown(html); }
```

加单元测试:`mdToHtml(htmlToMd(html))` 在标题/段落/粗体/斜体/列表上往返一致(允许小空白差异)

- [ ] **步骤 3:实现 `ChapterEditor`**

```tsx
export function ChapterEditor({ chapter, onSave }: { chapter: ChapterRecord; onSave: (md: string) => void }) {
  const editor = useEditor({
    extensions: [StarterKit, CharacterCount],
    content: mdToHtml(chapter.content),
    onUpdate: throttle(({ editor }) => {
      const md = htmlToMd(editor.getHTML());
      onSave(md);
    }, 1500),
  });
  return (
    <div>
      <header>
        <h2>{chapter.title}</h2>
        <span>{editor?.storage.characterCount.characters() ?? 0} 字</span>
      </header>
      <EditorContent editor={editor} />
    </div>
  );
}
```

- [ ] **步骤 4:加 1.5 秒节流自动保存,通过 `PUT /api/books/:bookId/chapters/:no` 写入,服务端会创建 source = "user_edit" 的新 version**

- [ ] **步骤 5:写 RTL 测试** —— 渲染 → 输入 → 1.6 秒后 mock fetch 被调用 → 内容是 markdown 格式

- [ ] **步骤 6:commit `添加 TipTap 章节编辑器与双向 Markdown`**

---

### Task 8.5:选段改写浮动条 + revise-segment 全链路

**文件:**
- 创建:`packages/client/src/components/editor/selection-toolbar.tsx`、`packages/server/src/ai/orchestrator/revise-segment.ts`、`packages/server/src/ai/prompts/revise-segment.ts`、`packages/server/src/http/routes/revise.ts`、对应测试

- [ ] **步骤 1:写 server 端 prompt**

```ts
export const REVISE_PROMPT = `你正在改写章节中的一段。你将收到:
1) 完整章节正文(标记 <SEG>...</SEG> 包裹的为待改段落)
2) 用户指令(如"重写,要更克制")
3) 当前的角色卡 / 活跃伏笔(供参考)

只输出新段落原文,不输出说明,不输出包裹标记。`;
```

- [ ] **步骤 2:实现 `revise-segment.ts` orchestrator** —— 输入 `{ chapterContent, segmentRange, instruction, snapshot }` → 调写作模型 → SSE 流回 `text_delta`,完成后服务端**不直接保存**,前端用户接受后才提交

- [ ] **步骤 3:加路由 `POST /api/books/:bookId/chapters/:no/revise-segment`** SSE 流(stream 模式),body `{ segmentText, segmentRange, instruction }`;另加 `POST /api/books/:bookId/chapters/:no/apply-revision` body `{ segmentRange, newSegment }` 同步落盘

- [ ] **步骤 4:实现 `SelectionToolbar`**

```tsx
export function SelectionToolbar({ editor, onRevise }: Props) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  useEffect(() => {
    const handler = () => {
      const sel = editor?.view.state.selection;
      if (!sel || sel.empty) { setShow(false); return; }
      const coords = editor.view.coordsAtPos(sel.from);
      setPos({ x: coords.left, y: coords.top - 36 }); setShow(true);
    };
    editor?.on("selectionUpdate", handler);
    return () => editor?.off("selectionUpdate", handler);
  }, [editor]);
  if (!show) return null;
  return <div style={{ position: "absolute", left: pos.x, top: pos.y }}>
    <button onClick={() => onRevise("rewrite")}>{t.editor.toolbar.rewrite}</button>
    <button onClick={() => onRevise("simplify")}>{t.editor.toolbar.simplify}</button>
    <button onClick={() => onRevise("intensify")}>{t.editor.toolbar.intensifyEmotion}</button>
    <button onClick={() => onRevise("custom")}>{t.editor.toolbar.custom}</button>
  </div>;
}
```

- [ ] **步骤 5:点"自定义指令"后弹出输入框,提交后流式拉新段落到对话面板的"📍 段落引用"消息中,用户接受 → 调 apply-revision → 更新编辑器内容(在 segmentRange 内替换)**

- [ ] **步骤 6:测试覆盖** —— RTL 模拟选区、点按钮、断言对话面板出现新消息;集成测试 mock LLM,验证 apply-revision 后 .md 与 SQLite version 都更新,source = "segment_revise"

- [ ] **步骤 7:commit `实现选段改写浮动条与编排`**

---

### Task 8.6:SidePanel 容器 + 5 个内置面板

**文件:**
- 创建:`packages/client/src/components/sidebar/side-panel.tsx`、`characters-panel.tsx`、`outline-panel.tsx`、`foreshadowing-panel.tsx`、`timeline-panel.tsx`、`rules-panel.tsx`、对应测试

- [ ] **步骤 1:`SidePanel` 容器** —— 上方 tab 切换"角色 / 大纲 / 伏笔 / 时间线 / 规则",下方按 tab 渲染对应子面板;tabs 数据通过 zustand 拿(后续题材板块也加进 tabs)

- [ ] **步骤 2:`CharactersPanel`** —— 列出所有角色,展示 name / role / 关键 baseData;点角色卡可展开 currentState / appearances;点铅笔图标进入编辑模式(直接发 PUT 到 server,server 同时给对话流追加 system 消息广播给 LLM)

- [ ] **步骤 3:`OutlinePanel`** —— 树状展示 outline_nodes(volume → arc → chapter),折叠/展开,点 chapter 节点跳转到对应章节

- [ ] **步骤 4:`ForeshadowingPanel`** —— 分两组:Active(默认展开)/Paid(默认折叠);每条显示标签 + 描述 + 埋点章节 + 关联角色;支持手动加/删

- [ ] **步骤 5:`TimelinePanel`** —— 按 chapterNo 分组,每章下列事件(story_time + event + participants)

- [ ] **步骤 6:`RulesPanel`** —— 显示 rules.md 文本,有"编辑"按钮进入 textarea 模式,保存写入 `books/<id>/rules.md`

- [ ] **步骤 7:每个面板写 RTL 测试**(mock fetch 数据,断言渲染 + 编辑 + 删除分支)

- [ ] **步骤 8:commit `添加 5 个内置资料面板`**(单独提交每个面板,共 5 个 commit)

---

### Task 8.7:GenreSectionPanel(动态 schema 渲染)

**文件:**
- 创建:`packages/client/src/components/sidebar/genre-section-panel.tsx`、`packages/client/src/components/sidebar/dynamic-field-input.tsx`、`packages/client/src/components/sidebar/schema-editor.tsx`、对应测试

- [ ] **步骤 1:`DynamicFieldInput`** —— 根据字段 type 渲染不同控件:
  - `string` → `<input type="text">`
  - `text` → `<textarea>`
  - `number` → `<input type="number">`
  - `enum` → `<select>` 给出 values
  - `ref:character` → `<select>` 加载所有 characters
  - `ref:section:<name>` → `<select>` 加载该 section 的 items
  - `list:<inner>` → 列表加 + 按钮,每项一个对应 inner 类型的 input

- [ ] **步骤 2:`GenreSectionPanel`** —— 列出该板块所有 items,每行用 schema 渲染只读视图;点条目展开编辑;点"添加"按钮空表单提交

- [ ] **步骤 3:`SchemaEditor`** —— 板块右上角铅笔图标进入此模式,可加/改/删字段,保存时 PUT `/api/books/:id/genre-sections/:sectionId/schema`,server 端再次 Zod 校验,若已有 items 与新 schema 不一致提示"以下条目缺少必填字段,确认仍要保存吗?"

- [ ] **步骤 4:删板块** —— 在 SchemaEditor 顶端加红色"删除整个板块"按钮,点后弹模态框,要求用户输入板块名才能确认

- [ ] **步骤 5:RTL 测试** —— 渲染各种 type 的字段、提交时 mock fetch 收到正确 payload、ref 类字段下拉选项正确

- [ ] **步骤 6:commit `添加题材板块的动态 UI 渲染`**

---

### Task 8.8:斜杠命令 UI(自动补全 + 中英 alias)

**文件:**
- 创建:`packages/client/src/components/conversation/slash-suggestions.tsx`、`packages/client/src/lib/slash-commands.ts`、`packages/server/src/ai/intent/slash-parser.ts`、对应测试

- [ ] **步骤 1:写 `slash-commands.ts` 命令注册表**

```ts
export const SLASH_COMMANDS = [
  { id: "write", aliases: ["/write", "/续写", "/写下一章"], help: "开始下一章" },
  { id: "auto", aliases: ["/auto", "/自动"], help: "自动写 N 章 (示例:/auto 5)" },
  { id: "rewrite", aliases: ["/rewrite", "/重写"], help: "重写当前章" },
  { id: "revise", aliases: ["/revise", "/改写"], help: "改写选中段(需在编辑器选中)" },
  { id: "audit", aliases: ["/audit", "/审查"], help: "对当前章立即审查" },
  { id: "recall", aliases: ["/recall", "/查找"], help: "全书检索 (示例:/recall 林尘)" },
  { id: "note", aliases: ["/note", "/便签"], help: "给 AI 留便签(只进对话)" },
  { id: "help", aliases: ["/help", "/帮助"], help: "列出所有命令" },
] as const;
```

- [ ] **步骤 2:`SlashSuggestions`** —— 当输入框第一个字符为 `/` 时弹出浮层,显示匹配的命令(模糊匹配 alias),按 `↑/↓` 选择,Enter 或 Tab 补全

- [ ] **步骤 3:server 端 `slash-parser.ts`**

```ts
export function parseSlashCommand(text: string):
  | { kind: "command"; id: string; args: string }
  | { kind: "text" } {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return { kind: "text" };
  const space = trimmed.indexOf(" ");
  const head = space < 0 ? trimmed : trimmed.slice(0, space);
  const args = space < 0 ? "" : trimmed.slice(space + 1).trim();
  for (const cmd of SLASH_COMMANDS) {
    if (cmd.aliases.includes(head)) return { kind: "command", id: cmd.id, args };
  }
  return { kind: "command", id: "unknown" } as any;
}
```

- [ ] **步骤 4:`/auto N` 解析:`args` 是数字 → `{ id:"auto", n:5 }`;非数字 → 返回错误**

- [ ] **步骤 5:对话路由先 `parseSlashCommand` 分发到对应 orchestrator;`/help` 直接 SSE 推一段中文帮助文本**

- [ ] **步骤 6:测试** —— 8 命令各覆盖中/英 alias、`/auto 5` 解析正确、未知命令返回 unknown、SlashSuggestions 自动补全 RTL 测试

- [ ] **步骤 7:commit `实现斜杠命令解析与自动补全`**

---

## 阶段 9:自动模式 + 撤销 + 用量

### Task 9.1:/auto N 状态机

**文件:**
- 创建:`packages/server/src/ai/orchestrator/auto-mode.ts`、`packages/server/tests/integration/auto-mode.test.ts`

- [ ] **步骤 1:状态定义**

```ts
type AutoState = "idle" | "planning" | "writing" | "auditing" | "paused_by_critical" | "paused_by_user" | "done" | "error";
interface AutoCtx { bookId: string; remaining: number; doneChapters: number[]; lastError?: string; }
```

- [ ] **步骤 2:实现 `runAutoMode` async generator**

```ts
export async function* runAutoMode(deps: AutoDeps, input: { bookId: string; n: number }): AsyncIterable<SseEvent | AutoStatusEvent> {
  let ctx: AutoCtx = { bookId: input.bookId, remaining: input.n, doneChapters: [] };
  yield { type: "auto_status", state: "planning", ctx };
  const cancelled = deps.cancellationToken;
  while (ctx.remaining > 0 && !cancelled.aborted) {
    const next = deps.chaptersRepo.maxChapterNo() + 1;
    yield { type: "auto_status", state: "writing", ctx };
    for await (const ev of writeChapterWithAudit(deps, { bookId, chapterNo: next })) yield ev;
    const audit = deps.chaptersRepo.getAudit(next);
    if (audit?.verdict === "critical") {
      yield { type: "auto_status", state: "paused_by_critical", ctx };
      return;
    }
    ctx.doneChapters.push(next); ctx.remaining -= 1;
  }
  yield { type: "auto_status", state: cancelled.aborted ? "paused_by_user" : "done", ctx };
}
```

- [ ] **步骤 3:把"用户在对话框开始打字"作为打断信号** —— 前端在自动模式期间监听 input,首次 keydown 调 `POST /api/books/:id/auto/cancel`,server 触发 AbortSignal

- [ ] **步骤 4:加 token budget 预检** —— 入口先估算 N 章预算(基于近 5 章平均 token):若总 cost 超过 `config.json.singleBudgetUsd`(默认 5 美元),返回 402 错误"超过单次预算上限,请到设置中调整"

- [ ] **步骤 5:集成测试** —— mock LLM 序列:第 1 章 ok,第 2 章 critical;断言只完成 1 章,state 收尾为 paused_by_critical;另一组测试 cancel 信号在第 1 章中途 → state = paused_by_user

- [ ] **步骤 6:UI 状态条** —— 工作台顶部加 `<AutoModeBar state={..} doneN/totalN/>`,有"停止"按钮

- [ ] **步骤 7:commit `实现自动模式状态机与中断`**

---

### Task 9.2:章节版本 UI(列表 + diff + 回滚)

**文件:**
- 创建:`packages/client/src/components/editor/version-history.tsx`、`packages/client/src/components/editor/diff-view.tsx`、对应测试
- 加依赖:`diff`(text 行 diff 库)

- [ ] **步骤 1:`VersionHistory`** —— 调 `GET /api/books/:id/chapters/:no/versions` 列出所有版本(versionNo 倒序),每行显示:序号、来源(中文化:"AI 写"、"AI 修复"、"用户编辑"、"段落改写")、时间、字数变化(相对上一版)

- [ ] **步骤 2:点行展开** —— 右侧显示 `<DiffView a={prevContent} b={thisContent} />`,行级 diff 用 `diff.diffLines`,删除红、增加绿

- [ ] **步骤 3:回滚按钮** —— 调 `POST /api/books/:id/chapters/:no/restore-version` body `{ versionNo }`,server 端把该版本的 contentMd 写回 .md 并新建一个 source = "user_edit" 的新 version(不是删除其它版本)

- [ ] **步骤 4:测试** —— mock 3 个版本,渲染列表,点回滚按钮触发 fetch 调用、断言 body.versionNo 正确、刷新后显示新增 version

- [ ] **步骤 5:commit `添加章节版本历史与 diff 视图`**

---

### Task 9.3:Token 用量明细 + UsageMeter

**文件:**
- 创建:`packages/client/src/components/usage-meter.tsx`、`packages/client/src/pages/usage-detail.tsx`、`packages/server/src/http/routes/usage.ts`、对应测试

- [ ] **步骤 1:server 路由** ——
  - `GET /api/books/:id/usage/summary` → `{ totalUsd, byTaskType: [...], byModel: [...], byChapter: [...] }`
  - `GET /api/books/:id/usage/recent?limit=50` → 最近 N 条
  - 实现:在 token-usage repo 上加聚合查询(SQL `GROUP BY task_type / model / chapter_no`)

- [ ] **步骤 2:`UsageMeter` 组件** —— 工作台顶部小条,显示"本会话已花 ¥X.XX (≈ $Y.YY)"以及 `[详情]` 按钮跳转 usage-detail 页

- [ ] **步骤 3:`UsageDetailPage`** —— 三段:
  - 总览:总花费、本会话花费、与单次预算上限的进度条
  - 按任务类型(write / audit / chat / segment_revise / intent / new_book)的扇形图(用 SVG 简单画,不引图表库)
  - 按章节列表:每章花费 + 显示对应章节标题
  - 按模型聚合表

- [ ] **步骤 4:测试** —— mock 后端聚合数据,断言数字正确显示、扇形图比例正确

- [ ] **步骤 5:commit `添加用量明细页与计量条`**

---

### Task 9.4:单次预算上限校验

**文件:**
- 修改:`packages/server/src/config/load.ts` 加 `singleBudgetUsd` 配置项(默认 5)
- 修改:`packages/server/src/ai/orchestrator/auto-mode.ts` 入口前置预算校验
- 创建:`packages/server/src/ai/budget-check.ts`、对应测试

- [ ] **步骤 1:实现 `estimateAutoModeCost(deps, bookId, n)`** —— 取最近 5 章 token_usage 平均(若无则用估算值 4500 字 × 1.5 token/字 ≈ 6750 + 输出 4500 ≈ 1.1 万 token / write,audit ≈ 2000),按当前模型 pricing 计算

- [ ] **步骤 2:校验失败时**:
  - 不进入自动模式
  - 服务器返回 SSE 事件 `{ type: "error", errorClass: "budget_exceeded", message: "预计花费 $X.XX,超过单次上限 $Y.YY,请到设置中调整或减少章节数" }`
  - UI 弹中文 toast,提供"去设置"按钮

- [ ] **步骤 3:在 settings 页加 `单次预算上限 (USD)` 输入框,带二次确认("调高预算上限可能产生意外消费,确认?")**

- [ ] **步骤 4:测试** —— mock pricing × n 章,断言估算值与拒绝路径

- [ ] **步骤 5:commit `添加单次预算上限校验`**

---

## 阶段 10:备份 + 导出 + 收尾

### Task 10.1:快照恢复 UI

**文件:**
- 创建:`packages/client/src/pages/snapshots.tsx`、`packages/server/src/http/routes/snapshots.ts`、对应测试

- [ ] **步骤 1:server 路由**:
  - `GET /api/books/:id/snapshots` → `[{ filename, createdAt, sizeBytes }]`
  - `POST /api/books/:id/snapshots/restore` body `{ filename, confirmText }` —— 必须 `confirmText === "RESTORE"` 才执行
  - 流程:停止后台 jobs → 解压到临时目录 → 校验完整性(workspace.db 能打开) → 移动到原目录(rename atomic) → 重启 jobs → 重载 SQLite 连接

- [ ] **步骤 2:`SnapshotsPage`** —— 列出快照(时间倒序),展示文件大小,点行进入恢复确认页

- [ ] **步骤 3:恢复确认页** —— 大字红色警告"此操作将覆盖当前所有数据(章节正文 / 角色 / 大纲 / 摘要 / 对话历史 等),请确认。",输入框要求用户打字"RESTORE"才启用按钮,提交后显示"恢复中..."进度条

- [ ] **步骤 4:测试** —— 集成测试:写 1 章 → 触发 createSnapshot → 改坏 .md 文件 → 调 restore → 断言 .md 复原、SQLite 数据回到快照点

- [ ] **步骤 5:边界** —— 若解压过程出错,回滚到原状态(不破坏当前数据);记错误日志

- [ ] **步骤 6:commit `添加快照恢复 UI 与流程`**

---

### Task 10.2:章节导出 .txt / .md

**文件:**
- 创建:`packages/server/src/http/routes/export.ts`、`packages/server/src/fs/exporter.ts`、对应测试

- [ ] **步骤 1:实现 `exporter.ts`**

```ts
export interface ExportOptions { format: "txt" | "md"; range: "all" | { from: number; to: number } | { chapter: number }; }

export async function exportChapters(deps: { chapterFiles: ChapterFiles; chaptersRepo: ChaptersRepo; exportsDir: string },
                                     bookTitle: string, opts: ExportOptions): Promise<{ path: string; bytes: number }> {
  const list = deps.chapterFiles.list();
  const filtered = filterByRange(list, opts.range);
  const buffer: string[] = [`# ${bookTitle}\n`];
  for (const ch of filtered) {
    if (opts.format === "md") {
      buffer.push(`\n## 第 ${ch.chapterNo} 章 ${ch.title}\n\n${ch.content}\n`);
    } else {
      buffer.push(`\n第 ${ch.chapterNo} 章 ${ch.title}\n\n${stripMd(ch.content)}\n`);
    }
  }
  const filename = `${bookTitle}-${formatRange(opts.range)}.${opts.format}`;
  const fullPath = path.posix.join(deps.exportsDir, filename);
  fs.mkdirSync(deps.exportsDir, { recursive: true });
  fs.writeFileSync(fullPath, buffer.join(""), "utf-8");
  return { path: fullPath, bytes: Buffer.byteLength(buffer.join(""), "utf-8") };
}
```

`stripMd` 简单去掉 # / *,保留正文(用 marked + 自定义渲染器 → 取纯文本)

- [ ] **步骤 2:路由**:
  - `POST /api/books/:id/export` body `{ format, range }` → 返回 `{ path }`,前端用浏览器原生"另存为"打开 file:// 路径(若浏览器禁用,server 同时提供 `GET /api/books/:id/exports/:filename` 直接下载)

- [ ] **步骤 3:UI** —— 编辑器顶部加"导出"下拉:本章 .txt / 本章 .md / 全书 .txt / 全书 .md;弹出下载对话框

- [ ] **步骤 4:测试** —— 单测:5 章导出 .md / .txt,断言文件内容包含每章标题与正文,顺序正确;集成测试 + RTL 模拟点击下载

- [ ] **步骤 5:commit `实现章节导出为 txt / md`**

---

### Task 10.3:错误处理 + UI Toast 系统

**文件:**
- 创建:`packages/client/src/components/toast.tsx`、`packages/client/src/stores/toast.ts`、`packages/server/src/http/errors.ts`、对应测试

- [ ] **步骤 1:server 端集中错误格式** —— 中间件捕获所有抛错,按 `errorClass` 映射 HTTP 状态:`auth → 401`、`rate_limit → 429`、`context_overflow → 413`、`budget_exceeded → 402`、其余 500;响应体 `{ errorClass, message, retryable: bool }`

- [ ] **步骤 2:i18n 文案表**

```ts
errors: {
  rate_limit: "请求过于频繁,稍候 {sec} 秒再试",
  timeout: "请求超时,可点重试",
  stream_idle: "流式输出中断,可点重试",
  auth: "API key 无效或过期,请到设置中更新",
  context_overflow: "上下文超长,已自动降级再试一次",
  budget_exceeded: "{detail}",
  unknown: "操作失败:{message}",
  network_offline: "网络不可用,请检查连接",
}
```

- [ ] **步骤 3:`ToastStore`**(zustand)

```ts
interface ToastStore {
  toasts: Array<{ id: string; level: "info"|"warning"|"error"; text: string; action?: { label: string; onClick(): void } }>;
  push(t: Omit<Toast, "id">): void;
  dismiss(id: string): void;
}
```

- [ ] **步骤 4:`<ToastContainer />`** 挂在 App 根,监听 store,3 秒自动消失(error 级常驻直到点叉)

- [ ] **步骤 5:全局 fetch 拦截器** —— `api/client.ts` 在 catch 中调 `toastStore.push({ level: "error", text: t.errors[errClass]?.replace(...) })`,对 `retryable=true` 提供"重试"按钮

- [ ] **步骤 6:RTL 测试** —— mock 401 → 弹出 "API key 无效..." toast 并保留;429 → 显示倒计时秒数

- [ ] **步骤 7:commit `添加错误分类与 Toast 系统`**

---

### Task 10.4:E2E 核心旅程

**文件:**
- 创建:`e2e/tests/core-journey.spec.ts`、`e2e/fixtures/mock-deepseek-server.ts`、修改 `e2e/playwright.config.ts` 加 `webServer: { command: "pnpm dev", url: "http://127.0.0.1:6789", timeout: 30000 }`

- [ ] **步骤 1:写 mock DeepSeek server**(用 Hono 起一个 8765 端口) —— 实现 `POST /v1/chat/completions`(stream),按测试脚本输出固定 SSE 序列;`GET /v1/models` 返固定列表

- [ ] **步骤 2:测试启动时设置 `DEEPSEEK_BASE_URL=http://127.0.0.1:8765` 让 server 走 mock**

- [ ] **步骤 3:写 E2E 脚本**

```ts
test("核心旅程:新建仙侠书 → 写第 1 章 → 审 → 改一段 → 备份恢复", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新建书" }).click();
  await page.getByPlaceholder(/想写什么/).fill("我想写仙侠,主角林尘被废功法重修崛起。");
  await page.keyboard.press("Control+Enter");
  await expect(page.getByText(/题材是仙侠对吧/)).toBeVisible({ timeout: 15_000 });
  // 进入工作台
  await page.getByRole("button", { name: "开始写第一章" }).click();
  await page.getByPlaceholder(/输入指令/).fill("/write");
  await page.keyboard.press("Control+Enter");
  await expect(page.locator('[data-testid="pane-editor"]')).toContainText(/第 ?1 ?章/, { timeout: 30_000 });
  // 审查横幅
  await expect(page.getByText(/审查通过|有警告/)).toBeVisible({ timeout: 30_000 });
  // 改一段
  await page.locator('[data-testid="pane-editor"] p').first().selectText();
  await page.getByRole("button", { name: "改写" }).click();
  await page.getByPlaceholder(/自定义指令/).fill("更克制");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "接受" })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "接受" }).click();
  // 用量
  await expect(page.getByText(/¥/)).toBeVisible();
  // 备份
  await page.goto("/snapshots");
  await expect(page.getByRole("listitem").first()).toBeVisible();
});
```

- [ ] **步骤 4:启动 server** —— playwright `webServer` 配置自动启 `pnpm dev`,加环境变量 `SCRIBE_HOME=$E2E_TMP/.scribe-data` 隔离生产数据

- [ ] **步骤 5:加 retry-on-flaky:`retries: 1`、`timeout: 60_000`(整 spec)**

- [ ] **步骤 6:运行 `pnpm test:e2e` 全绿 → commit `添加核心旅程 E2E`**

- [ ] **步骤 7:补 README 中文启动说明** —— 安装 / 配 API key / 启动 / 浏览器访问;并在 README 列出 e2e 跑法

- [ ] **步骤 8:commit `补充中文 README 启动说明`**

---

## 自审清单

- [ ] 规格 §1.4 不做项 → 设计/Task 中均未引入 epub / docx / 移动端 / 多用户(确认)
- [ ] 规格 §2 架构 → Task 0.3-0.5 + 1.2 + 3.1-3.2 实现 Hono + SSE + SQLite + .md 单进程模型
- [ ] 规格 §3.1 目录 → Task 1.1 paths.ts 三平台覆盖
- [ ] 规格 §3.2 SQLite schema → Task 1.4 一次性铺 12 张表 + 索引
- [ ] 规格 §3.3 .md + frontmatter → Task 1.5 chapter-files
- [ ] 规格 §3.4 快照 30 天滚动 → Task 1.6 + Task 10.1
- [ ] 规格 §4.1 通用骨架 5 板块 → Task 1.4 + Task 8.6 五个内置面板
- [ ] 规格 §4.2 题材专属板块 AI 自创 → Task 6.1-6.4
- [ ] 规格 §4.2.2 字段类型 7 种有限集 → Task 6.1 Zod
- [ ] 规格 §5.1-5.2 ProviderAdapter 接口 + 文件结构 → Task 2.1-2.2
- [ ] 规格 §5.3 模型列表实时拉取 + 24h 缓存 → Task 2.4
- [ ] 规格 §5.4 默认模型分配 → Task 3.4 + 4.2 中各自指定 modelId
- [ ] 规格 §5.5 reasoning_content 处理 → Task 3.3 streamLlm 区分 + Task 4.3 saveSummary 落 reasoning
- [ ] 规格 §5.6 prompt cache 友好顺序 → Task 5.4 ContextBuilder 静态/动态分块
- [ ] 规格 §5.7 7 类错误重试策略 → Task 2.3 classifyError + Task 2.5 withRetry
- [ ] 规格 §5.8 流式 5 种事件 → Task 3.1 SseEventSchema
- [ ] 规格 §6.1 Context Builder 优先级 → Task 5.4 buildWriteContext
- [ ] 规格 §6.1.1 召回评分公式 5*角色 + 10*伏笔 → Task 5.2
- [ ] 规格 §6.2 Audit + Summarize 同次调用 → Task 4.1-4.3
- [ ] 规格 §6.2.1 7 维 → Task 4.1 prompt
- [ ] 规格 §6.2.2 三层摘要 → Task 4.1 ChapterAuditOutputSchema
- [ ] 规格 §6.2.3 Critical 触发 repair → Task 4.4
- [ ] 规格 §6.3 状态更新工具 → Task 4.4 + state-tools(并入 Task 7.1 book-meta-tools)
- [ ] 规格 §6.4 用户改右栏广播 → Task 8.6 各 panel 编辑路径在 conversations 追加 system 消息
- [ ] 规格 §7.1 三栏布局 → Task 8.2
- [ ] 规格 §7.2 选段改写 → Task 8.5
- [ ] 规格 §7.3 意图识别 7 类(预留接入位置在 conversation 路由前置)
- [ ] 规格 §7.4 8 个斜杠命令中英 alias → Task 8.8
- [ ] 规格 §7.5 半自动 + /auto N → Task 3.4 + Task 9.1
- [ ] 规格 §7.6 撤销/历史 → Task 9.2
- [ ] 规格 §7.7 Token 用量追踪 → Task 2.5 + Task 9.3
- [ ] 规格 §8 新建书对话流程 → Task 7.1-7.3
- [ ] 规格 §9 安全与配置 → Task 0.1 .gitignore + Task 1.1 paths + Task 10.1 secrets.env 0600
- [ ] 规格 §10 MVP 清单逐项 → 各 Task 已覆盖
- [ ] UI 全中文 → 通过 i18n/zh-CN.ts 集中管理(Task 8.1)
- [ ] 所有 Task 都有失败测试 + 通过测试两步
- [ ] 所有 commit 信息中文动词开头
- [ ] 路径都用 POSIX `/`
- [ ] LLM 调用在单元测试中全 mock
- [ ] 关键链路有集成测试(写章节 / audit / 题材板块自创 / 新建书)
- [ ] 核心用户旅程有 E2E(Task 10.4)
- [ ] 每个 Task 都对应 §10 MVP 清单中的至少一条
- [ ] 错误路径测试不少于 happy path 测试

## 实现完成后的全局验收(执行 Task 10.4 之后)

人工 + 自动:

1. `pnpm test` 全绿(单测 + 集成测)
2. `pnpm test:e2e` 全绿(Playwright 核心旅程)
3. `pnpm typecheck` 无错误
4. UI 抽查:每个文案、按钮、错误、空状态、tooltip 都中文
5. `node packages/server/dist/main.js` 启动 → 浏览器访问 6789 端口 → 完整跑通"新建仙侠书 → 让 AI 写第一章 → 审 → 改一段 → 看用量"
6. 关 server,删 ~/.config/scribe/,重启 → 应能从空状态重新引导
7. 模拟 DeepSeek 503/超时,UI 应显示友好中文提示并允许重试
8. API key 从 secrets.env 读取,SQLite 和对话历史都不应包含 key 字符串
9. 制造一次 SQLite 损坏(改坏文件) → 启动应优雅降级,提供从最近快照恢复的入口

**计划结束。**

