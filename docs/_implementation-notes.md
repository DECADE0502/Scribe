# 实现期 backlog(给后续 Task 派单时附带)

> 这里收集每个 Task 完成后,reviewer 提出的"对后续 Task 有影响"的事项。
> 派每个 implementer 时,我会从这里挑出**与该 Task 相关的条目**贴进 prompt。
> 历史归档,不删。

---

## 累计来源:Task 0.1 review

### B-0.1-001(Task 1.x:better-sqlite3 版本)
- 装 `better-sqlite3` 时显式 pin **≥ v11.7**(推荐 v12.x)
- 原因:Node 24 需要 v11.7+ 才有预编译二进制,旧版要 MSVC 现编
- 出现位置:Task 1.2 SQLite 连接

### B-0.1-002(Task 0.5 / 任何用 vitest coverage 的 Task)
- 引入 vitest coverage 或 `tsc --build` 增量编译时,补 `.gitignore`:
  ```
  coverage/
  *.tsbuildinfo
  ```

### B-0.1-003(Task 0.5:e2e package name)
- `e2e/package.json` 的 `"name"` **必须是** `scribe-e2e`
- 原因:root `package.json` 的 `test:e2e` script 是 `pnpm --filter scribe-e2e run test`,按包名过滤
- 名字写错 script 会静默不跑

### B-0.1-004(Task 0.4:client tsconfig)
- client (Vite + React) 的 `tsconfig.json` 必须扩展 `lib`,显式加 DOM:
  ```json
  { "lib": ["ES2022", "DOM", "DOM.Iterable"] }
  ```
- 原因:`tsconfig.base.json` 只给了 `["ES2022"]`,没 DOM 会编译报 `document is not defined`

### B-0.1-005(任何 Task:Windows + native module 排错)
- 若 better-sqlite3 / electron 这种 native module 安装报"路径解析"怪错,把 `.npmrc` 里加:
  ```
  node-linker=hoisted
  ```
- 默认 isolated symlink 在 Windows 偶发问题

### B-0.1-006(可选,任何时候)
- 当前 `packageManager: pnpm@9.0.0`,corepack 会精确拉 9.0.0,该版本有 peer deps 解析旧 bug
- 建议任何后续 Task 中升到 `pnpm@9.15.9`(本地匹配)
- 不是阻塞,顺手做

---

## 累计来源:Task 0.2 review

### B-0.2-001(Task 0.3 / 0.4 / 0.5:lockfile 一并 commit)
- 引入新 deps 时,**包目录 + `pnpm-lock.yaml` 一起 commit**,plan 里 `git add packages/X` 是简写,实际要 `git add packages/X pnpm-lock.yaml`
- 否则会留脏 lock 违反"working tree clean"

### B-0.2-002(可选,任何时候):.gitattributes
- Windows + LF→CRLF 警告,跨平台可能噪声
- 建议加 `.gitattributes`:`* text=auto eol=lf`
- 不阻塞,顺手做

---

## 累计来源:Task 0.3 review

### B-0.3-001(Task 任何调 server build 时)
- plan 中 server `tsconfig.json` 写的 `rootDir: "src"` + `include: ["tests/**/*"]` 是**自冲突**(已删 rootDir 修好)
- 后续若需要严格 build(不把 tests 编进 dist),拆两 tsconfig:
  - `tsconfig.json`(typecheck/vitest 用):include src+tests,无 rootDir
  - `tsconfig.build.json`(build 用):只 include src,rootDir=src
- 当前 B-MVP 不需要 build,Task 0.3 只删 rootDir 即可,后续若上 CI/产物分发再拆

### B-0.3-002(信息):better-sqlite3 12 + Node 24 + Windows
- prebuild-install 直接走预编译二进制成功,**无 build from source**
- 即 B-0.1-005(node-linker=hoisted)暂时不用启用,先观察后续 Task

---

## 累计来源:Task 0.4 review

### B-0.4-001(信息):jest-dom/vitest 子路径
- `@testing-library/jest-dom@6.5+` 的 `/vitest` 子路径正常工作
- 若 lockfile 刷新到 6.4.x 切回主入口 `@testing-library/jest-dom`

