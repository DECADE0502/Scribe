# 小说引擎设计文档

**日期**:2026-06-04
**状态**:Draft(待用户审阅)
**目标读者**:作者本人、未来的实现者(可能是另一个 Claude 会话)
**项目代号**:`scribe`(下文路径中 `<app>` = `scribe`,正式名待定可全局替换)

---

## 1. 产品定位

### 1.1 一句话

一个**对话式的本地 Web 小说创作引擎**:用户跟 AI 像跟编辑聊天一样推动剧情,AI 负责把意图变成有质感的章节,并通过自动审查和长程记忆机制保障**质量**与**连续性**。

### 1.2 核心痛点(优先级递减)

1. **质量护栏**:AI 写得"质量一般"、"AI 味重"、"角色 OOC"
2. **长程连续性**:LLM 写到第 50 章忘了前 30 章的伏笔/设定/人物状态
3. **灵感断电时的兜底**:用户写一半没思路时希望 AI 接着写下去

### 1.3 哲学定锚

**Conversation-First**。

- 默认入口都是对话框,不是菜单/按钮
- 功能通过**意图识别 + Tool 调用**触发,不是表单填写
- 资料区(右栏)默认只读用于预览,可手动改作为"逃生通道"
- 用户驾驶剧情方向(常态),AI 负责执行;断电时 AI 可短暂接管(`/auto N`)

### 1.4 不做什么(Non-Goals)

- 不做开源/公开版的"通用产品"。所有设计决策为单一作者优化
- 不做云端协作、多用户、账号系统
- 不做手机端/移动端
- 不做 epub / docx 等高级导出(第一版只 .txt / .md)
- 不做电子书发布、平台对接(番茄/起点等)
- 不做封面生成、配图(以后再说)
- 不做完全无人监督的"一句话出整本",自动模式始终有 critical issue 即停的护栏

---

## 2. 系统架构

### 2.1 总体形态

```
┌─────────────────────────── Browser (UI) ────────────────────────────┐
│                                                                     │
│  ┌───────────────┬─────────────────────┬──────────────────────────┐ │
│  │  对话流(左) │  章节编辑器(中)   │  资料区(右)             │ │
│  │               │                     │                          │ │
│  │ Conversation  │  TipTap / 富文本   │  - 角色卡                │ │
│  │ + 流式输出   │  + 选中段落触发   │  - 大纲(树)             │ │
│  │ + 斜杠命令   │    内嵌对话         │  - 伏笔                  │ │
│  │               │  + Markdown 镜像   │  - 时间线                │ │
│  │               │                     │  - rules.md              │ │
│  │               │                     │  - 题材专属板块(动态)│ │
│  └───────────────┴─────────────────────┴──────────────────────────┘ │
│                                                                     │
└──────────────────────────────────│──────────────────────────────────┘
                                   │ HTTP + SSE / WebSocket
                                   ▼
┌─────────────────────── Local Server (Node.js + TS) ─────────────────┐
│                                                                     │
│  ┌─────────────┐   ┌──────────────┐   ┌──────────────────────────┐  │
│  │  HTTP API   │──▶│ Orchestrator │──▶│  Provider Adapter Layer  │  │
│  │  + SSE/WS   │   │              │   │  (DeepSeek + 多家可扩展) │  │
│  └─────────────┘   └──────┬───────┘   └──────────────────────────┘  │
│                           │                                         │
│         ┌─────────────────┼──────────────────┐                      │
│         ▼                 ▼                  ▼                      │
│   ┌──────────┐     ┌────────────┐    ┌──────────────┐               │
│   │  Tools   │     │  Context   │    │   Audit &    │               │
│   │ Registry │     │  Builder   │    │  Summarize   │               │
│   └──────────┘     └────────────┘    └──────────────┘               │
│         │                 │                  │                      │
│         └─────────────────▼──────────────────┘                      │
│                       Storage Layer                                 │
│                  ┌─────────────────────┐                            │
│                  │  SQLite (元数据)   │                            │
│                  │  + .md (章节正文) │                            │
│                  │  + 自动快照备份  │                            │
│                  └─────────────────────┘                            │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 技术栈

| 层 | 选择 | 理由 |
|---|---|---|
| 前端 | Vite + React + TypeScript | TS 共享类型;React 生态富文本/状态库成熟 |
| 富文本 | TipTap (ProseMirror) | 行业标准,中文排版好,支持自定义节点 |
| 状态 | Zustand | 比 Redux 轻,够用 |
| 后端 | Node.js + TypeScript | 与前端类型共享 |
| HTTP | Hono | 轻量,中间件少,适合本地工具 |
| 流式 | SSE(Server-Sent Events) | LLM 流式输出标准协议,比 WebSocket 简单 |
| AI SDK | Vercel AI SDK (`ai`) | tool_use 抽象 + 多 provider 适配 + 流式 |
| DB | SQLite via better-sqlite3 | 同步 API,本地工具最简 |
| Schema | Zod | 校验工具调用参数和持久化数据结构 |
| 日志 | pino | 结构化日志,后期排查问题用 |
| 配置 | 本地文件 `~/.config/<app>/config.json` + `secrets.env` | API key 永远不进 git/对话/SQLite |

### 2.3 进程模型

**单 Node 进程**,启动后:
- 监听本地端口(默认 6789,可配)
- 浏览器访问 `http://localhost:6789` 进入 UI
- 所有 AI 调用、SQLite 读写、文件 IO 都在 server 进程内
- 没有渲染进程/preload 这种 Electron 复杂度

