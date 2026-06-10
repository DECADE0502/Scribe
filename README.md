# Scribe 小说引擎

对话式的本地 Web 小说创作引擎:跟 AI 像跟编辑聊天一样推动剧情,AI 负责把意图变成有质感的章节,并通过自动审查和长程记忆机制保障质量与连续性。

## 环境要求

- Node.js ≥ 20(实测 24)
- pnpm 9

## 安装

```bash
pnpm install
```

## 配置 API Key

在数据目录创建 `secrets.env`(默认 `%APPDATA%\scribe\secrets.env`,可用环境变量 `SCRIBE_HOME` 改根目录):

```
DEEPSEEK_API_KEY=sk-xxxx
```

## 启动

```bash
# 后端(默认 http://127.0.0.1:6789)
pnpm --filter @scribe/server exec tsx src/main.ts

# 前端开发服(另开终端,默认 http://localhost:5173,自动代理 /api 到 6789)
pnpm --filter @scribe/client dev
```

浏览器打开 http://localhost:5173 即可使用。

## 测试

```bash
pnpm test          # 全部单元 + 集成测试(shared / server / client)
pnpm test:e2e      # Playwright 端到端(自动起真实 server)
pnpm typecheck     # 全包类型检查
```

## 目录结构

```
packages/
  shared/    前后端共享类型(Zod schema、SSE 事件、斜杠命令表)
  server/    Node 后端(Hono + SQLite + DeepSeek adapter + 编排器)
  client/    Vite + React 前端(三栏工作台:对话 / TipTap 编辑器 / 资料)
e2e/         Playwright 端到端测试
docs/        设计规格、实施计划、实现期 backlog
```

## 数据存放

- 默认根目录:`%APPDATA%\scribe\`(Windows)/ `~/.config/scribe`(Linux)
- 每本书:`books/<id>/`(workspace.db + chapters/*.md + rules.md)
- 自动快照:`backups/<id>/*.tar.gz`(30 天滚动 + 每周保留)

## 常用斜杠命令

| 命令 | 说明 |
|---|---|
| `/write` `/续写` | 开始下一章 |
| `/auto 5` | 自动写 5 章(critical 问题即停,预算上限保护) |
| `/audit` `/审查` | 对当前章立即审查 |
| `/recall 林尘` | 全书检索 |
| `/help` | 列出所有命令 |