### B-0.4-002(Task 当真要 build 时):tsconfig 与 vite build 协同
- 当前 `build: tsc -b && vite build`,但 client `tsconfig.json` 未设 `outDir`/无 references
- 若启用 `tsc -b`(增量编译)需要拆 references 或显式 `outDir`
- 当前 typecheck 用 `tsc --noEmit` 不依赖此

### B-0.4-003(Task 8.1):i18n 全量补全
- 当前只有 `app / library / common` 三个 namespace
- Task 8.1 必须全量补齐:对话流文案、编辑器文案、所有面板、错误提示、空状态、tooltip 等

---

## 累计来源:Task 1.1 review

### B-1.1-001(后续测试 spy `node:os` 等内置模块时)
- Node 24 + Vitest 2.1.9 下,`vi.spyOn(os, "platform")` 直接抛 `Cannot redefine property: platform`
- 必须先 `vi.mock("node:os", ...)` 把模块复制成可变命名空间
- Task 1.1 已加这段 mock,后续 Task 写类似测试时直接复用其样板
- 影响:任何 spy 内置模块(`os`/`fs`/`path`/`crypto`)的测试

---

## 累计来源:Task 1.2 review

### B-1.2-001(Task 1.4 必读):workspace/001_init.sql 已删
- Task 1.2 把原占位文件删了换成 `.gitkeep`
- Task 1.4 plan 写的"修改 workspace/001_init.sql"要改成"**新建** `001_init.sql`"
- 不要叫 002_init.sql 之类(避免 _migrations 表里出现奇怪空洞)

### B-1.2-002(Task 1.3 顺便补):openLibraryDb 集成测试
- quality reviewer 标了 important 但跳过了
- 用 tmp 文件 DB 调 `openLibraryDb(tempDbPath)`,断言:
  1. `SELECT name FROM sqlite_master WHERE name='books'` 非空(验证迁移真跑了)
  2. `PRAGMA journal_mode` 返回 `wal`
  3. `PRAGMA foreign_keys` 返回 `1`
- 覆盖 fileURLToPath 真实路径解析 + PRAGMA 实际生效
- Task 1.3 顺手补到 `tests/unit/db/library.test.ts`

### B-1.2-003(信息):build 配置已就位
- 新增 `scripts/copy-migrations.mjs`(Node 跨平台复制 *.sql 到 dist)
- 新增 `tsconfig.build.json`(rootDir=src,排除 tests/scripts)
- `package.json` build 现在是 `tsc -p tsconfig.build.json && node scripts/copy-migrations.mjs`
- 后续若加新的 SQL 资源(prompts/.txt 等),要更新 copy-migrations.mjs 通配

### B-1.2-004(可选,任何 Task):runner 边界覆盖
- 当前 runner.test.ts 缺三组边界:空数组、同批重复 name、checksum 静默篡改告警
- 都标 minor,不阻塞。先观察,真踩坑再补

### B-1.2-005(可选,Task 9.3 之前):cost_usd CHECK 约束
- `books.total_cost_usd REAL NOT NULL DEFAULT 0` 没加 `CHECK (total_cost_usd >= 0)`
- 加上零代价,后续负数 bug 能在 DB 层挡
- 留待 9.3 用量明细 Task 顺便加

### B-1.2-006(架构,任何后续 Task):db/open.ts 抽象
- Task 1.2 已抽出 `db/open.ts::openDbWithMigrations(dbPath, migrationsSubdir)`
- library.ts / workspace.ts 现在是 10 行 facade,**不要**再回头复制粘贴
- 后续有第三个 SQLite DB(eg 测试夹具),直接复用 openDbWithMigrations

---

## 累计来源:Task 1.4 review

### B-1.4-001(强烈推荐:Task 1.5 之前补,或紧跟 1.4 的修复 commit)
- **chapter_versions 缺 UNIQUE(chapter_no, version_no) 约束**
- chapters.saveVersion 用 `SELECT MAX(version_no)+1`,better-sqlite3 单连接下安全,但**一旦引入 worker / 测试并发 / 第二连接,version_no 会撞重无报错**
- 修法:加一个 `002_add_chapter_version_unique.sql` 迁移,内容 `CREATE UNIQUE INDEX uniq_chapter_versions_no ON chapter_versions(chapter_no, version_no);`
- 时机:**Task 9.2 章节版本 UI** 之前必须修(那时高频读写版本)