### 2.4 启动流程

```
node start
  ├── 加载 ~/.config/<app>/config.json + secrets.env
  ├── 打开 ~/.config/<app>/library.db(全局元数据:书架、API key 引用、模型偏好)
  ├── 初始化 Provider Adapter(根据 config 中的 provider 实例化)
  ├── 后台启动模型列表刷新任务(异步,不阻塞)
  ├── 后台启动备份调度(每 6 小时触发一次项目快照)
  ├── 启动 HTTP server,监听 6789
  └── 浏览器打开 http://localhost:6789
```

---

## 3. 数据存储

### 3.1 目录结构

```
~/.config/<app>/
├── config.json              # 全局配置(端口、备份策略、模型偏好预设)
├── secrets.env              # API key(.gitignore 永远不进版本控制)
├── library.db               # 书架级元数据:books 表 + 全局 token 累计
├── books/
│   └── <book-id>/           # 每本书一个目录
│       ├── workspace.db     # 本书的元数据(角色/大纲/伏笔/摘要/版本/usage)
│       ├── chapters/
│       │   ├── 0001.md      # 章节正文,Markdown
│       │   ├── 0002.md
│       │   └── ...
│       ├── exports/         # 用户导出 .txt/.md 的产物
│       └── (无 snapshots:快照统一放外层 backups/<book-id>/)
└── backups/
    └── <book-id>/
        ├── 20260604-1200.tar.gz
        ├── 20260604-1800.tar.gz
        └── ...               # 30 天滚动保留
```

### 3.2 SQLite Schema(每本书 `workspace.db`)

