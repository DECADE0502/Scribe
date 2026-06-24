# Agent Workflow 统一管线设计

Date: 2026-06-24
Status: Draft, awaiting user approval

## 1. 背景

Scribe 当前有 8 个 AI 入口点:

| 入口 | 文件 | 问题 |
|---|---|---|
| `/conversation` | `conversation-orchestrator.ts` | 对话/写章/审查/删除/伏笔混在一个函数 |
| `/chapters/:no/write` | `chapters.ts` | 完整写章+记录,独立于 conversation |
| `/chapters/:no/write-draft` | `chapters.ts` | 只写正文不验证,留半成品 |
| `/chapters/:no/finalize` | `chapters.ts` | 独立的审查→修复→记录三步 |
| `/auto` | `auto.ts` | 独立多章批量流程 |
| `/onboard` | `onboard 相关 handler` | 独立引导流程 |
| `/worldbook/chat` | `worldbook chat handler` | 独立世界书对话 |
| `/revise-segment` | `revise.ts` | 独立段落改写 |

**后果**: 8 套互不通的写章/审查/修复逻辑,草稿在验证前落库,前端 SSE 流结束就弹成功(即使后台工作流内部失败)。

## 2. 目标

**一根管线收口所有 AI 操作。** 四个角色(思考→执行→验证→修复),一个入口 `POST /api/books/:bookId/agent/run`,所有现有路由逐步降为 wrapper。

## 3. 数据模型

### 3.1 workflow_runs