### B-1.4-002(Task 8.6 SidePanel 之前):枚举列加 CHECK
- 8 个枚举字段 SQL 全裸 TEXT(role/level/status/verdict/source/created_by/task_type)
- 当前 zod 在读路径防线,但**写错值会写入成功,后续 list/get 全表 ZodError 崩溃**
- 修法:写一个新 migration,逐个 ALTER 加 CHECK,或在每个 repo 写路径加显式 enum 校验
- Task 8.6 各 panel 编辑时是写路径风险面,在那之前修最稳

### B-1.4-003(Task 8.2 三栏布局之前):outline.reorder 静默失败
- `outline.reorder(parentId, ids)` 对 ids 中**不属于 parentId** 的成员会静默不更新
- UI 拖拽 reorder 传错 parent,看到顺序没动但无错误,debug 噩梦
- 修法:循环里 `if (stmt.run(...).changes === 0) throw new Error("reorder: outline node ${id} not under parentId ${parentId}")`
- 时机:Task 8.2 真去渲染大纲树之前补

### B-1.4-004(Task 9.2 之前):chapters.ts 拆分预警
- 当前 144 行集成 summaries / versions / audits 三套 CRUD
- 阈值监控:再添加 ChapterDraft / ChapterLock 等子表时立即拆
- 不是当前阻塞

### B-1.4-005(信息):json-utils 已抽出
- `packages/server/src/db/json-utils.ts` 含 `parseJsonField` / `parseJsonArray` / `parseNullableObject`
- 7 个 repo 使用统一,后续新 repo 不要再复制粘贴 JSON.parse + try/catch
- 16 个单测 + 7 个 fallback 集成测覆盖 NULL / 空串 / 非 JSON / 非数组 4 类异常输入

### B-1.4-006(测试稳定性,任何时候):setTimeout(5) 抖动
- characters.test / genre-sections.test 用 5ms sleep 拉开 `Date.now()` 差
- Windows 高负载下 Date.now() 解析度可能 ≥10ms
- 修法:改 15ms,或换 `vi.useFakeTimers`
- 不阻塞,观察 flaky 再修

---

## 累计来源:阶段 2 review

### B-2-001(信息):enrichFromOpenRouter cache 毒化已修
- 原 bug:5xx + JSON body 会让缓存写入空 Map,24h 不重试
- 已修(commit `98bc9fd`):`if (!res.ok) return {};`
- 测试覆盖 503 重试 + ok+缺 data 两路径

### B-2-002(信息):classifyError 已扩展网络中断
- ECONNRESET / socket hang up / EAI_AGAIN 现归 `stream_idle`(maxRetries=1)
- 已修(commit `1ed3d3a`)

### B-2-003(必读):reasoningTokens 不变量
- DeepSeek V4 的 reasoning_tokens **已含在 completion_tokens 内**
- usage-tracker.ts 顶部 docstring 已写明
- **若后续接入 reasoning 单独计费的 provider**(eg 某些第三方代理),
  需要给 `ModelInfo.pricing` 加 `reasoningOutput` 字段,并在 computeCost 里单独折算
- Task 5.x / 9.3 用量明细 Task 时如果引入新 provider 注意

### B-2-004(可选,minor):listModels 防御 undefined 字段
- `(j.data ?? []).map(m => ({ id: m.id, ownedBy: m.owned_by }))` 会显式写入 `ownedBy: undefined`
- 当前不影响(enrichFromOpenRouter 不返 ownedBy)
- 将来 listModels 加可空字段(eg contextWindow)前需要补 `pickDefined({...})` 工具
- 或在 Task 2.x 后期顺便清理

### B-2-005(可选,minor):retry 测试不验 backoff 数值
- 当前测试用 `sleepImpl: async () => {}` 吞 sleep
- 改成 `sleeps.push(ms)` 后 `expect(sleeps).toEqual([1000, 2000])` 能锁定 backoff 公式
- 不阻塞,Task 9.x 添加重试 UI 时若改 backoff 再补

### B-2-006(可选,minor):interface.test.ts 仅 expectTypeOf
- 该测试只在 `tsc --noEmit` 阶段拦错,vitest 运行时无意义
- 文件名不暗示这点
- 改进:挪到 `*.type-test.ts`,或加运行时 expect(eg `satisfies` 断言)

---

## 累计来源:阶段 3 review