```sql
-- 本书基础信息
CREATE TABLE book_meta (
  key   TEXT PRIMARY KEY,    -- title, premise, tone, genre, created_at, ...
  value TEXT NOT NULL
);

-- 通用骨架:角色卡
CREATE TABLE characters (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  role        TEXT,            -- protagonist / antagonist / supporting
  base_data   JSON,            -- 通用字段:背景/动机/语言习惯/外貌
  current_state JSON,          -- 动态:位置/伤情/情绪/活跃伏笔等
  appearances JSON,            -- [{chapter_no, brief}]
  updated_at  INTEGER
);

-- 通用骨架:大纲(可嵌套树)
CREATE TABLE outline_nodes (
  id          TEXT PRIMARY KEY,
  parent_id   TEXT,
  level       TEXT,            -- volume / arc / chapter
  title       TEXT,
  summary     TEXT,
  status      TEXT,            -- planned / in_progress / done
  sort_order  INTEGER,
  metadata    JSON
);

-- 通用骨架:伏笔
CREATE TABLE foreshadowing (
  id              TEXT PRIMARY KEY,
  label           TEXT NOT NULL,    -- 简短标签,用于召回
  description     TEXT,
  planted_chapter INTEGER,
  paid_chapter    INTEGER,          -- NULL = 未回收
  status          TEXT,             -- active / paid / dropped
  related_characters JSON
);

-- 通用骨架:时间线
CREATE TABLE timeline_events (
  id          TEXT PRIMARY KEY,
  chapter_no  INTEGER,
  story_time  TEXT,            -- 故事内时间("第二日清晨")
  event       TEXT,
  participants JSON
);

-- 通用骨架:rules.md(只一份,以文件形式 + 镜像)
-- rules.md 直接放 books/<book-id>/rules.md,SQLite 不冗余存储

-- 题材专属板块(AI Tool Use 自创)
CREATE TABLE genre_sections (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,        -- "功法体系" / "财务" / "情感线"
  schema      JSON,                 -- 字段定义:[{name, type, description, required}]
  created_by  TEXT,                 -- "ai" / "user"
  created_at  INTEGER
);

CREATE TABLE genre_section_items (
  id          TEXT PRIMARY KEY,
  section_id  TEXT NOT NULL,
  data        JSON NOT NULL,        -- 按 section.schema 定义的字段填充
  updated_at  INTEGER,
  FOREIGN KEY (section_id) REFERENCES genre_sections(id)
);

-- 章节摘要(三层)
CREATE TABLE chapter_summaries (
  chapter_no       INTEGER PRIMARY KEY,
  one_liner        TEXT,            -- 一句话(章节列表显示)
  paragraph        TEXT,            -- 一段式(召回上下文用)
  key_events       JSON,            -- [{event, characters, foreshadowing_refs}]
  generated_at     INTEGER,
  reasoning_content TEXT            -- DeepSeek V4 的 reasoning,可空
);

-- 章节版本(撤销/历史)
CREATE TABLE chapter_versions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_no  INTEGER NOT NULL,
  version_no  INTEGER NOT NULL,
  source      TEXT,                 -- ai_write / ai_rewrite / user_edit / segment_revise
  content_md  TEXT,                 -- 当时的全文快照
  created_at  INTEGER
);

-- 章节审查报告
CREATE TABLE chapter_audits (
  chapter_no   INTEGER PRIMARY KEY,
  verdict      TEXT,            -- ok / warning / critical
  issues       JSON,            -- [{dimension, severity, excerpt, note}]
  audit_model  TEXT,
  audited_at   INTEGER
);

-- 对话流(项目级)
CREATE TABLE conversations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  role        TEXT,            -- user / assistant / system / tool
  content     TEXT,
  metadata    JSON,            -- {tool_call?, tool_result?, attached_chapter?, ...}
  created_at  INTEGER
);

-- Token 用量
CREATE TABLE token_usage (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  task_type       TEXT,        -- write / audit / chat / intent / segment_revise
  model           TEXT,
  prompt_tokens   INTEGER,
  completion_tokens INTEGER,
  cached_tokens   INTEGER,
  reasoning_tokens INTEGER,
  cost_usd        REAL,
  chapter_no      INTEGER,
  created_at      INTEGER
);
```

### 3.3 章节正文存储

- 每章一个 .md 文件:`books/<book-id>/chapters/0001.md`,4 位补零
- 文件头部 frontmatter 存基础元信息(标题、字数、生成时间、当前 version_no)
- **当前章 = 最新 version**,历史版本仅在 SQLite 的 `chapter_versions.content_md` 中
- 用户在浏览器编辑 → 保存时同时更新 .md 和 SQLite version
- git 友好:用户可以把 `books/<book-id>/` 整个加入 git,自然得到 diff 历史

### 3.4 项目快照(自动备份)

- 触发条件:每 6 小时一次 + 每完成 5 章一次(取较短)
- 内容:整个 `books/<book-id>/` 目录(.md + workspace.db) → tar.gz
- 路径:`backups/<book-id>/<YYYYMMDD-HHMM>.tar.gz`
- 滚动策略:保留近 30 天 + 每周保留一份(共最多 ~64 份)
- 用户感知:零(后台静默)
- 恢复:UI 提供"恢复到快照"页面,选时间点 → 解压覆盖

---

## 4. 资料板块系统

### 4.1 通用骨架(5 个固定)

每本书都有,无论题材。**SQLite 表预先建好**:
1. **角色** (`characters`)
2. **大纲** (`outline_nodes`)
3. **伏笔** (`foreshadowing`)
4. **时间线** (`timeline_events`)
5. **rules.md**(文件,有专门 UI 编辑)

### 4.2 题材专属板块(AI 自创)

存在 `genre_sections` + `genre_section_items` 两张表中。**完全无预置**。

#### 4.2.1 自创流程

```
[新建书的对话过程中]
用户: 我想写个仙侠的,主角是被废功法的弃婴重修崛起。
AI 内部: 检测到"修仙",需要追踪 功法/境界/法器丹药 等。
AI Tool Call: create_genre_section({
  name: "功法体系",
  schema: [
    {name: "name", type: "string", required: true, description: "功法名"},
    {name: "tier", type: "string", description: "阶级,如下品/中品/上品"},
    {name: "attribute", type: "string", description: "属性,如雷/火/木"},
    {name: "owner", type: "ref:character", description: "修炼者"},
    {name: "notes", type: "text"}
  ]
})
AI 对用户: 我建议建几个修仙板块:功法、境界、法器丹药、宗门势力。
   要加灵宠或者地图也行。
用户: 加灵宠,不要宗门。
AI Tool Call: delete_genre_section("宗门势力")
              create_genre_section({name: "灵宠", schema: [...]})
```

