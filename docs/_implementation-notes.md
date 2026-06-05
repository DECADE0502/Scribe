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

<!-- BACKLOG-APPEND-HERE -->