### B-3-001(信息):writeChapterSimple 原子性
- 落盘顺序:DB saveVersion → 文件 chapterFiles.save → yield done
- 任一失败 yield `error` 替代 `done`,**绝不双终结**
- chapter 文件失败时 `deleteVersion` 回滚 DB(`3a594f0` 引入)
- 二次失败(deleteVersion 也抛)目前 swallow,等接 logger 后埋点

### B-3-002(必读,Task 4.x):chapter 文件 / DB 顺序
- 当前先 DB 后文件,文件失败回滚 DB
- 之后 audit 落盘也要遵循"全部成功才 yield done,任一失败 yield error"模式
- audit 涉及 chapter_audits + chapter_summaries 两表,plan 4.3 用 INSERT OR REPLACE 是正确的

### B-3-003(Task 8.x 真接 stub LLM 之后):换 MockLanguageModelV1
- 当前 mock-llm.ts 是手写 stub,不走 ai-sdk 类型
- ai-sdk 升级到 v5/v6 时可能 break
- 改成 `MockLanguageModelV1` from `ai/test`(若 import 路径在装的版本里能用)
- 当前 MVP 阶段不阻塞

### B-3-004(Task 4.x 之前):prompt builder 抽公共 fragments
- write-chapter.ts / plan-chapter.ts 已有重复 `formatSection(title, body?)` 模式
- 4.1 加 audit-summarize 后,4.4 加 repair-chapter,会有 4 处
- 抽 `packages/server/src/ai/prompts/_shared.ts` 提供 `formatSection` + 用户意图 fallback
- Task 4.x 任意时机做都行

### B-3-005(Task 6.x SSE cancel):跨 runtime 兼容
- 当前 SSE 通过 `c.req.raw.signal` 透传,只在 Node Hono adapter 工作
- 跨 Bun/Workers/Edge 不可靠
- 改成 ReadableStream.cancel(reason) → 内部 AbortController.abort,orchestrator 接它
- 当前 MVP 只跑 Node,不阻塞

### B-3-006(任何时候):测试类型推断
- write-chapter-simple.test.ts / chapter-roundtrip.test.ts 用 `let db: any` 等
- 改 `let db: Database.Database`、`let chaptersRepo: ReturnType<typeof createChaptersRepo>`
- 让 typecheck 在测试 mock 字段写错时拦截

### B-3-007(MVP 之后):AI 味反例扩展
- system-prompt.ts 当前只列 "仿佛/似乎/无尽",防御面窄
- 后期补"宛若/不禁/竟是/望着/眼神中带着/复杂的情感"等高频中文 AI 味
- 同时在 write-chapter prompt 加 "self-check rubric"(写完前自检)
- Task 4.x audit 的 aesthetic_quality 维度可作为补充防线

---

## 累计来源:阶段 4 review

### B-4-001(信息):writeWithAudit 流终结契约
- 4 阶段编排:写章节 → audit → 落盘 → 可选 repair → 二次 audit → 落盘
- **每个 SSE 终结路径都唯一 yield done 或 error**(B-3-002 升级版)
- `tool_call_start(chapter_repair)` 必有成对 `tool_call_end(success: bool, reason?: string)`
- 已修(commit `2de7961`)

### B-4-002(MVP 之后):persistAuditResult 事务化
- 当前 `saveAudit` 和 `saveSummary` 是两次独立 DB 写
- saveSummary 失败会留下 orphan audit 行
- 修法:在 chapters repo 加 `saveAuditWithSummary` 用 db.transaction 包裹
- minor 不阻塞,Task 6.x 题材板块 / Task 9.x 用量明细前补

### B-4-003(MVP 之后):错误文案脱敏
- audit_failed / repair_audit_failed 的 message 直接拼底层异常文本
- 可能向 UI 暴露技术细节(eg "Unexpected token o in JSON")
- 修法:扩 `SseEvent.error` 加 `details?: string` 字段(走日志,UI 只看 message),或 prompt 模板里注入"友好中文兜底句"
- 不阻塞,Task 10.3 错误处理 + Toast 系统时统一处理

### B-4-004(讨论项,Task 7+ UX 决策):enableRepair 默认值
- 当前默认 true,critical 时自动 repair(2× token + 等待)
- 但 Conversation-First 哲学下,**用户应当先看到 critical 报告再决定**是否 repair
- 决策时机:Task 7.1 new-book onboard / Task 8.5 选段改写 / Task 9.1 自动模式时统一定
- 暂时保留 true,后续根据 UI 体验调整