```sql
CREATE TABLE workflow_runs (
  id         TEXT PRIMARY KEY,
  book_id    TEXT NOT NULL,
  source     TEXT NOT NULL,   -- chat/editor/auto/onboard/revision/asset_audit
  phase      TEXT NOT NULL DEFAULT 'thinking',
  verdict    TEXT,            -- pass/repairable/needs_user/fail(Validator 产出后填写)
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

### 3.2 workflow_staged_changes

```sql
CREATE TABLE workflow_staged_changes (
  id         TEXT PRIMARY KEY,
  run_id     TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,   -- chapter_version/chapter_summary/chapter_audit/character_upsert/outline_upsert/timeline_event/foreshadowing_upsert/worldbook_upsert/record_upsert
  payload    JSON NOT NULL,
  committed  INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
```

**设计要点**:
- 暂存表不取代现有业务表。它是"待验证缓冲"。commit 时逐条写入目标表,然后 `committed=1`。
- `run_id` 关联 workflow_runs。用户刷新页面 → GET `/api/books/:bookId/agent/runs/latest` → 取到上次 `phase = 'waiting_user'` 的 run → 恢复验证对话框。
- `sort_order` 保证 commit 顺序(先建角色再写章)。

### 3.3 共享类型(`packages/shared/src/types/agent-workflow.ts`)

```ts
type AgentPhase =
  | "thinking"
  | "executing"
  | "validating"
  | "waiting_user"
  | "repairing"
  | "completed";

type ValidationVerdict = "pass" | "repairable" | "needs_user" | "fail";

interface ValidationIssue {
  severity: "info" | "warning" | "critical";
  area: "user_request" | "chapter" | "character" | "outline"
      | "worldbook" | "timeline" | "foreshadowing" | "record" | "system";
  message: string;
  evidence?: string;
  suggestedAction: "repair" | "reroll" | "ask_user" | "ignore" | "stop";
}

interface AgentRunRequest {
  message: string;
  source: "chat" | "editor" | "auto" | "onboard" | "revision" | "asset_audit";
  executionMode?: "trusted_auto" | "low_risk_auto" | "confirm_each";
  target?: {
    chapterNo?: number;
    chapterCount?: number;
    revisionRange?: { chapterNo: number; selectedText?: string };
  };
}
```

## 4. 流水线骨架

### 4.1 agent-runner.ts

```
POST /api/books/:bookId/agent/run
→ runAgentWorkflow(deps, input)
→ SSE 流
```

四个阶段:

```
thinking → 理解意图,生成 MainOutput(reply + draft + taskContract)
executing → 把 taskContract 变成 ExecutionPlan(steps),写入 staging
validating → 对 staging 变更做统一验证,产出 ValidationReport
↓
pass → commit → completed
repairable + (非 trusted_auto) → waiting_user → 前端显示决策对话框
repairable + trusted_auto / fail → repairing → validating(重跑)
```

### 4.2 四个角色函数

| 文件 | 函数 | 责任 | 复用现有 |
|---|---|---|---|
| `main-agent.ts` | `runMainAgent` | 理解意图,输出 `reply + draft + taskContract` | `agenticChatWithTriggers` 去掉 mutation 工具调用 |
| `executor-agent.ts` | `runExecutor` | taskContract → ExecutionPlan(staged changes) | `write-chapter.ts` prose 生成 + `record-state.ts` 工具逻辑 |
| `validator-agent.ts` | `runValidator` | 对 staged changes 出 ValidationReport | `audit-chapter.ts` + `hard-fact-gate.ts` + `workflow-contract.ts` → 一份统一报告 |
| `repair-agent.ts` | `runRepair` | 只修 Validator issues 里 `suggestedAction === "repair"` 的条目,不改其它 | `repair-chapter.ts` 单章修复逻辑 |

### 4.3 Repair 接口

```ts
interface RepairInput {
  report: ValidationReport;        // Validator 的完整报告
  plan: ExecutionPlan;             // 原始执行计划(staged changes)
  approvedIssues: string[];        // 用户选择的要修复的 issue index(从 0 起);trusted_auto 时自动全选 suggestAction==="repair" 的条目
}

interface RepairResult {
  repairedPlan: ExecutionPlan;     // 修改后的执行计划(新增/替换的 staged changes)
  summary: string;                 // 修复摘要
}
```

`runRepair` 只处理 `suggestedAction === "repair"` 的条目。`reroll` / `ask_user` / `ignore` 不进入 Repair——它们分别对应"重生成"(回 Executor)、"弹框问用户"、"忽略继续 commit"的逻辑,这些分支在 `agent-runner.ts` 的主循环里处理。

### 4.4 SSE 事件

| 事件 | payload | 含义 |
|---|---|---|
| `agent_phase` | `{ phase }` | 新阶段 |
| `main_output` | `{ reply, draft? }` | Main Agent 输出 |
| `execution_plan` | `{ steps, summary }` | 将要执行的操作 |
| `execution_step` | `{ stepId, status }` | 单步状态 |
| `validation_report` | `{ verdict, issues }` | Validator 完整报告 |
| `repair_plan` | `{ steps }` | Repair 操作 |
| `done` | `{ committed, needsUserDecision?, runId? }` | 流程结束 |
| `error` | `{ ... }` | 异常中断 |

### 4.4 暂存层接口

```ts
interface WorkflowStaging {
  begin(runId: string): void;
  add(runId: string, change: StagedChange): void;
  commit(runId: string, handle: BookHandle): CommitResult;
  discard(runId: string): void;
}

interface StagedChange {
  id: string;
  type: "chapter_version" | "chapter_summary" | "chapter_audit"
      | "character_upsert" | "outline_upsert"
      | "timeline_event" | "foreshadowing_upsert"
      | "worldbook_upsert" | "record_upsert";
  payload: unknown;
}

interface CommitResult {
  committed: StagedChange[];
  failed: { change: StagedChange; error: string }[];
}
```

`commit` 按 `sort_order` 升序逐条写入目标表。每条包裹在独立 `db.transaction()` 中——单条失败不回滚前面已成功的,而是记入 `failed[]` 并继续。全部失败时 workflow_run 的 phase 置为 `failed`。

## 5. 路由迁移策略(8 个阶段)

### Phase 1: 类型层

新建/扩展共享类型,不改任何逻辑:
- `packages/shared/src/types/agent-workflow.ts` — AgentPhase / ValidationVerdict / ValidationIssue / AgentRunRequest
- `packages/shared/src/types/sse-events.ts` — 新增 agent_phase / main_output / execution_plan / execution_step / validation_report / repair_plan

### Phase 2: 数据库 + 暂存层

**Migration**: `0010_workflow.sql`(workspace),建 `workflow_runs` + `workflow_staged_changes`。

**Repository**: `packages/server/src/db/repositories/workflow-runs.ts`,暴露 `create` / `setPhase` / `setVerdict` / `getLatestByBook` / `getLatestWaitingUser`。

**Staging 实现**: `packages/server/src/ai/orchestrator/workflow-staging.ts`,基于这两个 repo 实现 `WorkflowStaging` 接口。`commit()` 方法内部用 switch 按 type 路由到对应 repo——`chapter_version` → `chaptersRepo.saveVersion`, `character_upsert` → `charactersRepo.create/update`,以此类推。

**测试**: `workflow-staging.test.ts` — 覆盖 commit 成功/部分失败/全部失败/空暂存区 discard。

### Phase 3: 新路由骨架

`packages/server/src/http/routes/agent.ts`: `POST /api/books/:bookId/agent/run`。

先不做四个角色的真实实现——骨架期 Main Agent 直接返回固定 `taskContract`,Executor 写一条假的 `staged_change`,Validator 直接返回 `pass`,`done.committed = true`。目标是**跑通整个 SSE 事件链路**,前端能看到四个 phase + done 事件。

### Phase 4: 四个角色逐个接电线

按依赖顺序:

1. **Validator** (最先,因为它最独立:输入是 `StagedChange[]` + 书上下文,输出是 `ValidationReport`) — 复用 `audit-chapter.ts` / `hard-fact-gate.ts` 逻辑,合并成统一 report
2. **Executor** — 接管 `write-chapter.ts` 的 prose 生成和 `record-state.ts` 的工具落地。**现在旧的 `write-with-audit` 里 prose 落库的路径不改**,只是 Executor 内部复用它的生成逻辑,但输出到 staging
3. **Main Agent** — 从 `agenticChatWithTriggers` 拆出"分析意图 + 生成回复"的部分
4. **Repair** — 复用 `repair-chapter.ts`

### Phase 5: conversation 迁移

`POST /api/books/:bookId/conversation` 变成 wrapper:

```
旧: runConversation(deps, input) → SSE
新: POST /agent/run { source: "chat", message, history, executionMode }
```

前端逻辑不变——先通过 wrapper 接烟囱,确认所有对话场景(写章/查角色/改设定)都走新管线后,再把 wrapper 去掉。

### Phase 6: editor 迁移

`/write` + `/write-draft` + `/finalize` 三条路线合并:

```
旧 /write:        writeWithAudit → recordChapterState
旧 /write-draft:  writeChapterSimple(只 prose,不验证)
旧 /finalize:     auditChapter → repairChapter → hardFactGate → recordChapterState
```

新:全部走 `POST /agent/run`:
- `/write` → `source: "editor"`, `target.chapterNo`
- `/finalize` → `source: "editor"`, `target.chapterNo`, Main Agent 识别到草稿已生成,跳过 prose 生成,直接执行→验证
- `/write-draft` → 废弃(新管线内 prose 生成和验证是一体的,不需要"只写 prose"的中间态)

### Phase 7: auto / onboard / revision / worldbook 迁移

| 旧入口 | 迁移为 |
|---|---|
| `/auto` | `source: "auto"`, `target.chapterCount` |
| `/onboard` | `source: "onboard"` |
| `/revise-segment` | `source: "revision"`, `target.revisionRange` |
| `/worldbook/chat` | `source: "asset_audit"`(或直接走 conversation 的模式切换) |

每个迁移都是**旧路由回调新管线**的方式,不做一次性大切换。每迁完一个,旧 handler 标记 `// @deprecated` 注释,测试补上。

### Phase 8: 前端改造

改动四个组件,每个独立提测:

1. **conversation-pane.tsx**: 统一 SSE 解析器,显示四个 phase,章节内容不在聊天里展示
2. **streaming-message.tsx**: 不再手动解析 SSE 流和忽略事件 payload
3. **editor-pane.tsx**: 不再用 `/write-draft` 和 `/finalize`,改为发起 agent/run 请求;收到 `validation_report` 后显示对话框
4. **validation-dialog.tsx**(新建): 展示 Validator 报告 + 四个按钮(修复/重生成/忽略/取消)

## 6. 关键行为规则

### 6.1 验证不通过不准落库

所有 AI 产出写 `workflow_staged_changes`,Validator 说 pass 才能 commit。唯一的例外是用户手动 CRUD(比如在 sidebar 里手动改角色),那些绕开管线直接写目标表——管线不会重新验证手动编辑。

### 6.2 SSE 流结束 ≠ 成功

前端必须等 `done.committed === true` 才弹成功。`error` 事件或 `done.committed === false` 都**不是**成功。

### 6.3 修复受控

```
repairable + confirm_each    → waiting_user,前端弹框
repairable + low_risk_auto   → 自动修复 1 次,回 Validator
repairable + trusted_auto    → 自动修复 1 次,回 Validator
fail                          → 自动修复 1 次,回 Validator;再 fail → waiting_user
```

最多 1 次自动修复 + 2 次用户触发修复,防无限循环。

### 6.4 旧代码不删,标记 deprecated

在全部入口迁移完成 + 前端切到新管线之前,旧函数的代码保留:
```
// @deprecated — replaced by POST /agent/run with source:"chat". Remove after Phase 5 UI migration.
```

## 7. 测试要求

### 共享类型
- `packages/shared/tests/agent-workflow.test.ts` — ValidationVerdict / AgentPhase / ValidationIssue schema 验证

### 服务端单元
- `agent-runner.test.ts` — 四个阶段事件顺序 / pass 分支 commit / fail 分支不 commit / repairable 分支 waiting_user
- `workflow-staging.test.ts` — commit 全部成功 / 部分失败 / 空暂存区 / 一条失败后序仍执行
- `validator-agent.test.ts` — pass / repairable / fail 三种 verdict 产出
- `executor-agent.test.ts` — taskContract → ExecutionPlan / 角色去重 / 章写入 staging

### 服务端集成
- `agent-runner-routes.test.ts` — `/agent/run` 返回完整 SSE 流 / error 阻止 committed
- `chat-streaming.test.ts` — `/conversation` wrapper 产出新 phase 事件
- `books-routes.test.ts` — `/write` wrapper 不再直接落库

### 客户端
- `conversation-writing-intent.test.tsx` — 四阶段渲染 / 章节不显示在聊天
- `editor-workflow.test.tsx` — 收到 committed 后才刷新章节列表
- `validation-dialog.test.tsx` — 显示报告 / 四个按钮请求

## 8. 手动自检清单

打包前跑:

```powershell
# 旧标签不应出现在 UI
rg -n "hard_fact_gate|硬事实|chapter_audit|审查章节质量|record_chapter_state|记录角色状态|write-draft|finalize" packages/client/src

# 旧 AI 入口不应被 UI 直接调用
rg -n "chapters/:no/write-draft|chapters/:no/finalize|worldbook/chat" packages/client/src

# AI 写作落库不绕过 staging
rg -n "saveVersion\(|chapterFiles\.save\(|saveAudit\(|saveSummary\(" packages/server/src/ai packages/server/src/http/routes

# UI 不应在 SSE 流结束时直接弹成功
rg -n "reader\.read\(|正文已生成|确认.*完成|setHasAudit\(true\)" packages/client/src
```

## 9. 不在本档范围

- 暂存层的跨书/跨用户隔离(单用户本地应用不需要)
- 工作流运行历史归档/清理(workflow_runs 表无限增长,以后再管)
- Main Agent 的"生成 prose 草稿但不显示"机制——先用现有 write-chapter 逻辑兜底,不新开发
- 四个角色全部替换旧逻辑后删除旧文件——Phase 8 客户端迁移完成后再做

## 10. 工作量估算

| Phase | 内容 | 预估 |
|---|---|---|
| 1 类型层 | shared types + SSE events | 0.5 天 |
| 2 数据+暂存层 | migration + repo + staging impl + 测试 | 1.5 天 |
| 3 路由骨架 | agent.ts + SSE 链路跑通 | 1 天 |
| 4 角色接线 | Validator/Executor/Main/Repair 逐个通电 | 2 天 |
| 5 conversation 迁移 | wrapper + 测试 | 0.5 天 |
| 6 editor 迁移 | 三条路线合并 + 废弃 write-draft | 1 天 |
| 7 auto/onboard/revision/worldbook | 四个入口逐个迁 | 1 天 |
| 8 前端改造 | 四个组件 + validation-dialog | 1.5 天 |
| **合计** | | **9 天** |
