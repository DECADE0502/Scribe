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

<!-- BACKLOG-APPEND-HERE -->