#### 4.2.2 字段类型

| type | 说明 | 示例 |
|---|---|---|
| `string` | 短字符串 | "上品" |
| `text` | 长文本 | 详细描述 |
| `number` | 数字 | 3500 |
| `enum` | 枚举,需提供 `values: []` | "active"/"paid" |
| `ref:character` | 关联到 characters 表的 id | 主角 |
| `ref:section:<name>` | 关联到其它专属板块 | 功法 ref 到 灵根 |
| `list:<inner_type>` | 列表 | list:string |

类型有限有意,避免 AI 自创太复杂的 schema 后期不好维护。

#### 4.2.3 用户手动改板块

- 右栏每个板块右上角有铅笔图标 → 进入 schema 编辑模式
- 用户可加字段、改字段类型、删字段(有数据时警告)
- 可整个删板块(警告,需打字"DELETE" 确认)
- 改板块也可以通过对话 → AI 调 `update_genre_section_schema` 工具

### 4.3 板块作为 AI 上下文的可见信息

写章节时,Context Builder 决定哪些板块进 prompt(详见 §6)。
默认全部塞,超 budget 时按"最近被引用 + 与本章大纲相关"裁剪。

---

## 5. AI 调用层

### 5.1 Provider Adapter 接口

```typescript
// src/ai/providers/_interface.ts

export interface ModelInfo {
  id: string;
  ownedBy?: string;
  contextWindow?: number;       // 三档兜底
  supportsTools?: boolean;
  supportsReasoning?: boolean;
  pricing?: { input: number; output: number; cachedInput?: number };
}

export interface ProviderAdapter {
  id: string;                                          // "deepseek" / "anthropic" / ...
  
  listModels(): Promise<ModelInfo[]>;                  // 实时拉
  enrichModel(modelId: string): Promise<ModelInfo>;    // 三档兜底:provider → openrouter → 本地表
  
  testToolUse(modelId: string): Promise<boolean>;      // 用一次小调用探测
  
  // 返回 Vercel AI SDK 的 LanguageModel 实例
  createModel(modelId: string, opts?: ModelOpts): LanguageModel;
  
  classifyError(err: Error): "rate_limit" | "timeout" | "stream_idle" | "auth" | "context_overflow" | "unknown";
}
```

### 5.2 第一版 adapter 文件

```
src/ai/providers/
├── _interface.ts             # 通用接口
├── deepseek.ts               # 第一版唯一实现(继承 openai-compatible)
├── openai-compatible.ts      # OpenAI API 协议家族(DS/通义/Kimi/SiliconFlow/Ollama 都用)
├── anthropic.ts              # 占位
├── openai.ts                 # 占位(官方端点,有原生 features 如 structured output)
├── enrich-from-openrouter.ts # 元数据兜底(查 OpenRouter)
└── local-model-table.ts      # 兜底常量表
```

### 5.3 模型列表实时拉取

- 时机:
  - 系统启动后异步刷新(不阻塞 UI)
  - 用户进入"设置 → 模型"页时刷新
  - 用户切换 provider 时刷新
  - 用户点"刷新"按钮时刷新
- 缓存:24 小时,strong cache(节流避免每次切下拉都打远端)
- 失败:UI 标红,允许手动输入模型 ID
- 元数据:provider 不返回 → 查 OpenRouter → 兜底表

### 5.4 第一版默认模型分配

| 任务 | 模型 | 备注 |
|---|---|---|
| 写作(整章/重写/段落改写) | `deepseek-v4-pro` | reasoning 模型,质量优先 |
| 审查 + 摘要(同次调用) | `deepseek-v4-flash` | 快、便宜 |
| 对话/规划(含 Tool Use) | `deepseek-v4-pro` | tool_use 稳定性优先 |
| 意图识别 | `deepseek-v4-flash` | 简单分类 |

用户可在 UI 改成任意已支持模型。

### 5.5 reasoning_content 处理

DeepSeek V4 模型默认返回 `reasoning_content`。