### B-4-005(类型卫生,任何时候):auditCtx → RepairContext 适配
- `write-with-audit.ts` 用 `... input.auditCtx` spread 把 auditCtx 当 RepairContext 子集
- 字段差异(eg auditCtx 有 chapterPlan/tone,repair 不需要)在 spread 里被忽略
- 安全但绕过类型差检
- 修法:加 `fromAuditContext(auditCtx): RepairContext` 显式适配
- 不阻塞,Task 5/6 加新字段时一起重构

### B-4-006(测试卫生):done 唯一性 helper
- 测试目前只 `expect(evs.find(done)).toBeDefined()`
- 不能捕捉"提前 done 后又追加事件"这类回归
- helper:`expectStreamTerminatesWith(evs, "done" | "error")` 同时验最后一个事件 + 总数
- 后续测试(Task 5/6/9 的 orchestrator)可复用

### B-4-007(协议细化):repairChapter 静默 no-op
- `repairChapter` 在 buffer empty 或 success=false 时**不 yield 任何事件**
- 上层依赖 `done` 来判定 repairOk → 协议性矛盾
- 修法:加新 SseEvent type `done_empty` 或在 done 上加 reason 字段
- 当前 writeWithAudit 通过监听 done flag + tool_call_end(success: false) 兜底,**已可用**
- 后续若有 repair-only 路由再统一处理

---

## 累计来源:阶段 5 review

### B-5-001(必做,Task 8.x):writeChapterSimple/auditChapter 改用 ContextBuilder
- Plan 5.4 步骤 3 要求把现有 orchestrator 切到 ContextBuilder 的 messages
- 阶段 5 **未做**(reviseSegment 等还不存在,集中到 8.x 完整 UI 集成时统一切)
- 切换时复用 `loadBookSnapshot` + `buildWriteContext`,删除 `system-prompt + buildWriteChapterPrompt` 的重复拼装
- 影响:writeChapterSimple、writeWithAudit、auditChapter、repairChapter 都要改

### B-5-002(架构资产,任何后续):createSnapshotCache
- 提供 `withSnapshot(bookId, build, fn)` 在单 LLM 调用周期内复用 snapshot
- 后续 writeWithAudit 一次写章+审章应使用同一个 snapshot,避免重复 IO
- HTTP 路由层应在 request scope 内构建 cache 实例,避免跨请求污染

### B-5-003(信息):token 估算公式
- estimateTokens(text):汉字 × 1.5 + 英文按字符 / 4 + 其它字符 × 0.3
- 经验估算,与真实 tokenizer 偏差 ±10-15%
- 用于 budget 决策,不要用于精确成本计算(成本看 usage 字段实测)

### B-5-004(可选,Task 9.x):budgetTokens 默认值
- 当前 default 32_000(留给 32K window 模型的一半)
- DS V4 pro 是 128K window,可调到 80_000
- 应根据 ModelInfo.contextWindow 自动派生:`budget = contextWindow * 0.7`(留 30% 给输出 + reasoning)
- 接入 Task 9.4 单次预算上限校验时一起处理

### B-5-005(已采纳,信息):noUncheckedIndexedAccess
- snapshot.test 三处用 `[0]!` 非空断言通过 strict
- 后续测试若访问数组下标后立即解构,统一用 `!` 或先 `expect(arr).toHaveLength(...)` 再访问

---

## 累计来源:阶段 6 review

### B-6-001(信息):GenreSectionSchema.schema 现在 .min(1)
- Task 6.1 收紧:板块至少 1 个字段
- 影响:Task 1.4 旧测试 `schema: []` 用法已被替换;NULL schema 列会被 zod 拒
- **生产数据若有 NULL/空 schema 行**(理论上不应有,createSection 时校验过),首次读取会抛 ZodError
- 修法:启动时一次性扫描 `genre_sections` 表,有 NULL schema 的清理掉;或读取层加防御
- 不阻塞,Task 9.x / 10.x 收尾时顺手补一个 startup health check

