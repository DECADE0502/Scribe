# Scribe

本地优先的 AI 长篇小说创作工作台。Scribe 的目标不是单章生成器,而是把设定、世界书、预设、对话意图、章节正文、审查结果和长期记忆组织成一个可持续推进的写作项目。

## 环境要求

- Node.js ≥ 20(实测 24)
- pnpm 9

## 安装

```bash
pnpm install
```

## 配置 API Key

在数据目录创建 `secrets.env`(默认 `<项目目录>/.scribe-data/secrets.env`,可用环境变量 `SCRIBE_HOME` 改根目录):

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
  shared/       前后端共享类型、Zod schema、SSE 事件、斜杠命令表
  server/       Node 后端、SQLite、本地文件、AI 编排、质量门禁
  client/       Vite + React 前端、三栏写作工作台
e2e/            Playwright 端到端测试和截图证据
docs/           规格、计划、路线图、交接文档
samples/        可复现导入样例,目前存放 SillyTavern 预设和世界书
reports/        历史验证报告和 live-run 证据
```

## 数据存放

- 默认根目录:**项目目录下的 `.scribe-data/`**(已在 `.gitignore`),删掉项目目录即可彻底清除,不在系统配置目录残留;可用环境变量 `SCRIBE_HOME` 改到任意位置
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