- **写作正文**:丢弃 `reasoning_content`,只取 `content` 入正文
- **审查/摘要**:`reasoning_content` 存到 `chapter_summaries.reasoning_content`,UI 提供"看 AI 思考过程"按钮
- **意图识别**:不展示,只用 `content`(JSON 解析)

### 5.6 prompt cache

DeepSeek V4 自动 cache。我们的策略:

- **System prompt + 通用骨架数据**(角色、活跃伏笔、rules)放在 messages 最前面
- **本章特定数据**(本章大纲、用户最新指令)放最后
- 这样静态部分自动命中 cache,只有动态部分付全价

### 5.7 错误处理与重试

| 错误类型 | 重试策略 |
|---|---|
| `rate_limit` | 指数退避,最多 3 次,告知用户 |
| `timeout` | 立刻重试 1 次;再失败上报 |
| `stream_idle` | 超过 30 秒无新 token → 中断 + 重试 1 次 |
| `auth` | 不重试,UI 弹"API key 失效",引导用户改 key |
| `context_overflow` | 不重试,触发"上下文降级":删除最旧滑窗章节 + 增大召回阈值 → 再试 1 次 |
| `unknown` | 不重试,记录日志,UI 弹错 |

### 5.8 流式输出

- AI 响应通过 SSE 流式推送给前端
- 事件类型:`text_delta` / `tool_call_start` / `tool_call_end` / `done` / `error`
- 前端按事件类型分别渲染(文本即时显示,工具调用显示进度条)
- 用户可以"中止"流(发 `cancel` HTTP 请求,server 调用 AbortController)

---

## 6. 长程一致性 / 防漂移

### 6.1 写作时的 Context Builder

写一章时,prompt 由 Context Builder 组装,优先级递减:

1. **System Prompt**(全局风格、角色定位、产品哲学)
2. **本书 premise + tone + genre**
3. **rules.md**(用户定义的硬约束)
4. **完整角色卡**(主要角色 + 本章涉及的配角)
5. **活跃伏笔列表**(`status='active'`)
6. **题材专属板块**(全量,超 budget 时裁)
7. **滑窗 3 章的一段式摘要**(最近 3 章)
8. **召回 5 章的一段式摘要**(按"角色出场 + 伏笔标签"评分)
9. **本章大纲**(用户提供 / AI 推断)
10. **用户最新指令**(本轮对话)

#### 6.1.1 召回算法

```
对于 (chapter_no - 3) 之前的所有章节:
  score = 0
  if 本章涉及角色 ∩ 该章 key_events.characters:
    score += 5 * 重叠度
  if 本章相关伏笔 ∩ 该章 key_events.foreshadowing_refs:
    score += 10 * 重叠度
  按 score desc 取 TOP 5
```

注:"本章涉及角色"由用户大纲推断或显式给出;"本章相关伏笔"由 AI 在写作前调用 `query_active_foreshadowing` 工具获取。

### 6.2 章末 Audit + Summarize(同次调用)

写作完成后立即触发,使用 audit 模型(`deepseek-v4-flash`):

#### 6.2.1 Audit 维度(7 维)

参考 ainovel-cli 的 7 维设计:

1. **设定一致性**:与 rules / 题材板块是否冲突
2. **角色行为**:OOC 检测(基于角色卡的"动机/语言习惯")
3. **节奏**:推进/停滞,情绪曲线
4. **叙事连贯**:与上一章的衔接,与本章大纲的吻合度
5. **伏笔管理**:是否有新埋伏笔(需登记)、是否回收了某伏笔(需更新状态)
6. **钩子强度**:章末 hook 是否吸引读下章
7. **审美品质**:细节、对话、用词、情感力(从 ainovel-cli 抄来)

每维度输出 `{score: 0-10, severity: ok/warning/critical, excerpts: [...], note: "..."}`。

#### 6.2.2 Summarize 输出

同次调用同时产出:
- **one_liner**(15-30 字,章节列表显示)
- **paragraph**(200-500 字,召回上下文用)
- **key_events**(数组:`[{event, characters: [], foreshadowing_refs: []}]`)
- **state_updates**(Tool Calls,见 §6.3)

#### 6.2.3 Critical 处理

- `critical` issue 出现 → 暂停自动模式
- UI 在对话流弹出 audit 摘要,问"修复 / 接受 / 重写"
- 用户选"修复"→ AI 用同一章再调用 `repair_chapter` 工具(类似 CharacterArc 的 chapter-repair)

### 6.3 Tool Use:实时更新右栏状态

Audit 调用同时,AI 通过 Tool Use 更新右栏:

```
update_character_state({character_id, current_state: {...}})
add_appearance({character_id, chapter_no, brief})
add_foreshadowing({label, description, planted_chapter})
update_foreshadowing({id, status: "paid", paid_chapter})
add_timeline_event({chapter_no, story_time, event, participants})
```

右栏由此始终保持最新。用户在右栏看到的是"AI 写完最近一章后的状态"。

### 6.4 用户手动改右栏的广播

用户在右栏激活态修改某字段 → 系统:

1. 立即写入 SQLite
2. 在 conversations 表插入一条 `system` 角色的消息:`"用户刚把 林尘.年龄 从 18 改为 22"`
3. 下次 AI 调用时这条消息会出现在上下文里 → AI 不会再用过期信息说话

---

## 7. 写作交互

### 7.1 三栏布局

```
┌────────────────┬──────────────────────────┬──────────────────────┐
│ 对话流         │ 章节编辑器               │ 资料区               │
│ (~30%)         │ (~45%)                   │ (~25%)               │
│                │                          │                      │
│ ┌────────────┐ │ Chapter 23: ...          │ ▼ 角色 (12)          │
│ │ AI: 这章   │ │                          │  ├─ 林尘             │
│ │ 想怎么写? │ │ [富文本正文]             │  ├─ 师妹             │
│ └────────────┘ │                          │  └─ ...              │
│                │                          │                      │
│ ┌────────────┐ │                          │ ▼ 大纲(树)         │
│ │ User: 进酒│ │                          │  └─ 卷 1             │
│ │ 馆见师妹  │ │                          │     └─ 弧 1.1        │
│ └────────────┘ │                          │                      │
│                │                          │ ▼ 活跃伏笔 (5)       │
│ [输入框]       │                          │ ▼ 时间线             │
│ /开始下一章   │                          │ ▼ 功法体系  [AI建]   │
│                │                          │ ▼ 法器丹药  [AI建]   │
└────────────────┴──────────────────────────┴──────────────────────┘
```

### 7.2 编辑器的"选中段落 → 内嵌对话"

- 用户选中某段文本
- 出现浮动操作条:"改写 / 简化 / 增强情绪 / 自定义指令"
- 点"自定义指令" → 弹出输入框,用户输入"重写,要更克制"
- 提交 → 对话流出现一条带"📍 段落引用"的消息 → AI 流式返回新段落 → 用户接受/拒绝

### 7.3 意图识别

每条用户消息进入 server 后,先经过 **Intent Classifier**(`deepseek-v4-flash`):

```
分类:
  - chitchat       (闲聊,无需动作)
  - writing_intent (要写/续写)
  - revise_intent  (要改某段/某章)
  - query          (问"林尘是谁来着")
  - genre_section_op (要加/改/删板块)
  - command_explicit (检测到斜杠命令)
  - other
```

分类结果决定下一步是"AI 直接对话回复"还是"启动 Tool 调度链"。

### 7.4 斜杠命令(中英 alias 双轨)

| 命令 | 中文别名 | 作用 |
|---|---|---|
| `/write` | `/续写` `/写下一章` | 开始下一章流程 |
| `/auto N` | `/自动N` | 自动写 N 章 |
| `/rewrite` | `/重写` | 重写当前章 |
| `/revise <说明>` | `/改写 <说明>` | 改写选中段(需在编辑器选中) |
| `/audit` | `/审查` | 立即对当前章做审查 |
| `/recall <关键词>` | `/查找 <关键词>` | 全书检索 |
| `/note <内容>` | `/便签 <内容>` | 给 AI 留便签(只进对话) |
| `/help` | `/帮助` | 列出所有命令 |

### 7.5 续写策略

#### 7.5.1 默认半自动(核心)

```
用户点"开始下一章" 或 输入 /write
  ↓
AI(对话模型): "第 N 章,你希望发生什么?"
  ↓
用户:"林尘进酒馆遇师妹" (或 "你看着办")
  ↓
AI 调 plan_chapter 工具 → 生成本章大纲(写入 outline_nodes)
  ↓
AI 流式写章节(写作模型)
  ↓
写完 → 后台自动 audit + summarize + 状态更新
  ↓
对话流给出 audit 摘要,等用户审稿
```

#### 7.5.2 应急自动(`/auto N`)