### B-6-002(关键,后续修):LLM 工具调用错误恢复
- 当前 `llm-call.ts` 收到 stream 的 `error` 事件直接 SSE error + return,**短路退出**
- Vercel AI SDK 在工具 execute 抛错时也是发 `{type:"error", error}`,被同样路径吞掉
- **结果**:plan 6.4 期望的"LLM 第二轮自我修复"路径不可达
- 修法:在 `streamLlm` 里区分两类 error:
  1. **tool execution error**(可恢复):转换成 tool-result(isError=true),让 model 继续生成 → 模型自己读到错误信息后改正
  2. **stream/connection error**(不可恢复):保持现有短路行为
- 当前测试已验证:工具抛错时 DB 状态保持正确(不存在的板块没建,存在的没误删),所以**有兜底,但不优雅**
- 优先级:Task 9.x 自动模式之前必修(自动模式重度依赖工具调用,失败必须能自愈)

### B-6-003(架构资产,任何后续):buildToolRegistry
- `tools/registry.ts` 提供 `buildToolRegistry(deps)` 按需注入
- 后续 Task 7+(new-book / chapter-tools / state-tools / book-meta-tools) 都要往里加
- 模式:每个 tool 模块导出 `makeXxxTools(xxxDeps)`,registry 收集

### B-6-004(MVP 之后):多步 tool 调用的 maxSteps 默认值
- 当前 `streamLlm` 默认 `maxSteps: 5`
- 阶段 7 新建书对话流程可能需要 ≥ 8(create_section × 4-5 + add_item × 2-3 + book_meta × 2)
- Task 7.1 实现时根据具体场景调整,或让调用方显式传

### B-6-005(信息):validator 容忍多余字段
- `validateItemAgainstSchema` 对 data 中不在 schema 的字段不抛错
- 故意:支持 schema 演化(改 schema 删字段不让旧 item 失效)
- **副作用**:typo 字段名(eg `name` 写成 `naem`)无法被工具拦,会**静默存进 data**
- 如果未来发现 typo 痛点,改 validator 加 strict 模式开关

---

## 累计来源:阶段 7 review

### B-7-001(必修,Task 8.x 接前端时):server.ts 加路由
- plan 7.1 步骤 4 / 7.3 步骤 3 提到的路由 推迟到 Task 8.x:
  - `POST /api/books`(创建空书)
  - `POST /api/books/:bookId/onboard`(新建书对话流式)
  - `GET /api/books/:bookId/onboard-status`(返回 isOnboardComplete 结果)
  - `POST /api/books/:bookId/onboard/skip`(跳过流程,仅初始化空 book_meta)
- 当前 server.ts 还没有 `/api/books` 集合(只有 conversation/chapters)

### B-7-002(信息):lengthTarget 字段未走 BookSnapshot
- `set_book_meta(lengthTarget)` 工具支持
- 但 `BookSnapshot.meta` 类型只列了 title/premise/tone/genre 四项
- `isOnboardComplete` 暂时把 lengthTarget 视为缺失(不计入 extras 计数)
- 修法:扩展 BookSnapshot 类型,或让 isOnboardComplete 直接读 bookMetaRepo
- 不阻塞,Task 8.x 加 lengthTarget UI 时一起改

### B-7-003(架构):completenessHint 注入策略
- `NewBookInput.completenessHint` 字段已暴露,**调用方决定何时注入**
- Task 8.x 接前端时,**HTTP 路由层应在每轮调用 onboard orchestrator 前调一次 isOnboardComplete + formatCompletenessHint** → 注入到下一轮 LLM
- 这样 LLM 永远知道还差什么,不会跑偏

### B-7-004(信息):book-meta-tools 不含 set/update foreshadowing
- 阶段 7 工具集只覆盖 onboard 阶段需要的(meta + character + outline + rules.md)
- 后续 Task 8.x 写作过程中创建/管理伏笔,需要新增 foreshadowing-tools(`add_foreshadowing` / `update_foreshadowing` / `pay_foreshadowing`)
- 同样:`add_timeline_event` 也要加

### B-7-005(简化的代价):MultiTurnStub fixture 重复
- `genre-section-conversation.test.ts`(Task 6.4)和 `new-book-flow.test.ts`(Task 7.3)都内联写了 makeMultiTurnStub
- 共享 fixture 应该抽到 `tests/fixtures/mock-llm.ts`(已有 makeStubLanguageModel,可加 makeMultiTurnStub)
- 不阻塞,后续测试增多时一起重构

---

<!-- BACKLOG-APPEND-HERE -->