```
用户:/auto 5
  ↓
预算检查:估算 5 章 token 总量 vs 单次最高消费(用户配置)
  ↓
循环 N 次:
  ├── AI 对话模型:"第 X 章,以下是历史摘要,我打算写..."(自动推断方向)
  ├── 写作 → audit → summarize → 状态更新
  ├── if audit.verdict == 'critical': 暂停 + 通知用户
  └── if 用户在对话框打字: 完成当前章后停止
  ↓
全部完成,显示总览
```

### 7.6 撤销 / 历史

- 每次 AI 修改章节 → 新建一个 `chapter_versions` 行
- UI 在编辑器有"历史"按钮 → 列出本章所有版本(时间、来源、字数变化、diff 预览)
- 点任意版本 → 回滚为当前(同时也是新建一个 version,不是真删)

### 7.7 Token 用量追踪

- 每次 AI 调用记一条 `token_usage`
- 首页书架:每本书显示 `本书已花 $X.XX`
- 书工作台顶部显示 `本会话已花 $X.XX`
- 设置 → 用量明细:按章节/任务类型/模型聚合,可看哪章最贵、哪类任务占比最高

---

## 8. 新建书:对话式流程

### 8.1 流程

```
书架页面 → 点"新建" → 进入新建对话(无章节,无资料)
  ↓
AI: "想写什么样的故事?随便说,可以是一句话也可以是一大段。"
  ↓
用户: 自由表达(可短可长)
  ↓
AI 内部:意图分析 + 题材识别 + 缺信息识别
  ↓
AI 主动问下一个最重要的缺失项(一次只问一个):
  - 题材未明 → 问题材
  - 主角模糊 → 问主角是怎样的人
  - 矛盾不清 → 问核心冲突
  - 长度未定 → 问篇幅大概(短篇/长篇/连载)
  - 调性未给 → 问期望调性(轻松/压抑/热血)
  ↓
[识别到题材后]
AI Tool Call: create_genre_section(...) × N
AI 对用户:"我先给你建了几个修仙常用的板块:功法、境界、法器、灵宠。
          可以加,也可以删。"
  ↓
[基础信息够了之后]
AI Tool Call: 
  set_book_meta({title?, premise, tone, genre, length_target})
  create_character({name, role: protagonist, ...}) × N
  create_outline_node({level: volume, title, summary}) × M
  
AI 对用户:"基础设定好了。要不要现在开始写第一章?"
  ↓
用户: 好 → 进入正常写作流程(/write)
```

### 8.2 信息何时算"够"

AI 自行判断,内部规则:
- 题材已知
- 至少 1 个主角(有名字、基础人设)
- 至少 1 个一级大纲(卷或主线)
- 调性 / 篇幅 / premise 三选二

不够就接着问。够了就主动结束新建对话,问"开始写吗"。

### 8.3 跳过新建对话

提供"跳过"按钮,直接进入空工作台。所有数据用户后续手动建或在写作过程中通过对话补全。

---

## 9. 安全与配置

### 9.1 API Key 存放

- 文件:`~/.config/<app>/secrets.env`
- 格式:`DEEPSEEK_API_KEY=sk-...`
- 永远**不写入** SQLite、git、对话历史
- UI 上的"配置 API key"页面是唯一录入入口
- 录入时,前端发到 server,server 写入 secrets.env(0600 权限),前端只显示 `sk-...****`

### 9.2 .gitignore

`~/.config/<app>/` 不进 git。
但用户的 books/<book-id>/ 目录(章节正文 + workspace.db)用户可以选择**单独**用 git 管理。

### 9.3 网络

只对外发请求到:
- 用户配置的 LLM provider 端点(默认 `api.deepseek.com`)
- OpenRouter(用于元数据查询,可关闭)
- 不发任何 telemetry / 用户行为数据

### 9.4 端口

默认 `127.0.0.1:6789`,只绑 loopback,不暴露公网。

---

## 10. 第一版功能清单(MVP)

### 必须有(MVP)

- [ ] 本地 server 启动 + 浏览器进入
- [ ] 书架页(列书 + 新建 + 删除)
- [ ] 工作台三栏布局
- [ ] 对话流 + SSE 流式
- [ ] 意图识别(7 类:chitchat / writing_intent / revise_intent / query / genre_section_op / command_explicit / other)
- [ ] 斜杠命令 8 个
- [ ] DeepSeek provider adapter
- [ ] 模型列表实时拉取
- [ ] Context Builder(完整规则)
- [ ] 写作 → Audit → Summarize 完整流程
- [ ] 状态更新 Tool Use(角色/伏笔/时间线)
- [ ] 章节版本 + 撤销
- [ ] 选中段落 + 改写
- [ ] 通用骨架 5 个板块的 UI
- [ ] 题材专属板块的 UI(查看 + 手动改 + AI 自创)
- [ ] 新建书对话流程
- [ ] 项目快照后台备份
- [ ] Token 用量追踪 + 显示
- [ ] 章节导出 .txt / .md

### 不在 MVP(以后再说)

- 多 provider 支持(只留接口,实现一个)
- epub / docx 导出
- 关系图可视化(列表足够)
- 全书检索(`/recall`)的高级模式(向量检索)
- 移动端 / 多设备同步
- 多用户 / 协作
- 题材包"模板库"(导出/导入)

---

## 11. 风险与缓解

| 风险 | 缓解 |
|---|---|
| DeepSeek tool_use 在长 context 下不稳定 | 第一版:错误分类 + 自动重试(rate_limit/timeout/stream_idle 各自策略,详见 §5.7);超过重试上限直接上报用户。**JSON 输出降级不在 MVP**(若 DS V4 实测稳定性足够则不实现;真出问题再加,作为 Provider Adapter 的可选能力暴露给非 tool_use 模型) |
| AI 自创板块的 schema 太天马行空,后期不好维护 | 字段类型有限集合(7 种);用户可手改 schema |
| 长篇写到 200 章后 SQLite/上下文召回慢 | 召回算法 O(N),N=章节数;200 章下毫秒级;以后加索引或向量检索 |
| 项目快照占磁盘 | tar.gz 压缩;30 天滚动 + 每周保留;每书可配置保留策略 |
| API key 泄漏 | secrets.env 0600 + 永不出本机 + UI 显示打码 |
| 自动模式失控 | critical issue 即停 + 单次预算上限 + 用户随时打断 |
| reasoning model 输出慢 | 流式显示;UI 显示"思考中..."占位 |
| context_overflow 实时降级会失忆 | 降级日志告知用户;长篇早期就提醒"上下文紧张,建议手动归档老资料" |

---

## 12. 实现顺序建议

(给后续 implementation plan 用,不在本设计文档约束范围)

1. **基础骨架**:server + DB schema + 文件目录 + 启动
2. **DeepSeek adapter + 模型列表拉取**(独立可测)
3. **简单写作链路**:对话 → 写一章 → 存盘(无 audit/无召回)
4. **Audit + Summarize**(让"防写歪"和"长程"开始可用)
5. **Context Builder + 召回**(防漂移)
6. **Tool Use 状态更新**(右栏自动维护)
7. **题材板块 AI 自创**
8. **新建书对话流程**
9. **斜杠命令、撤销、段落改写**
10. **快照、Token 用量、导出**
11. **打磨 UI、错误处理、文档**

---

## 13. 开放问题(实现时再决定)

- 富文本和 Markdown 之间的同步策略(TipTap 双向?)
- 召回时同章节多次出现的 character 如何排重
- `/auto N` 时如何向用户展示"自动模式 vs 普通模式"的视觉区分
- 用户改右栏后的"广播消息"在对话流是否可见(默认折叠?)
- 多 provider 时,各 provider 的"任务模型偏好"是分别记还是共享一份

这些不阻塞设计审批,实现时遇到再定。

---

## 附录 A:与参考项目的对照

| 设计点 | 参考来源 | 我们的取舍 |
|---|---|---|
| Phase / Flow 状态机 | ainovel-cli `domain/transitions.go` | 简化:只在"自动模式"中用,不全局展示 |
| 三档自适应上下文 | ainovel-cli `agents/build.go:205-220` | 简化:滑窗 + 召回 + context_overflow 降级 |
| 弧末触发器 | ainovel-cli `flow/router.go:104-138` | 不做"自动展开",改为用户驾驶 + AI 提议 |
| Tool Use 创建板块 | CharacterArc Skill 系统 + Vercel AI SDK | 我们的题材板块比 Skill 简单,只管数据结构 |
| chapter-audit + chapter-repair | CharacterArc `chapter-assistant.ts` | 直接抄 |
| humanizer-zh 字典 | community-skills | 作为初始 rules.md 模板提供给用户 |
| Provider 适配 | CharacterArc `provider.ts` | 直接抄,加 ainovel-cli 的错误分类 |
| OpenRouter 元数据 | ainovel-cli `internal/models/pricing.go` | 用,但只作为兜底来源之一 |
| 三栏布局 | CharacterArc `chapterWorkspace/` | 抄,把 AI 侧栏换成对话流 |

---

**文档结束。**
