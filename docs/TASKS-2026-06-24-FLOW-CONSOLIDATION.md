# 2026-06-24 全量流程混用整改任务清单

> 目的：完整记录并逐步修复当前项目里“新流程已加、旧流程仍跑、旁路直接写入、UI 误判完成”的位置。本文既是任务清单，也是修复进度记录。

## 2026-06-24 修复进度

已完成：

### 2026-06-25 最新完成

- 统一 Agent 工作流已成为当前实现基线：
  - `/api/books/:bookId/agent/run` 是唯一可执行 AI 入口。
  - `/conversation` POST、旧 `/auto`、章节 `write/write-draft/finalize`、`revise-segment/apply-revision`、`worldbook/chat`、旧 onboard AI 路由均已删除、410 或迁到统一 Agent source。
  - 前端成功刷新以 `done.committed === true` 为准，避免半程失败仍刷新/落库。
- `main-agent.ts` 已取消 regex/keyword 触发写作，改由模型输出结构化 JSON 决策；无结构化输出回退 `query_only`。
- `executor-agent.ts` 已支持 `write_chapter`、`update_character`、`update_outline`、`update_worldbook`、`asset_audit`，并新增 `assetChanges` 结构化资产变更，避免工具调用只剩标题或空壳。
- `validator-agent.ts` 已补关键质量闸门：
  - 写入章节号必须匹配用户请求；
  - 低于 100 字为 repairable；
  - 明确要求第一人称时，正文必须稳定使用第一人称；
  - 禁止 `未完待续`、`下一章再展开`、`且听下回`、`to be continued` 等连续小说填充式结尾；
  - 空验收标准、大纲/世界书/审查结构错误会阻断提交。
- critical validation failure 不再自动 repair 或 commit。
- 低风险写入会暂停等待用户确认；确认通过 `/agent/runs/:runId/approve` 提交已暂停的 staged changes，不再重新跑 prompt。
- 聊天历史按书本隔离，并引入 message service 区分可见聊天、进度摘要、隐藏草稿/提示、手动资产变更等消息类型。
- 客户端测试中可见 React `act(...)` warning 已清理。
- 2026-06-25 全量验证通过：
  ```powershell
  pnpm --filter @scribe/server typecheck
  pnpm --filter @scribe/client typecheck
  pnpm --filter @scribe/shared typecheck
  pnpm --filter @scribe/server exec vitest run
  pnpm --filter @scribe/client exec vitest run
  pnpm --filter @scribe/shared exec vitest run
  ```
  ```text
  server typecheck: passed
  client typecheck: passed
  shared typecheck: passed
  server tests: 103 files / 578 tests passed
  client tests: 25 files / 122 tests passed
  shared tests: 5 files / 48 tests passed
  ```

下一阶段仍需重点处理：

- 验证器仍偏 deterministic，后续应升级为模型辅助验收 Agent，逐条回查主 Agent 的 acceptanceCriteria，并额外审查章级大纲覆盖、文风参考、视角连续性、长度目标、上下文延续和资产一致性。
- 写作上下文仍需统一成 `WritingContextBundle`：最近 10 章全文、前 20-10 章每章小结、20 章以前总摘要、目标章精确大纲、文风参考、深层提示词和书本规则必须由同一 builder 提供给写作/修复/验收。
- LLM usage 还需要更细的 phase/purpose/runId 归因，方便解释 API 调用量。
- 历史文档中仍有旧流程描述，后续实现者应以 `docs/HANDOFF-codex.md` 和本文最新段落为当前基线。

- `agent-runner` 终态保护：commit 有 failed change 时不再 `done committed:true`；任一 workflow phase 抛错时会发 `error workflow_failed` + `done committed:false`。
- `AgentRunRequestSchema.target` 扩展：正式支持 `mode`、`defaultChapterLength`、`auditScope`、revision range start/end，避免前端结构化字段被 Zod strip 掉。
- `chapters.ts` editor wrapper：`write/write-draft/finalize` 通过结构化 `target.mode` 传递语义，不再拼 `write chapter/finalize chapter` 命令文本。
- `main-agent` 输入链：`source/target/executionMode` 已进入 TaskContract，后续 executor/validator 可用硬约束，不必从 message 猜。
- `editor-pane` 成功判定：写作/确认只在 SSE `done.committed === true` 时刷新章节；`committed:false` 或 `error` 不再被当成功。
- `book-tools.ts` trigger tools 已移除：不再暴露 `makeTriggerTools`、`TriggerAction`、`__action`、`write_next_chapter/rewrite_chapter/delete_chapters/audit_chapter`。
- `conversation-orchestrator` 的 agentic chat 不再检测 `__action` 后中断 stream 执行写章/删章/审查；重流程必须由统一 agent/run 的 TaskContract + executor/staging 负责。
- `conversation-pane` 成功判定：写作状态下只有 `done.committed === true` 才刷新章节；`done.committed:false` 只提示等待确认或修复。
- 新增/扩展测试：
  - `packages/server/tests/unit/ai/orchestrator/agent-runner.test.ts`
  - `packages/server/tests/unit/ai/orchestrator/legacy-trigger-guard.test.ts`
  - `packages/shared/tests/agent-workflow.test.ts`
  - `packages/server/tests/unit/http/ai-routes-guard.test.ts`
  - `packages/client/tests/components/conversation-pane.test.tsx`
  - `packages/client/tests/components/editor-pane.test.tsx`

仍未完成：

- 普通聊天 UI 仍兼容旧 `tool_call_start/tool_call_end/chapter_write/auto_status/acceptance_report`，但 `done.committed:false` 已不再刷新章节。
- `onboard.tsx` 仍直接请求 `/onboard` 并解析旧事件。
- `revise-preview.tsx` 仍没有完整 staged candidate/commit 协议。
- 旧 orchestrator 直接落库模块仍未拆成 pure generation + staging commit。
- 全量上下文策略与统一写作 builder 未完成。

### 2026-06-25 全量残留识别补充

> 下面是本轮再次扫描后，仍然能看到的旧语义、旧路由、旧测试、旧文案。它们不是“可忽略的历史痕迹”，而是后续必须逐项清掉的 task。

#### A. 类型层残留：`command_explicit` 仍在类型系统里

- 文件：
  - `packages/server/src/ai/orchestrator/intent.ts`
  - `packages/shared/src/types/sse-events.ts`
- 现状：
  - `IntentCategory` 里还有 `command_explicit`。
  - `SseEventSchema.intent.category` 里也还允许 `command_explicit`。
  - `intent.ts` 注释仍写着 `command_explicit 由 parseSlashCommand 在分类前判定`。
- 任务：
  1. 删除 `command_explicit`，让意图分类只保留自然语言分类。
  2. 清掉 `parseSlashCommand` 相关注释与说明。
  3. 让 slash 只保留 UI autocomplete，不再进入意图路由。
- 验收：
  ```powershell
  rg -n "command_explicit|parseSlashCommand" packages/server/src packages/shared/src -g "*.ts"
  ```
  不得再有命中。

#### B. 编辑器残留：页面还在提示 `/write`，且旧按钮还活着

- 文件：
  - `packages/client/src/components/editor/editor-pane.tsx`
  - `packages/client/tests/components/editor-pane.test.tsx`
- 现状：
  - 空态文案仍提示“输入 `/write` 让 AI 写第一章”。
  - 编辑器里还有 `btn-write-draft`、`btn-finalize`、`/write` 相关 UI。
  - 测试仍在断言 `/write` 提示存在。
- 任务：
  1. 把空态提示改成自然语言，不再显示 slash 命令。
  2. 如果写作入口已统一，移除旧的 draft/finalize 文案和按钮语义。
  3. 更新测试，确保 UI 只呈现统一工作流入口。
- 验收：
  ```powershell
  rg -n "/write|write-draft|finalize" packages/client/src/components/editor packages/client/tests/components/editor-pane.test.tsx -g "*.ts" -g "*.tsx"
  ```
  只允许迁移期说明，不允许主流程文案命中。

#### C. 旧自动模式残留：`/auto` 仍是独立路由和独立测试主题

- 文件：
  - `packages/server/src/http/routes/auto.ts`
  - `packages/client/tests/components/phase9.test.tsx`
  - `packages/server/tests/integration/auto-mode.test.ts`
- 现状：
  - `auto.ts` 仍然注册 `/api/books/:bookId/auto` 和 `/auto/cancel`。
  - 相关测试仍在检查 `/auto`、`/auto/cancel` 的 legacy 行为。
- 任务：
  1. 把 `/auto` 收成统一 `agent/run` wrapper，或者直接降级为 410。
  2. `/auto/cancel` 不再拥有独立取消状态。
  3. 将测试改为验证新的 run/action 或统一 workflow 行为。
- 验收：
  ```powershell
  rg -n "/auto|auto/cancel|runAutoMode" packages/server/src/http/routes/auto.ts packages/server/tests/integration/auto-mode.test.ts packages/client/tests/components/phase9.test.tsx
  ```
  旧语义不得继续作为主流程存在。

#### D. 创书入口残留：`/onboard` 仍是独立 AI 路由

- 文件：
  - `packages/server/src/http/routes/books.ts`
  - `packages/client/src/pages/onboard.tsx`
  - `packages/client/src/App.tsx`
  - `packages/client/src/api/client.ts`
  - `packages/client/tests/pages/onboard.test.tsx`
  - `packages/server/tests/integration/books-routes.test.ts`
- 现状：
  - 后端仍有 `/api/books/:bookId/onboard`。
  - 前端仍有 `OnboardPage`、`/books/:bookId/onboard` 路由重定向、以及 status/skip API。
  - 测试仍直接围绕 onboard 旧路由写。
- 任务：
  1. `onboard` 改成统一 agent workflow 的一个 source。
  2. 把状态接口保留为非 AI 辅助接口，AI 对话本体不再独立走 `/onboard`。
  3. 前端页面与测试同步改到 `/agent/run`。
- 验收：
  ```powershell
  rg -n "/onboard|onboard-status|onboard/skip" packages/server/src packages/client/src packages/client/tests packages/server/tests -g "*.ts" -g "*.tsx"
  ```
  只允许非 AI 状态接口和迁移说明。

#### E. 世界书与改写残留：仍有独立 mutation 路由

- 文件：
  - `packages/server/src/http/routes/worldbook.ts`
  - `packages/server/src/http/routes/revise.ts`
  - `packages/server/tests/integration/worldbook-routes.test.ts`
  - `packages/server/tests/integration/revise-routes.test.ts`
  - `packages/client/tests/components/selection-revise.test.tsx`
  - `packages/client/src/components/editor/revise-preview.tsx`
- 现状：
  - `worldbook/chat` 仍是独立 AI 入口。
  - `revise-segment` / `apply-revision` 仍是独立双阶段改写链。
  - 前端测试还在围绕旧 apply-revision 旧语义写。
- 任务：
  1. worldbook AI 编辑收口到统一 agent run。
  2. revise-segment 仅保留为编辑器内的 proposal 生成，不直接落库。
  3. apply-revision 改成统一 commit/approve 的一部分。
  4. 测试改为验证 staged changes，而不是旧直接保存。
- 验收：
  ```powershell
  rg -n "worldbook/chat|revise-segment|apply-revision" packages/server/src packages/client/src packages/server/tests packages/client/tests -g "*.ts" -g "*.tsx"
  ```

#### F. 聊天与消息协议残留：旧事件仍被 UI 和测试消费

- 文件：
  - `packages/client/src/components/conversation/conversation-pane.tsx`
  - `packages/client/src/components/conversation/message.tsx`
  - `packages/client/src/components/conversation/streaming-message.tsx`
  - `packages/client/tests/components/conversation-pane.test.tsx`
  - `packages/client/tests/components/conversation-tool-feedback.test.tsx`
  - `packages/client/tests/components/conversation-writing-intent.test.tsx`
  - `packages/server/tests/integration/chat-streaming.test.ts`
- 现状：
  - 旧 `tool_call_start/tool_call_end/acceptance_report/text_delta` 还在测试和 UI 里出现。
  - conversation pane 仍有旧成功/失败分支兼容逻辑。
- 任务：
  1. 主流程 UI 只认新的 agent 事件。
  2. 旧事件如果保留，只能作为 legacy ignore。
  3. 聊天正文、写作正文、审查 prompt 要分层存储，不要混进可见聊天记录。
- 验收：
  ```powershell
  rg -n "tool_call_start|tool_call_end|acceptance_report|text_delta|chapter_write|record_chapter_state" packages/client/src packages/client/tests packages/server/tests -g "*.ts" -g "*.tsx"
  ```

#### G. 旧写作链残留：`writeWithAudit`、`writeChapterSimple`、`auditChapter` 仍在测试与路由里活跃

- 文件：
  - `packages/server/src/ai/orchestrator/write-chapter.ts`
  - `packages/server/src/ai/orchestrator/write-with-audit.ts`
  - `packages/server/src/ai/orchestrator/audit-chapter.ts`
  - `packages/server/src/ai/orchestrator/repair-chapter.ts`
  - `packages/server/src/ai/orchestrator/record-state.ts`
  - `packages/server/tests/integration/write-chapter-simple.test.ts`
  - `packages/server/tests/integration/write-then-audit.test.ts`
  - `packages/server/tests/integration/chapter-roundtrip.test.ts`
  - `packages/server/tests/integration/user-journey.test.ts`
- 现状：
  - 旧生成、审查、修复、记录 state 仍各自直接落库。
  - 测试仍在验证旧链路产物和旧 SSE 事件。
- 任务：
  1. 拆 pure generation 和 staging commit。
  2. 旧测试改为验证 pure 输出与 staging 约束。
  3. 不能再把“半程成功”当成可接受完成态。
- 验收：
  ```powershell
  rg -n "writeWithAudit|writeChapterSimple|auditChapter|repairChapter|recordChapterState" packages/server/src packages/server/tests -g "*.ts"
  ```

#### H. 旧 slash / regex 入口残留：shared 仍暴露命令文本

- 文件：
  - `packages/shared/src/slash-commands.ts`
  - `packages/client/src/components/conversation/slash-suggestions.tsx`
  - `packages/shared/tests/slash-suggestions.test.ts`
  - `packages/client/tests/components/slash-suggestions.test.tsx`
- 现状：
  - shared 里仍定义 `/write`、`/auto`、`/rewrite`、`/revise`、`/audit`、`/recall`、`/note`。
  - UI 虽然已改成建议文本，但 shared 词表还带着旧命令语义。
- 任务：
  1. slash 仅作为自然语言模板插入，不再输出 command id。
  2. 删除或降级共享命令词表里所有会暗示执行路由的文案。
  3. 测试明确“这里只是 autocomplete，不是命令解析”。
- 验收：
  ```powershell
  rg -n "SLASH_COMMANDS|/write|/auto|/rewrite|/revise|/audit|/recall|/note" packages/shared/src packages/client/src packages/shared/tests packages/client/tests -g "*.ts" -g "*.tsx"
  ```

#### I. 旧测试护栏残留：一些测试仍在保护旧行为

- 文件：
  - `packages/client/tests/components/ai-entrypoints-guard.test.ts`
  - `packages/server/tests/unit/ai/orchestrator/legacy-trigger-guard.test.ts`
  - `packages/server/tests/unit/ai/orchestrator/conversation-orchestrator.test.ts`
  - `packages/server/tests/unit/http/ai-routes-guard.test.ts`
- 现状：
  - 这些测试多数在守护新方向，但个别断言还带着旧路由/旧事件名。
  - 一些测试文件名和内容仍可读出“旧流程是主流程”的感觉。
- 任务：
  1. 把旧行为相关测试统一标成 legacy/ignore。
  2. 把主流程测试改成只断言新 workflow contract。
  3. 让护栏测试继续守住“别把旧流程悄悄加回来”。

#### J. 文档残留：历史说明里仍保留旧体系描述

- 文件：
  - `docs/_implementation-notes.md`
  - `docs/ARCHITECTURE-REVIEW-2026-06-24.md`
  - `docs/CLAUDE-AGENT-WORKFLOW-REWORK.md`
  - `docs/HANDOFF-codex.md`
  - `docs/README.md`
- 现状：
  - 这些文档里仍有大量旧架构、旧路由、旧事件的说明。
  - 其中有些是历史记录，有些仍像当前规范。
- 任务：
  1. 区分“历史遗留”与“当前规范”。
  2. 当前规范必须只保留 unified agent workflow。
  3. 历史文档需要明确标注 obsolete，避免误导下一位实现者。

#### K. 建议新增总检索任务：把“旧流程痕迹”一次性扫净

- 建议建立一个总 task，专门跑以下检索并人工确认：
  ```powershell
  rg -n "command_explicit|parseSlashCommand|/write\\b|/auto\\b|/onboard\\b|worldbook/chat|revise-segment|apply-revision|write-draft|finalize|tool_call_start|tool_call_end|acceptance_report|execution_step|record_chapter_state|chapter_write|chapter_audit|makeTriggerTools|TriggerAction|plannedChapterWriteFlow|plannedAuditFlow|plannedDeleteFlow" packages docs -g "*.ts" -g "*.tsx" -g "*.md"
  ```
- 目标：
  1. 每次删掉一个旧入口，就同步删掉对应测试和文案。
  2. 不允许“新流程新增了，旧流程只是没动”。
  3. 所有残留必须明确属于 legacy adapter、历史文档或负向测试。

## 总结

当前项目至少并存三代 AI 流程：

1. 旧 tool/SSE 流：`tool_call_start/tool_call_end` + `writeWithAudit/writeChapterSimple/auditChapter/recordChapterState`。
2. 中间 workflow 流：`execution_plan/execution_step/acceptance_report` + `conversation-orchestrator` 内部执行策略。
3. 新 agent 流：`/agent/run` + `agent_phase/main_output/validation_report/workflow-staging`。

真实 UI 入口大多仍走旧流程或中间流程，`/agent/run` 目前只是旁路骨架。整改必须先收入口，再迁执行，再删旧触发。

---

## 2026-06-24 全量识别快照

> 本节是对当前工作树的静态扫描结果。它不是方案口号，而是逐文件 task。后续修复时必须一项项打掉，不能只新增新接口。

### 扫描命令

```powershell
rg -n "runAgentWorkflow|runConversation|runAutoMode|runNewBookConversation|runWorldbookChat|writeWithAudit|writeChapterSimple|auditChapter|repairChapter|recordChapterState|parseSlashCommand|makeTriggerTools|/auto|/onboard|/worldbook/chat|/revise-segment|/apply-revision|/write-draft|/finalize|/conversation\?mode=chat|agent/run|generateObject|generateText|streamText|doStream|withUsageRecording" packages docs -g "*.ts" -g "*.tsx" -g "*.md"
rg -n "conversation\?mode=chat|/auto|auto/cancel|/onboard|worldbook/chat|revise-segment|apply-revision|write-draft|finalize|tool_call_start|tool_call_end|chapter_write|chapter_audit|record_chapter_state|text_delta|acceptance_report|execution_step|workflow|done|committed|agent_phase|validation_report|startSseStream|fetch\(" packages/client/src packages/client/tests
rg -n "runConversation|runAutoMode|runNewBookConversation|runWorldbookChat|writeWithAudit|writeChapterSimple|auditChapter|repairChapter|recordChapterState|reviseSegment|chaptersRepo\.saveVersion|chapterFiles\.save|saveAudit|saveSummary|conversationsRepo\.append|generateText|streamText|doStream|doGenerate|parseSlashCommand|makeTriggerTools" packages/server/src packages/server/tools packages/server/tests packages/shared/src packages/shared/tests
```

### 总体结论

当前项目不是“一个新 agent 管线没完善”的问题，而是至少 9 条 AI/写入入口并存：

| 编号 | 入口 | 当前执行链路 | 是否统一到 agent/run | 风险 |
| --- | --- | --- | --- | --- |
| 1 | `POST /api/books/:bookId/agent/run` | `runAgentWorkflow` | 是，但只是骨架 | 不能真正写章、不能完整工具执行 |
| 2 | `POST /api/books/:bookId/conversation` | 已改为 `runAgentWorkflow` wrapper | 部分是 | 仍自己写聊天历史，agent runner 不负责统一历史 |
| 3 | `POST /api/books/:bookId/chapters/:no/write` | `writeWithAudit -> audit/repair -> recordChapterState` | 否 | 旧完整写作链仍可直接执行 |
| 4 | `POST /api/books/:bookId/chapters/:no/write-draft` | `writeChapterSimple` | 否 | 写完正文直接落库，不审查不记录 |
| 5 | `POST /api/books/:bookId/chapters/:no/finalize` | `auditChapter -> repairChapter -> recordChapterState` | 否 | 与 write-draft 形成第二套分步工作流 |
| 6 | `POST /api/books/:bookId/auto` | `runAutoMode -> writeWithAudit -> recordChapterState` | 否 | 自动写是独立状态机 |
| 7 | `POST /api/books/:bookId/onboard` | `runNewBookConversation` | 否 | 创书聊天独立 agent/tool 流 |
| 8 | `POST /api/books/:bookId/worldbook/chat` | `runWorldbookChat` | 否 | 世界书聊天独立 agent/tool 流 |
| 9 | `POST /api/books/:bookId/chapters/:no/revise-segment` | `reviseSegment` | 否 | 选区改写独立生成 |
| 10 | `POST /api/books/:bookId/chapters/:no/apply-revision` | `saveVersion + chapterFiles.save` | 否 | AI 改写确认后绕过 validator/staging |

因此用户看到“发什么都容易触发写正文”“工具调用没反应”“新旧流程混用”“半程失败也留下东西”，根源是多入口、多协议、多持久化边界同时存在。

---

## Task 0：先加全局护栏，防止继续新增旁路

### 0.1 服务端 AI 入口静态护栏

- 文件：`packages/server/tests/unit/http/ai-routes-guard.test.ts`
- 现状：已经开始检查 `conversation.ts` 和 `chapters.ts`，但 `chapters.ts` 当前会失败。
- 任务：
  - 扩展检查范围到 `chapters.ts`、`auto.ts`、`books.ts`、`worldbook.ts`、`revise.ts`。
  - 所有 AI mutation route 必须包含 `runAgentWorkflow`，不得直接包含旧 orchestrator 调用。
- 禁止命中：
  - `runConversation(`
  - `runAutoMode(`
  - `runNewBookConversation(`
  - `runWorldbookChat(`
  - `writeWithAudit(`
  - `writeChapterSimple(`
  - `auditChapter(`
  - `repairChapter(`
  - `recordChapterState(`
  - `reviseSegment(`
- 验收：
  ```powershell
  pnpm --filter @scribe/server exec vitest run tests/unit/http/ai-routes-guard.test.ts
  ```

### 0.2 前端 AI endpoint 静态护栏

- 文件：`packages/client/tests/components/ai-entrypoints-guard.test.ts`
- 现状：只检查 conversation/editor 的一部分。
- 任务：
  - 扫描 `packages/client/src` 中所有 `fetch`/`startSseStream`。
  - 明确允许的 AI SSE 入口只有 `/agent/run`。
  - 手动 CRUD 如 `/chapters/:no` PUT、`/worldbook` CRUD、`/meta` PUT 允许。
- 禁止前端 AI 入口：
  - `/conversation?mode=chat`
  - `/auto`
  - `/auto/cancel`
  - `/onboard`
  - `/worldbook/chat`
  - `/revise-segment`
  - `/apply-revision`
  - `/write-draft`
  - `/finalize`
- 当前仍命中：
  - `packages/client/src/pages/onboard.tsx`
  - `packages/client/src/components/editor/revise-preview.tsx`
  - `packages/client/src/api/client.ts` 的 onboard skip/status 属于非 AI 状态接口，可白名单。
  - `packages/client/tests/components/phase9.test.tsx` 仍期待 `/auto`，应重写或删除。
- 验收：
  ```powershell
  pnpm --filter @scribe/client exec vitest run tests/components/ai-entrypoints-guard.test.ts
  ```

### 0.3 AI 写入不得绕过 staging 护栏

- 新增或扩展：`packages/server/tests/unit/http/ai-routes-guard.test.ts` 或单独 `ai-staging-guard.test.ts`
- 任务：
  - 在 `packages/server/src/ai/orchestrator` 和 `packages/server/src/http/routes` 中检查直接写入。
  - AI 生成路径不得直接 `chaptersRepo.saveVersion`、`chapterFiles.save`、`saveAudit`、`saveSummary`、资产 repo create/update。
  - 白名单只允许：
    - 手动章节编辑：`chapters.ts` 的 `PUT /chapters/:no`
    - 版本恢复：`versions.ts`
    - 导入/手动 CRUD route
    - `workflow-staging.ts` 的 commit 函数
- 当前仍命中：
  - `write-chapter.ts`
  - `repair-chapter.ts`
  - `audit-persist.ts`
  - `write-with-audit.ts` 间接调用
  - `chapters.ts` AI route
  - `revise.ts` apply-revision
  - `auto.ts` record-state
- 验收：失败 run 不新增 chapter/version/audit/summary/character/outline/worldbook。

---

## Task 1：服务端入口逐个收口

### 1.1 `chapters.ts` 三条旧写作路由

- 文件：`packages/server/src/http/routes/chapters.ts`
- 旧入口：
  - `/api/books/:bookId/chapters/:no/write`
  - `/api/books/:bookId/chapters/:no/write-draft`
  - `/api/books/:bookId/chapters/:no/finalize`
- 当前旧依赖：
  - `writeChapterSimple`
  - `writeWithAudit`
  - `buildChapterWriteMessages`
  - `buildChapterAuditContext`
  - `enrichUserIntentWithOutline`
  - `recordChapterState`
  - `auditChapter`
  - `persistAuditResult`
  - `repairChapter`
  - `createHardFactQualityGate`
- 任务：
  1. `/write`、`/write-draft`、`/finalize` 改成兼容 wrapper 或直接 410。
  2. 如果做 wrapper，必须只调用 `runAgentWorkflow`，传：
     - `source: "editor"`
     - `target.chapterNo`
     - `target.mode` 或等价字段。当前 shared schema 没有 `mode`，需要先补 schema，不能靠拼中文 message。
  3. 删除 AI route 内对旧 orchestrator 的直接 import。
  4. 手动 `GET/PUT/DELETE /chapters` 保留 direct CRUD，明确注释为用户手动操作。
- 验收：
  ```powershell
  rg -n "writeWithAudit|writeChapterSimple|auditChapter|repairChapter|recordChapterState|persistAuditResult|createHardFactQualityGate" packages/server/src/http/routes/chapters.ts
  ```
  应无命中，除非注释里标明 deprecated 且不执行。

### 1.2 `auto.ts` 独立自动写作状态机

- 文件：`packages/server/src/http/routes/auto.ts`
- 旧入口：
  - `/api/books/:bookId/auto`
  - `/api/books/:bookId/auto/cancel`
- 当前旧依赖：
  - `runAutoMode`
  - `recordChapterState`
  - `buildBookPromptContext`
  - `buildChapterWriteMessages`
  - `buildChapterAuditContext`
  - `enrichUserIntentWithOutline`
- 问题：
  - 自动写不走 main-agent/executor/validator/staging。
  - `running Map<bookId, AbortController>` 与 agent run 状态分裂。
  - `/auto/cancel` 是旧取消机制，前端虽已改成 abort stream，但服务端旧入口仍存在。
- 任务：
  1. `/auto` 改为 `runAgentWorkflow` wrapper，`source:"auto"`，`target.chapterCount:n`。
  2. `runAutoMode` 暂时只能作为 executor 内部可测试 helper，且不得直接落库。
  3. `/auto/cancel` 下线或映射到 workflow run cancel，不再维护独立 `running`。
- 验收：
  ```powershell
  rg -n "runAutoMode|recordChapterState|buildChapterWriteMessages|buildChapterAuditContext" packages/server/src/http/routes/auto.ts
  ```
  应无命中。

### 1.3 `books.ts` 创书聊天

- 文件：`packages/server/src/http/routes/books.ts`
- 旧入口：
  - `/api/books/:bookId/onboard`
- 当前旧依赖：
  - `runNewBookConversation`
  - `formatCompletenessHint`
  - `ExecutionModeSchema` 独立透传
  - `conversationsRepo.append` 自己记录 onboard 对话
- 问题：
  - 创书聊天是一套独立 tool agent。
  - 会自己写角色/大纲/设定，绕过新 validator/staging。
  - conversation history 中 onboard/chat/worldbook 的写入策略不统一。
- 任务：
  1. `/onboard` 改为 `runAgentWorkflow`，`source:"onboard"`。
  2. onboard completeness 作为 agent context，不再由 route 拼成独立 prompt。
  3. `runNewBookConversation` 下线或迁入 executor-agent 的 onboard action。
  4. 聊天历史由统一 conversation persistence 记录，route 不再自己 append assistant buffer。
- 验收：
  ```powershell
  rg -n "runNewBookConversation|conversationsRepo\\.append" packages/server/src/http/routes/books.ts
  ```
  AI route 应无命中；非 AI 的 book CRUD 不受影响。

### 1.4 `worldbook.ts` 世界书聊天

- 文件：`packages/server/src/http/routes/worldbook.ts`
- 旧入口：
  - `/api/books/:bookId/worldbook/chat`
- 当前旧依赖：
  - `runWorldbookChat`
  - `conversationsRepo.append`
- 问题：
  - 世界书编辑本身可以是手动 CRUD，但 worldbook chat 是 AI mutation，不能绕过 agent。
  - 现在它自己 append user/assistant，导致聊天记录来源分裂。
- 任务：
  1. `/worldbook/chat` 改为 `runAgentWorkflow`，`source:"chat"` 或新增 `source:"worldbook"`。
  2. 若要保留世界书 AI 编辑能力，executor 输出 `worldbook_upsert` staged changes。
  3. 手动 `/worldbook` CRUD 和 `/worldbook/preview` 保留 direct route。
- 验收：
  ```powershell
  rg -n "runWorldbookChat|conversationsRepo\\.append" packages/server/src/http/routes/worldbook.ts
  ```
  应无命中。

### 1.5 `revise.ts` 选区改写

- 文件：`packages/server/src/http/routes/revise.ts`
- 旧入口：
  - `/api/books/:bookId/chapters/:no/revise-segment`
  - `/api/books/:bookId/chapters/:no/apply-revision`
- 当前旧依赖：
  - `reviseSegment`
  - `chaptersRepo.saveVersion`
  - `chapterFiles.save`
- 问题：
  - 生成候选是旧 SSE。
  - 接受候选后直接写库，不走 validator/read-back/staging。
- 任务：
  1. 改写请求走 `runAgentWorkflow`，`source:"revision"`，`target.revisionRange` 带 chapterNo/selectedText。
  2. 改写候选作为 hidden draft/staged change，不直接落库。
  3. 接受候选不再调用 `/apply-revision` 直接保存，而是 commit 指定 workflow run/change。
  4. 如果暂时保留 `/apply-revision`，只能作为 workflow commit wrapper，不能自己 replace/save。
- 验收：
  ```powershell
  rg -n "reviseSegment|chaptersRepo\\.saveVersion|chapterFiles\\.save" packages/server/src/http/routes/revise.ts
  ```
  AI route 应无命中。

### 1.6 `conversation.ts` 已包 agent，但历史写入仍未统一

- 文件：`packages/server/src/http/routes/conversation.ts`
- 现状：
  - POST 已调用 `runAgentWorkflow`。
  - GET history 保留。
  - route 仍自己 `conversationsRepo.append` user/assistant。
- 问题：
  - agent runner 无统一消息持久化契约。
  - `done.committed` 时写入固定文案 `(已通过统一 Agent 管线完成变更)`，可能丢失 main reply 和 validation report。
- 任务：
  1. 统一 conversation persistence：所有 `source` 的可见用户消息/assistant reply 都由同一层写。
  2. 主动审查 prompt 不进聊天，只记录“触发了主动审查”。
  3. 写正文 hidden draft 不进聊天正文。
- 验收：
  - 同一本书内聊天隔离。
  - 新书不会读旧书聊天。
  - 主动审查原 prompt 不进入 `/conversation` history。

---

## Task 2：agent/run 自身必须补齐，否则收口后只是空壳

### 2.1 `agent-runner.ts` 没有事务和错误终态

- 文件：`packages/server/src/ai/orchestrator/agent-runner.ts`
- 当前问题：
  - `runId = randomUUID()` 后调用 `staging.begin(runId, ...)`，但 repo `create()` 自己生成另一个 id，导致 staged changes 可能挂不到真实 run。
  - 没有 try/catch；main/executor/validator 任一异常会让 SSE 断掉，没有 workflow failed 状态。
  - commit 返回 `failed` 也没有阻止最终 `done committed:true`。
  - `executionMode` 只在 repairable 时判断，未使用 shared 的 `buildExecutionPolicy`。
  - `target` 传入 runner 但 main/executor 没用。
- 任务：
  1. 修正 workflow run id：repo `create` 接收 runId，或 `begin` 返回 repo id。
  2. 全流程 try/catch/finally，失败必须 yield `error` 和 `done committed:false`，并 setPhase failed。
  3. commit 有任何 failed change 时不得返回 committed true。
  4. 使用 `buildExecutionPolicy` 决定 trusted/low-risk/confirm/plan-only。
  5. 把 `source/target/executionMode` 传给 main-agent 和 executor-agent。
- 验收：
  - 模拟 executor 抛错：无 staged commit，workflow_runs.phase=failed。
  - 模拟 commit 文件失败：无 done committed true。

### 2.2 `main-agent.ts` 当前是保守 stub

- 文件：`packages/server/src/ai/orchestrator/main-agent.ts`
- 当前状态：
  - 已去掉正则自动写，避免误触发。
  - 但现在不会真正判断写作/改写/审查/创书意图。
- 任务：
  1. 用模型结构化输出 TaskContract，不准正则决定写作。
  2. TaskContract 至少包含：
     - `taskType`
     - `source`
     - `target`
     - `userInstruction`
     - `mustDo`
     - `mustNotDo`
     - `acceptanceCriteria`
     - `hiddenDraftPolicy`
     - `riskLevel`
     - `requiresUserConfirmation`
  3. 对“第一人称”“第二章视角错了”“讨论第 3 章大纲”这类话，必须能区分讨论、修正设定、写章。
- 验收：
  - 单测覆盖 chat/query/write/revise/asset_audit/onboard/auto。
  - `rg -n "match\\(|includes\\(|/写第|第.*章" main-agent.ts` 不得出现业务触发正则。

### 2.3 `executor-agent.ts` 不能执行真实任务

- 文件：`packages/server/src/ai/orchestrator/executor-agent.ts`
- 当前状态：
  - `query_only` 返回空。
  - 只会根据 `affectedEntities` 做 `character_upsert`。
  - 不会写章节、不会改大纲、不会创书、不会修世界书、不会选区改写。
- 任务：
  1. 按 TaskContract 输出 staged changes。
  2. 写章输出 `chapter_version`，但正文生成只返回 payload，不直接保存。
  3. 创书输出 book_meta/outline/character/worldbook/record staged changes。
  4. 主动审查输出 audit report 或 repair staged changes。
  5. 资产变更必须先 list/read 现有资产并去重，禁止重复创建同名角色。
- 验收：
  - “整理角色，删除重复”不会重复创建角色。
  - “写 5 章”会产生多个 staged chapter changes 或明确 plan/confirm。

### 2.4 `validator-agent.ts` 只有长度检查

- 文件：`packages/server/src/ai/orchestrator/validator-agent.ts`
- 当前状态：
  - 只检查 chapter content 少于 100 字。
- 任务：
  1. 回归 main-agent acceptanceCriteria。
  2. 整合 `auditChapter` 和 hard fact gate。
  3. 验证 staged changes 是否真的满足用户要求。
  4. 验证资产去重、章节编号、文风、视角、章尾禁用“待续式总结”。
  5. 输出 userCriteria/processCriteria/domainCriteria，而不是单层 issues。
- 验收：
  - 第一章要求第一人称，第二章变第三人称时必须 fail/repairable。
  - 章尾出现“未完待续/新的篇章/故事才刚刚开始”等必须 fail/repairable。

### 2.5 `repair-agent.ts` 不修正文内容

- 文件：`packages/server/src/ai/orchestrator/repair-agent.ts`
- 当前状态：
  - 只改 plan summary，不改 staged payload。
- 任务：
  1. 只处理 validator 标记 `suggestedAction:"repair"` 的 staged changes。
  2. 对 chapter_version 重新生成或局部修正文内容。
  3. 不扩大修改范围，不引入新章节/新角色，除非 validator 明确要求。
- 验收：
  - repair 后 staged chapter content 实际变化。
  - repair 后必须重新 validate。

### 2.6 `workflow-staging.ts` commit 错误

- 文件：`packages/server/src/ai/orchestrator/workflow-staging.ts`
- 当前问题：
  - `begin(runId)` 丢弃 runId，repo 自己生成 id。
  - `chapter_version` 只 `chapterFiles.save(... versionNo:1)`，不写 `chaptersRepo.saveVersion`。
  - 文件失败没有版本回滚。
  - commit 后没有设置 run phase/verdict completed。
  - `chapter_audit` 类型定义了但 `applyChange` 没实现。
- 任务：
  1. repo create 支持指定 runId 或 begin 返回真实 run。
  2. `chapter_version` 必须先 `chaptersRepo.saveVersion`，再 `chapterFiles.save`，文件失败则 `deleteVersion`。
  3. 实现 `chapter_audit` commit。
  4. commit 全部成功后 setPhase completed/pass。
  5. commit 部分失败不得留下“看似成功”的 done。
- 验收：
  - workflow-staging 单测覆盖 DB+文件一致性。
  - 文件保存抛错时 DB version 被回滚。

---

## Task 3：旧 orchestrator 的处理策略

### 3.1 `conversation-orchestrator.ts`

- 文件：`packages/server/src/ai/orchestrator/conversation-orchestrator.ts`
- 当前残留：
  - `parseSlashCommand`
  - `makeTriggerTools`
  - `writeWithAudit`
  - `auditChapter`
  - `recordChapterState`
  - 内部 `runConversation`
- 任务：
  1. 不再作为 HTTP mutation orchestrator。
  2. 如果保留，只能做只读问答 helper，且不得包含 trigger tools。
  3. 旧测试迁移到 agent-runner 或删除。
- 验收：
  ```powershell
  rg -n "runConversation\\(" packages/server/src/http packages/server/src/ai/orchestrator
  ```
  不得在生产 route 命中。

### 3.2 `book-tools.ts` trigger tools

- 文件：`packages/server/src/ai/tools/book-tools.ts`
- 当前残留：
  - `makeTriggerTools`
  - `write_next_chapter`
  - `rewrite_chapter`
  - `delete_chapters`
  - `audit_chapter`
- 问题：
  - 普通聊天模型一旦 tool-call 这些 trigger，旧 conversation orchestrator 会 break stream 执行写作。
  - 这是“发什么都可能写正文”的核心历史原因之一。
- 任务：
  1. trigger tools 从普通聊天 tool registry 移除。
  2. 写作/删除/审查只能是 main-agent TaskContract，再由 executor 执行。
  3. delete 类高风险必须走 execution policy confirm。
- 验收：
  ```powershell
  rg -n "makeTriggerTools|write_next_chapter|rewrite_chapter" packages/server/src
  ```
  不得被生产路径调用。

### 3.3 `write-chapter.ts`、`repair-chapter.ts`、`write-with-audit.ts`

- 文件：
  - `packages/server/src/ai/orchestrator/write-chapter.ts`
  - `packages/server/src/ai/orchestrator/repair-chapter.ts`
  - `packages/server/src/ai/orchestrator/write-with-audit.ts`
- 当前问题：
  - `writeChapterSimple` 直接 `saveVersion + chapterFiles.save`。
  - `repairChapter` 直接 `saveVersion + chapterFiles.save`。
  - `writeWithAudit` 组合直接落库和审查持久化。
- 任务：
  1. 拆成 pure generation helper：只返回正文/审查结果，不落库。
  2. 落库只能由 workflow-staging commit 执行。
  3. 老函数要么废弃，要么标注 `@deprecated` 且不被 route 直接调用。
- 验收：
  ```powershell
  rg -n "chaptersRepo\\.saveVersion|chapterFiles\\.save" packages/server/src/ai/orchestrator/write-chapter.ts packages/server/src/ai/orchestrator/repair-chapter.ts packages/server/src/ai/orchestrator/write-with-audit.ts
  ```
  应无命中，或只存在测试/迁移注释。

### 3.4 `record-state.ts`

- 文件：`packages/server/src/ai/orchestrator/record-state.ts`
- 当前问题：
  - 角色/伏笔/时间线/通用记录通过工具直接写 repo。
  - 工具调用失败可能留下半套资产。
  - 重复角色问题很可能来自这里或 onboard/worldbook tool 链没有去重。
- 任务：
  1. record-state 改为生成 staged asset changes。
  2. commit 阶段统一去重：角色按规范化 name 唯一，必要时 merge。
  3. 每个资产变更带 evidence/source chapter。
- 验收：
  - 写章失败时不新增角色/伏笔/时间线。
  - 同名角色不会重复创建三次。

### 3.5 `new-book.ts`、`worldbook-chat.ts`、`revise-segment.ts`、`auto-mode.ts`

- 文件：
  - `packages/server/src/ai/orchestrator/new-book.ts`
  - `packages/server/src/ai/orchestrator/worldbook-chat.ts`
  - `packages/server/src/ai/orchestrator/revise-segment.ts`
  - `packages/server/src/ai/orchestrator/auto-mode.ts`
- 任务：
  1. 都不能再被 HTTP route 直接调用。
  2. 可迁成 executor 内部 helper，但 helper 只能返回 staged changes 或 text draft。
  3. 原集成测试迁移到 `/agent/run` 场景。
- 验收：
  ```powershell
  rg -n "runNewBookConversation|runWorldbookChat|reviseSegment|runAutoMode" packages/server/src/http packages/server/src/ai/orchestrator/agent-runner.ts packages/server/src/ai/orchestrator/executor-agent.ts
  ```
  只允许 executor/helper 内部有受控调用。

---

## Task 4：前端 UI/SSE 协议收口

### 4.1 `conversation-pane.tsx` 仍混用旧事件协议

- 文件：`packages/client/src/components/conversation/conversation-pane.tsx`
- 当前残留：
  - `WRITING_TOOLS = chapter_write/chapter_audit/record_chapter_state/...`
  - `tool_call_start/tool_call_end`
  - `intent`
  - `auto_status`
  - `execution_plan/execution_step/acceptance_report`
  - `done` 一到就刷新章节并提示完成。
- 问题：
  - UI 同时认旧 tool 流、中间 workflow 流、新 agent 流。
  - `done` 没检查 `committed`，失败或等待用户也可能被当成功。
- 任务：
  1. UI 只认新事件：
     - `agent_phase`
     - `main_output`
     - `execution_plan`
     - `validation_report`
     - `repair_plan`
     - `done`
     - `error`
  2. 旧 `tool_call_*` 只能作为兼容展示，不得驱动“写作完成/刷新章节”。
  3. 只有 `done.committed === true` 才 `triggerChapterRefresh()`。
  4. `done.needsUserDecision === true` 显示确认/修复/重 roll 弹窗。
  5. 主动审查按钮发送结构化 `{ source:"asset_audit", target.scope }`，不要把大 prompt 当普通 message。
- 验收：
  - 模拟 `done { committed:false }` 不刷新章节。
  - 模拟 SSE error 不固化为成功消息。

### 4.2 `streaming-message.tsx` 和 `message.tsx` 仍用旧工具判断隐藏正文

- 文件：
  - `packages/client/src/components/conversation/streaming-message.tsx`
  - `packages/client/src/components/conversation/message.tsx`
- 当前残留：
  - `WRITING_TOOLS`
  - `chapter_write/chapter_audit/record_chapter_state`
- 任务：
  1. 隐藏正文依据新字段，例如 `main_output.draft` 或 `execution_plan` 中的 hidden draft 标记。
  2. 旧 tool 名不再决定 UI 状态。
- 验收：
  ```powershell
  rg -n "chapter_write|chapter_audit|record_chapter_state|WRITING_TOOLS" packages/client/src/components/conversation
  ```
  不应作为流程驱动存在。

### 4.3 `onboard.tsx` 仍是独立创书页面工作流

- 文件：`packages/client/src/pages/onboard.tsx`
- 当前残留：
  - `startSseStream({ url: /onboard })`
  - `tool_call_start/tool_call_end`
  - `execution_step`
  - `acceptance_report`
- 任务：
  1. 改为 `/agent/run`，`source:"onboard"`。
  2. 复用 conversation 的 AgentProgress/Validation UI。
  3. 不再自己维护 tool chip/acceptance report 协议。
- 验收：
  ```powershell
  rg -n "/onboard|tool_call_start|tool_call_end|acceptance_report" packages/client/src/pages/onboard.tsx
  ```
  `/onboard-status` 和 `/onboard/skip` 可白名单，AI SSE 不可命中。

### 4.4 `revise-preview.tsx` 仍走旧改写接口

- 文件：`packages/client/src/components/editor/revise-preview.tsx`
- 当前残留：
  - `/revise-segment`
  - `/apply-revision`
  - `text_delta/done` 生成候选
- 任务：
  1. 改为 `/agent/run`，`source:"revision"`。
  2. 接受候选改为 commit staged change，而不是 POST `/apply-revision`。
  3. ready 状态取决于 `validation_report`，不是仅 `done`。
- 验收：
  ```powershell
  rg -n "revise-segment|apply-revision" packages/client/src/components/editor/revise-preview.tsx
  ```
  应无命中。

### 4.5 `editor-pane.tsx` 已改 endpoint，但仍用裸 reader 等流结束

- 文件：`packages/client/src/components/editor/editor-pane.tsx`
- 当前状态：
  - `/write-draft`、`/finalize` 已改为 `/agent/run`。
  - 但手动读取 stream 只等 reader done，没有解析 SSE `done.committed`。
  - `target.mode` 被发送，但 shared `AgentRunRequestSchema.target` 当前没有 `mode`，服务端 parse 会丢掉或拒绝。
- 任务：
  1. editor 也用 `startSseStream` 解析 agent events。
  2. 只有 committed true 才 reload chapter/list。
  3. shared schema 补 `target.mode`，不要靠 message 文本“写第 N 章/确认第 N 章”。
- 验收：
  - schema typecheck 通过。
  - `done committed:false` 不刷新。

### 4.6 旧 `/auto` 测试仍在

- 文件：`packages/client/tests/components/phase9.test.tsx`
- 当前残留：
  - 测试期待 `/auto`。
  - 测试期待 `/auto/cancel`。
  - 测试期待 `auto_status`。
- 任务：
  1. 改成 agent auto source 的测试。
  2. 自动写进度用 agent events 表示，不再用 `auto_status`。
- 验收：
  ```powershell
  rg -n "/auto|auto_status|auto/cancel" packages/client/tests packages/client/src
  ```
  只允许文档或迁移测试白名单。

---

## Task 5：上下文和长篇连续性

### 5.1 两套 context builder 并存

- 文件：
  - `packages/server/src/ai/context-builder/book-context.ts`
  - `packages/server/src/ai/context-builder/builder.ts`
  - `packages/server/src/ai/context-builder/snapshot.ts`
- 当前问题：
  - `book-context.ts` 被 `chapters.ts/auto.ts/conversation-orchestrator.ts` 旧链路使用。
  - `builder.ts/snapshot.ts` 是另一套上下文抽象。
  - snapshot 支持更多章节，但实际 builder 中曾出现只取近 3 章的问题。
- 任务：
  1. 定义唯一写作上下文构建器。
  2. 所有 write/revise/audit/repair/auto/onboard 都从同一 builder 取上下文。
  3. 对 1M 上下文模型按预算加载：
     - 近 10 章全文。
     - 前 20-10 章每章小结。
     - 20 章以前卷/弧/全书总结。
     - 当前章大纲、角色、世界书、硬事实、文风参考。
- 验收：
  - 写第 N 章时 prompt metadata 可显示 `recentFullChapters <= 10`。
  - 第二章不会丢第一章视角/文风要求。

### 5.2 大纲注入必须精确到章

- 文件：`packages/server/src/ai/context-builder/book-context.ts`
- 当前问题：
  - `enrichUserIntentWithOutline` 按章号/标题逻辑拼 userIntent。
  - 大纲节点没有稳定 chapterNo metadata 时容易漏。
- 任务：
  1. outline chapter node 必须有 `metadata.chapterNo`。
  2. 写作目标 chapterNo 直接查对应 outline node。
  3. 不再靠标题正则猜“第 N 章”。
- 验收：
  - 标题不含“第 N 章”也能注入本章大纲。

---

## Task 6：聊天记录和资产持久化

### 6.1 聊天记录必须绑定 bookId 且统一 source

- 文件：
  - `packages/server/src/http/routes/conversation.ts`
  - `packages/server/src/http/routes/books.ts`
  - `packages/server/src/http/routes/worldbook.ts`
  - `packages/server/src/http/routes/sidebar.ts`
- 当前问题：
  - 多个 route 都在 `conversationsRepo.append`。
  - onboard/worldbook/sidebar 可能写入不同 metadata kind。
  - 用户之前遇到新书调用旧聊天记录，必须持续回归。
- 任务：
  1. 所有聊天历史读写经过统一 service。
  2. service 必须使用当前 book handle 的 workspace DB。
  3. source/kind 统一枚举，不允许任意字符串。
  4. agent hidden prompt 不落 history。
- 验收：
  - A 书聊天不会出现在 B 书。
  - 主动审查只存“触发主动审查”，不存完整 prompt。

### 6.2 资产去重和重复角色治理

- 文件：
  - `record-state.ts`
  - `state-tools.ts`
  - `book-meta-tools.ts`
  - `genre-section-tools.ts`
  - `executor-agent.ts`
- 当前问题：
  - 用户已遇到宋玉/小佑重复创建三次。
  - 工具链可能 list 后仍 create，而不是 update/merge。
- 任务：
  1. 角色按 normalized name 唯一。
  2. create 前必须查重，存在则 update/merge。
  3. delete/update 工具返回必须清楚，失败要进入 validation report。
  4. executor 产生 staged asset changes 前先读取现有资产。
- 验收：
  - 同一轮多次“整理角色”不会新增重复。
  - 工具调用失败不会回复“已整理完毕”。

---

## Task 7：模型调用量和超时治理

### 7.1 所有 LLM 调用必须进入 usage recording

- 文件：
  - `packages/server/src/ai/llm-call.ts`
  - `packages/server/src/ai/usage-tracker.ts`
  - 所有直接 `generateText/doGenerate/doStream` 的 orchestrator
- 当前问题：
  - 部分 route 外层 `withUsageRecording`，但内部多次审查/record/onboard tool 调用是否完整计费不统一。
  - `main-agent` 后续接模型后也要记录。
- 任务：
  1. 禁止业务代码直接调用 Vercel AI SDK，统一通过 `llm-call.ts` wrapper。
  2. 每次 LLM 调用带 `taskType/source/runId/chapterNo/modelRole`。
  3. UI usage detail 能按 run 展示 main/executor/validator/repair/record-state。
- 验收：
  ```powershell
  rg -n "generateText\\(|streamText\\(|doGenerate\\(|doStream\\(" packages/server/src
  ```
  除 `llm-call.ts` 和 provider/test adapter 外不得直接业务调用。

### 7.2 超时和半程失败

- 文件：
  - `llm-call.ts`
  - `agent-runner.ts`
  - `streamSseResponse`
- 当前问题：
  - 用户日志中发现没超时处理，没跑完全程也记录一半。
- 任务：
  1. 每个 agent phase 有超时。
  2. abort/timeout 只标 run failed/cancelled，不 commit staged changes。
  3. 已生成但未验证正文只保存在 staged/draft，不作为正式章节。
- 验收：
  - 模拟 timeout：无 chapter/version/asset 持久化。
  - UI 显示失败而不是完成。

---

## Task 8：共享 schema 和事件协议

### 8.1 `AgentRunRequestSchema.target` 不够用

- 文件：`packages/shared/src/types/agent-workflow.ts`
- 当前问题：
  - source 有 `chat/editor/auto/onboard/revision/asset_audit`。
  - target 只有 `chapterNo/chapterCount/revisionRange`。
  - 前端 editor 发送 `target.mode`，schema 当前没有。
  - 主动审查需要 scope，schema 当前没有。
- 任务：
  1. 增加 discriminated target：
     - editor: `chapterNo`, `mode: write|rewrite|finalize`
     - auto: `chapterCount`
     - revision: `chapterNo`, `selectedText`, `instruction`
     - asset_audit: `scope`, `assetTypes`
     - onboard: optional stage
  2. 服务端严格 parse，不能靠 message 文本猜。
- 验收：
  - 前后端 typecheck。
  - “模型让我选择/保存设置”等普通 chat 不会因为文本包含“写”触发写章。

### 8.2 SSE 事件协议收口

- 文件：
  - `packages/shared/src/types/agent-workflow.ts`
  - client conversation store/components
  - server agent-runner
- 当前问题：
  - 旧：`text_delta/tool_call_start/tool_call_end/auto_status`
  - 中：`execution_step/acceptance_report`
  - 新：`agent_phase/main_output/validation_report/done`
  - 三套同时存在。
- 任务：
  1. 定义唯一 AgentSseEvent union。
  2. 旧事件只在 legacy wrapper 临时转换，不暴露给 UI。
  3. `done` 必须包含：
     - `committed`
     - `runId`
     - `needsUserDecision`
     - `failed`
     - `summary`
- 验收：
  - 前端 switch 不再处理 `auto_status/intent` 作为主流程。

---

## Task 9：测试迁移清单

### 9.1 需要重写的旧流程测试

- `packages/client/tests/components/phase9.test.tsx`
  - 从 `/auto` 改为 `/agent/run source:auto`。
- `packages/client/tests/pages/onboard.test.tsx`
  - 从 `/onboard` 改为 `/agent/run source:onboard`。
- `packages/client/tests/components/selection-revise.test.tsx`
  - 从 `/revise-segment/apply-revision` 改为 revision workflow。
- `packages/server/tests/integration/auto-mode.test.ts`
  - 保留为 helper 单测或迁到 agent auto integration。
- `packages/server/tests/integration/new-book-flow.test.ts`
  - 迁到 agent onboard integration。
- `packages/server/tests/integration/revise-routes.test.ts`
  - 迁到 agent revision integration。
- `packages/server/tests/integration/chapter-roundtrip.test.ts`
  - `/write/write-draft/finalize` 迁到 `/agent/run source:editor`。
- `packages/server/tests/unit/ai/orchestrator/conversation-orchestrator.test.ts`
  - 删除 slash command mutation 预期，迁到 main-agent/executor 测试。

### 9.2 可以保留但要降级为 helper 测试

- `write-chapter-simple.test.ts`
- `write-then-audit.test.ts`
- `record-state.test.ts`
- `repair-chapter.test.ts`
- `audit-chapter.test.ts`

条件：这些模块必须先改成不直接落库，或测试明确标注 legacy helper，不被 HTTP route 调用。

---

## Task A：入口收口

### A1. 统一服务端 AI 路由注册策略

- 位置：`packages/server/src/http/server.ts:111-141`
- 现状：`conversationRoutes`、`chapterRoutes`、`bookRoutes/onboard`、`reviseRoutes`、`worldbookRoutes`、`agentRoutes`、`autoRoutes` 同时注册，且都能触发 AI。
- 问题：`agentRoutes` 没有成为唯一入口，旧入口仍可独立执行。
- 任务：定义唯一 AI mutation 入口 `POST /api/books/:bookId/agent/run`。其它 AI 路由只能作为 wrapper 或下线。
- 验收：除手动 CRUD/export/import/snapshot/settings 外，所有 AI 生成、写作、改写、审查、自动写、创书对话、worldbook chat 都能追踪到 `runAgentWorkflow`。

### A2. `/conversation` 改成 agent wrapper

- 位置：`packages/server/src/http/routes/conversation.ts:36-112`
- 现状：`POST /conversation?mode=chat` 直接调用 `runConversation`。
- 旁路写入：`conversationsRepo.append` 在 `conversation.ts:89/103/106` 自己记录聊天。
- 问题：对话链路绕过 `/agent/run` 和 staging。
- 任务：`POST /conversation` 内部转发 `source:"chat"` 到 `runAgentWorkflow`，或前端直接改打 `/agent/run` 后保留 GET history。
- 验收：`rg "runConversation\(" packages/server/src/http/routes` 无结果；`POST /conversation` 不再直接执行 AI。

### A3. `/chapters/:no/write`、`/write-draft`、`/finalize` 收口

- 位置：`packages/server/src/http/routes/chapters.ts:45`、`:189`、`:233`
- 现状：
  - `/write` 调 `writeWithAudit` + `recordChapterState`。
  - `/write-draft` 调 `writeChapterSimple`。
  - `/finalize` 调 `auditChapter` + `repairChapter` + `recordChapterState`。
- 问题：同一“写一章”能力存在三条服务端执行路径。
- 任务：只保留 agent 语义：`source:"editor"`，`target.chapterNo`，`mode: write/rewrite/finalize`。旧路由 wrapper 或 410。
- 验收：前端不再请求 `write-draft/finalize`；服务端旧路由不直接 import `writeWithAudit/writeChapterSimple/auditChapter/repairChapter/recordChapterState`。

### A4. `/auto` 收口

- 位置：`packages/server/src/http/routes/auto.ts:42`、`packages/server/src/ai/orchestrator/auto-mode.ts:54`
- 现状：`/auto` 独立运行 `runAutoMode`，内部逐章 `writeWithAudit`，再 `recordChapterState`。
- 问题：自动写是完全独立状态机，不走 agent 策略、验证、staging。
- 任务：改成 `source:"auto"` 的 agent run，多章计划由 main/executor 输出，取消旧 `runAutoMode` 直接写盘。
- 验收：UI 不再特殊分流 `/auto`；`auto-mode.ts` 要么废弃，要么只作为 executor 内部可测试模块且不直接落盘。

### A5. `/onboard` 收口

- 位置：`packages/server/src/http/routes/books.ts:140-219`、`packages/server/src/ai/orchestrator/new-book.ts:30`
- 现状：创书对话独立调用 `runNewBookConversation`，自己构建 tool registry、workflow step、acceptance report。
- 问题：创书聊天和普通聊天是两套 agent。
- 任务：迁移到 `source:"onboard"` 的 agent run。onboard completeness 作为 main-agent/context 输入，不再独立编排。
- 验收：`runNewBookConversation` 不再被 HTTP route 直接调用。

### A6. `/worldbook/chat` 收口

- 位置：`packages/server/src/http/routes/worldbook.ts:97-145`、`packages/server/src/ai/orchestrator/worldbook-chat.ts:19`
- 现状：worldbook chat 独立 `runWorldbookChat`，自己 append conversation。
- 问题：第四套 AI 对话，绕过主 agent 和统一历史策略。
- 任务：改成 `source:"worldbook"` 或 `source:"chat" + target.worldbook` 的 agent run；世界书增改走 executor staging。
- 验收：`runWorldbookChat` 不再被 HTTP route 直接调用，聊天记录只由统一持久化层写。

### A7. `/revise-segment` 和 `/apply-revision` 收口

- 位置：`packages/server/src/http/routes/revise.ts:19`、`:55`
- 现状：`revise-segment` 只生成候选，`apply-revision` 直接 `saveVersion` + `chapterFiles.save`。
- 问题：改写流程绕开 agent validator/staging。
- 任务：改成 `source:"revision"`，选区、instruction、chapterNo 作为 target/input；候选作为 staged change，用户确认后统一 commit。
- 验收：AI 改写不直接调用 `chaptersRepo.saveVersion`。

---

## Task B：意图触发收口

### B1. 删除主流程里的正则写作触发

- 位置：`packages/server/src/ai/orchestrator/main-agent.ts:19`、`:32`
- 现状：新 main-agent 用正则识别“写第 N 章”“创建角色”。
- 问题：用户要求“不要正则触发，只能 AI 自己调用/判断”。
- 任务：main-agent 改为 LLM 结构化输出 `TaskContract`，正则只能保留在非 AI 的格式校验或标题解析场景。
- 验收：`main-agent.ts` 不包含用户意图正则；测试覆盖“我想讨论第一人称”不得触发写章。

### B2. 清理 slash command 直连旧路由

- 位置：`packages/client/src/components/conversation/conversation-pane.tsx:262-269`、`packages/shared/src/slash-commands.ts:4`
- 现状：前端 `parseSlashCommand` 发现 `/auto` 就直接请求 `/auto`。
- 问题：绕过 agent；命令成为隐藏分流。
- 任务：slash command 只转换成普通 agent message 或快捷填充输入，不直接选旧 endpoint。
- 验收：`conversation-pane.tsx` 不再根据 `/auto` 切 URL。

### B3. 清理 conversation-orchestrator 内旧意图分类

- 位置：`packages/server/src/ai/orchestrator/conversation-orchestrator.ts:782`、`packages/server/src/ai/orchestrator/intent.ts:96`
- 现状：`runConversation` 内还有 `parseSlashCommand` + `analyzeIntent`。
- 问题：中间流程继续和新 main-agent 抢职责。
- 任务：`conversation-orchestrator` 不再作为 mutation orchestrator；若保留，只做只读问答或废弃。
- 验收：写作/改写/审查类 intent 只由新 main-agent 产出。

### B4. 收掉 trigger tools 的重流程触发

- 位置：`packages/server/src/ai/tools/book-tools.ts:15`、`:167-214`、`conversation-orchestrator.ts:317`、`:364-367`
- 现状：LLM 调 `write_next_chapter/rewrite_chapter/delete_chapters/audit_chapter` 后，conversation-orchestrator break stream 并执行旧重流程。
- 问题：这是“发什么都容易写正文”的核心来源之一。
- 任务：这些 trigger tool 要么移入 executor-agent 的受控 action schema，要么删除。
- 验收：普通聊天 LLM 不再能通过 tool_call_end `__action` 直接启动写作。

---

## Task C：agent/run 补完

### C1. 完成 main-agent

- 位置：`packages/server/src/ai/orchestrator/main-agent.ts:13-52`
- 现状：regex mock，未真正调用模型。
- 任务：输出结构化 `TaskContract`：taskType、target、mustDo、mustNotDo、risk、requiresUserConfirmation、visibleReply、hiddenDraftPolicy。
- 验收：无正则；有单测覆盖 chat/query/write/revise/asset_update/auto/onboard。

### C2. 完成 executor-agent

- 位置：`packages/server/src/ai/orchestrator/executor-agent.ts:26-53`
- 现状：只做角色 upsert，不会写章、不改大纲、不审查、不修复。
- 任务：把 taskContract 转为 staged changes；写正文时生成内容但先 stage，不直接落库。
- 验收：写章任务产出 `chapter_version`、`chapter_summary`、必要 asset changes；query_only 产出空 changes。

### C3. 完成 validator-agent

- 位置：`packages/server/src/ai/orchestrator/validator-agent.ts:15-43`
- 现状：只检查 staged chapter 长度 <100。
- 任务：整合 `auditChapter`、hard fact gate、用户意图标准、读回验证、资产一致性检查。
- 验收：ValidationReport 至少包含 userCriteria/processCriteria/domainCriteria；失败不得 commit。

### C4. 完成 repair-agent

- 位置：`packages/server/src/ai/orchestrator/repair-agent.ts:9-28`
- 现状：只改 plan summary，不改 staged content。
- 任务：只修 validator 标记 `suggestedAction:"repair"` 的 staged changes，不能扩大修改范围。
- 验收：repair 后 staged chapter content 实际变化；reroll/ask_user 不进入 repair。

### C5. 修正 workflow-staging commit

- 位置：`packages/server/src/ai/orchestrator/workflow-staging.ts:47-68`、`:95-102`
- 现状：`chapter_version` 只 `chapterFiles.save(... versionNo:1)`，不写 `chaptersRepo.saveVersion`。
- 问题：文件和版本库不一致。
- 任务：commit `chapter_version` 必须先 `chaptersRepo.saveVersion`，再 `chapterFiles.save`，失败要回滚版本记录。
- 验收：workflow-staging 单测覆盖 chapter_version DB+文件一致、文件失败回滚 DB。

### C6. 修正 workflow run id

- 位置：`workflow-staging.ts:36-40` 与 `agent-runner.ts:22-23`
- 现状：`agent-runner` 生成 runId，但 `runsRepo.create(opts.bookId, opts.source)` 是否使用该 runId 需核对；`add(runId)` 依赖传入 runId。
- 风险：如果 repo 自己生成 id，后续 add/listChanges 找不到 run。
- 任务：确认并统一 run id 生成权；要么 `begin` 返回 repo id，要么 repo create 接收 runId。
- 验收：集成测试 `/agent/run` 能 add changes 并 commit 到同一 run。

---

## Task D：持久化和事务边界

### D1. AI 写章节不得直接落库

- 位置：`write-chapter.ts:104-109`、`repair-chapter.ts:96-101`
- 现状：生成正文和修复正文直接保存版本和 markdown。
- 问题：validator 之前已持久化，失败也会留下半成品。
- 任务：拆出“生成内容”与“commit 内容”。AI 生成只返回 staged payload。
- 验收：agent 写章失败时 `chapter_versions` 和 `chapters/*.md` 不新增。

### D2. 审查摘要不得在最终失败时落库

- 位置：`audit-persist.ts:87`、`:103`、`write-with-audit.ts:132-176`
- 现状：旧流程审查后立即 `saveAudit/saveSummary`。
- 问题：正文后续 repair/record 失败时，summary 可能污染后续上下文。
- 任务：audit/summary 作为 staged changes，最终 commit 后再写。
- 验收：失败 run 不新增 chapter_audits/chapter_summaries。

### D3. record-state 改为 staged writes

- 位置：`record-state.ts:215` 及其工具调用链
- 现状：角色、伏笔、时间线、通用记录直接被工具写入。
- 问题：记录状态失败/半失败会造成角色重复、资产污染。
- 任务：record-state 工具改成产生 staged asset changes；commit 阶段统一去重和写入。
- 验收：写章失败时不创建角色/伏笔/时间线；重复角色有唯一键或归并策略。

### D4. 手动 CRUD 与 AI 写入边界标注

- 位置：`sidebar.ts`、`chapters.ts:427`、`versions.ts:21`、`revise.ts:55`
- 现状：手动编辑和 AI 应用改写都直接写库。
- 任务：明确允许直接写的只有用户手动 CRUD、导入、恢复版本；AI 生成结果必须走 staging。
- 验收：代码注释和测试区分 manual direct write 与 AI-mediated write。

---

## Task E：前端 UI/SSE 收口

### E1. conversation-pane 只打 agent/run

- 位置：`packages/client/src/components/conversation/conversation-pane.tsx:200`、`:262-269`
- 现状：默认 `/conversation?mode=chat`，`/auto` 特殊分流。
- 任务：统一 URL 为 `/api/books/:bookId/agent/run`，source 根据场景传入。
- 验收：`rg "conversation\?mode=chat|/auto" packages/client/src/components/conversation` 无直接请求。

### E2. 删除旧 WRITING_TOOLS 驱动

- 位置：`conversation-pane.tsx:15-40`、`streaming-message.tsx:24`、`message.tsx:23`
- 现状：UI 通过 `chapter_write/chapter_audit/record_chapter_state` 推断写作流程。
- 问题：旧 tool 名和新 agent phase 混用。
- 任务：UI 只认 `agent_phase/execution_plan/execution_step/validation_report/done`。
- 验收：旧 tool label 不再决定是否隐藏正文/显示进度。

### E3. 成功标准改为 committed/read-back

- 位置：`conversation-pane.tsx:384-391`、`editor-pane.tsx:131-139`、`:168-173`
- 现状：收到 `done` 或流结束就 finish/toast 成功。
- 任务：只有 `done.committed === true` 且 read-back 验证通过才刷新章节并提示完成。
- 验收：模拟 SSE error 后 UI 不显示成功；模拟 `done.committed:false` 显示待用户决策。

### E4. editor-pane 不再使用 write-draft/finalize

- 位置：`editor-pane.tsx:119`、`:160`
- 现状：编辑器自己打旧分步写作接口。
- 任务：按钮发起 agent run，正文隐藏，验证报告弹窗展示，用户确认后 commit 或 repair。
- 验收：`rg "write-draft|finalize" packages/client/src/components/editor` 无直接 fetch。

### E5. onboard UI 复用统一工作流组件

- 位置：`pages/onboard.tsx:58-86`、`:195-198`
- 现状：onboard 页面自己消费 tool_call 和 acceptance_report。
- 任务：改用同一个 AgentProgress/ValidationDialog 组件。
- 验收：onboard 不再有独立 workflowSteps 解析逻辑。

### E6. 主动审查按钮走 agent source

- 位置：`conversation-pane.tsx:43-60`、主动审查 prompt 构造处
- 现状：前端构造大段主动审查请求，再发普通 conversation。
- 问题：prompt 容易进入聊天历史或被旧意图误判。
- 任务：主动审查传 `{ source:"asset_audit", target.scope }`，聊天只展示“触发了主动审查”。
- 验收：conversation history 不保存审查 prompt 原文。

---

## Task F：上下文和连续性

### F1. 写作上下文统一使用 1M 策略

- 位置：`snapshot.ts:53-54`、`builder.ts:371-372`
- 现状：snapshot 支持最近 10 章全文，但 builder 实际 `slice(-3)`。
- 问题：长篇连续性不足，第二章/后续章可能读不到足够前文风格和视角。
- 任务：按模型窗口动态使用：近 10 章全文、前 20-10 章摘要、20 章以前弧/卷/全书总结，预算不足再降级。
- 验收：1M context 模型写第 N 章时 prompt metadata 显示 recentFullChapters 目标为最多 10 章。

### F2. 合并两套 context builder

- 位置：`book-context.ts:566`、`builder.ts:365`、`conversation-orchestrator.ts:152`、`auto.ts:177`
- 现状：`buildBookPromptContext/buildChapterWriteMessages` 和 `buildWriteContext` 两套概念并存。
- 问题：不同入口拿到的上下文不一致。
- 任务：保留一个写作上下文构建器；所有写作、审查、修复、自动写都调用同一策略。
- 验收：`write/auto/conversation/editor` 的写作消息来自同一 builder。

### F3. 大纲注入精确到章

- 位置：`book-context.ts:112-187`、`:566-602`
- 现状：通过标题正则找章节点，`enrichUserIntentWithOutline` 拼进 userIntent。
- 风险：章标题不规范时漏注入，或误匹配。
- 任务：章节点应有明确 `metadata.chapterNo`，写作按 chapterNo 精确取对应节点。
- 验收：标题不含“第 N 章”也能注入本章计划。

### F4. 禁止章尾模板化续写提示进入正文

- 位置：写作 prompt/builder/audit validator
- 现状：需要系统性检查正文末尾“未完待续/意犹未尽/新的篇章”等模板句。
- 任务：validator 增加章节末尾禁用模式，但作为审查标准，不作为用户指令正则触发。
- 验收：测试正文末尾出现待续式总结时 validation_report fail/repairable。

---

## Task G：模型/设置相关混用

### G1. 模型供应商和 key 绑定继续加回归测试

- 位置：`main.ts:39-43`、`config/secrets.ts:43-47`、`routes/usage.ts:75-128`、`settings.tsx:414-436`
- 现状：代码已有 providerSecretName，但之前出现过切供应商 key 不变的 UI 问题。
- 任务：加端到端测试：切 provider 后显示对应 masked key；保存 key 只写当前 provider。
- 验收：anyrouter/deepseek/custom provider key 互不串。

### G2. 自定义 provider listModels 行为标准化

- 位置：`routes/usage.ts:138-175`、`providers/openai-compatible.ts:63-79`、`custom-openai-compatible.ts:30-32`
- 现状：`POST /api/models` 支持 preview config，但 UI/错误提示曾让用户困惑。
- 任务：模型刷新必须按当前表单 provider/baseUrl/auth/key 直接请求 `/v1/models`，错误显示实际 URL、鉴权类型、HTTP 状态。
- 验收：Bearer custom provider 可直接拉模型；失败不误报为供应商不支持。

---

## Task H：测试护栏

### H1. 加“旧入口不得被 UI 调用”测试

- 检查：`write-draft|finalize|/auto|/conversation?mode=chat|/onboard|worldbook/chat|revise-segment`
- 位置：client tests 或静态测试。
- 验收：这些字符串不能出现在前端 fetch/startSseStream URL 中，除非测试旧兼容页。

### H2. 加“AI 写入不得绕过 staging”静态测试

- 检查：AI orchestrator/http AI route 中不得直接调用 `chaptersRepo.saveVersion/chapterFiles.save/saveAudit/saveSummary`。
- 允许：手动 CRUD、版本恢复、导入。
- 验收：新增白名单文件，非白名单命中测试失败。

### H3. 加“正则不得触发业务流程”测试

- 检查：main-agent、conversation-pane、conversation-orchestrator 不得用 regex/parseSlashCommand 决定写作。
- 允许：schema 校验、标题解析、SillyTavern regex scripts、非业务格式解析。
- 验收：发“第一人称”“第二章视角错了”“讨论大纲第3章”均不触发 write task。

### H4. 加“失败不落半套状态”集成测试

- 场景：写作成功但 audit 失败；audit 成功但 record-state 失败；文件落盘失败；用户取消。
- 验收：没有新增 chapter/version/summary/character/foreshadow/timeline 半成品；workflow_run 标记 failed/waiting_user。

### H5. 加“UI 不把流结束当成功”测试

- 场景：SSE error、done committed false、validation_report fail。
- 验收：不刷新章节，不 toast 成功，显示可修复/等待确认状态。

---

## 2026-06-24 二次复核：当前工作树仍需一一打掉的混用点

> 本节基于当前工作树重新扫描。注意：部分 route 已经改成 `runAgentWorkflow` wrapper，但这不代表流程完成。只要旧模块仍能直接落库、UI 仍识别旧事件、schema 仍靠 message 文本传递模式，就还是混用。

### 扫描命令

```powershell
rg -n "runConversation\(|runAutoMode\(|runNewBookConversation\(|runWorldbookChat\(|writeWithAudit\(|writeChapterSimple\(|auditChapter\(|repairChapter\(|recordChapterState\(|reviseSegment\(" packages/server/src -g "*.ts"
rg -n "conversation\?mode=chat|/auto|auto/cancel|/onboard|worldbook/chat|revise-segment|apply-revision|write-draft|finalize|tool_call_start|tool_call_end|chapter_write|chapter_audit|record_chapter_state|auto_status|acceptance_report|execution_step|text_delta|done" packages/client/src packages/client/tests -g "*.ts" -g "*.tsx"
rg -n "chaptersRepo\.saveVersion|chapterFiles\.save|saveAudit|saveSummary|conversationsRepo\.append|characterRepo\.|outlineRepo\.|worldbookRepo\.|foreshadowingRepo\.|timelineRepo\." packages/server/src -g "*.ts"
rg -n "AgentRunRequestSchema|SseEventSchema|agent_phase|main_output|validation_report|repair_plan|done|target\.mode" packages/shared/src packages/server/src packages/client/src -g "*.ts" -g "*.tsx"
```

### R1. 服务端 route 已半收口，但语义仍靠 message 拼接

- 位置：`packages/server/src/http/routes/chapters.ts:27-74`
- 现状：`/write`、`/write-draft`、`/finalize` 已经 wrapper 到 `runAgentWorkflow`。
- 问题：`mode` 被拼进 `message = "${action} chapter ${no}. ..."`，请求只传 `target.chapterNo`，没有传 `target.mode`。
- 风险：又回到“main-agent 从自然语言猜业务模式”，这和“不要正则触发/不要旧流程混用”的目标冲突。
- Task：
  1. 在 `AgentRunRequestSchema.target` 增加 `mode: "write" | "draft" | "rewrite" | "finalize"`。
  2. `chapters.ts` wrapper 传 `{ target: { chapterNo, mode } }`，message 只放用户原始意图。
  3. `editor-pane.tsx` 发送的 `target.mode` 要被 shared schema 正式接收。
- 验收：
  ```powershell
  rg -n "draft chapter|finalize chapter|write chapter" packages/server/src/http/routes packages/server/src/ai/orchestrator
  ```
  不应靠拼接英文命令决定业务。

### R2. `agent-runner.ts` 仍可能“commit 失败却 done committed:true”

- 位置：`packages/server/src/ai/orchestrator/agent-runner.ts:20-87`
- 现状：`deps.staging.commit(runId, deps.handle)` 被调用后未检查返回值；runner 没有 try/catch。
- 问题：
  - main/executor/validator/commit 任一异常会让 SSE 突然断流。
  - commit 有 failed change 时仍可能继续发 `done committed:true`。
  - `executionMode` 没有使用 `buildExecutionPolicy` 统一判断。
  - `source/target` 没传给 `analyzeIntent`，main-agent 不知道请求来自 editor/auto/onboard/revision。
- Task：
  1. `runAgentWorkflow` 外层包 try/catch，异常统一 yield `error` + `done committed:false`。
  2. commit 必须返回并检查 `{ success, failedChanges }`，失败不得 `committed:true`。
  3. `staging.begin/add/commit` 全部 await 或保持同步但明确类型，不能吞错。
  4. 使用 `buildExecutionPolicy`，`plan_only/confirm_each/low_risk_auto/trusted_auto` 在同一处生效。
  5. `analyzeIntent` 输入改为 `{ message, source, target, executionMode }`。
- 验收：
  - 单测模拟 `staging.commit` 抛错，最后事件必须是 `error` 或 `done committed:false`。
  - 单测模拟 `commit` 返回 failed，不能出现 `done committed:true`。

### R3. 旧 orchestrator 模块仍在生产源码中，且包含直接落库链

- 位置：
  - `packages/server/src/ai/orchestrator/conversation-orchestrator.ts`
  - `packages/server/src/ai/orchestrator/auto-mode.ts`
  - `packages/server/src/ai/orchestrator/new-book.ts`
  - `packages/server/src/ai/orchestrator/worldbook-chat.ts`
  - `packages/server/src/ai/orchestrator/revise-segment.ts`
  - `packages/server/src/ai/orchestrator/write-chapter.ts`
  - `packages/server/src/ai/orchestrator/write-with-audit.ts`
  - `packages/server/src/ai/orchestrator/repair-chapter.ts`
  - `packages/server/src/ai/orchestrator/record-state.ts`
- 证据：
  - `auto-mode.ts` 调 `writeWithAudit`，发 `auto_status`，再 `record_chapter_state`。
  - `conversation-orchestrator.ts` 仍调 `writeWithAudit/auditChapter/recordChapterState`。
  - `write-chapter.ts` 和 `repair-chapter.ts` 直接 `chaptersRepo.saveVersion` + `chapterFiles.save`。
  - `audit-persist.ts` 直接 `saveAudit/saveSummary`。
  - `record-state.ts` 会更新 outline summary，并通过 state tools 写资产。
- Task：
  1. 给所有旧 orchestrator 加 `@deprecated` 注释和静态护栏，禁止 HTTP route import。
  2. 拆分旧模块：生成/审查纯函数可以复用，持久化必须迁到 `workflow-staging.ts`。
  3. 删除或隔离 `conversation-orchestrator.ts` 中的 mutation 分支，只保留只读问答 helper 或完全下线。
  4. `auto-mode/new-book/worldbook-chat/revise-segment` 的集成测试迁到 `/agent/run`。
- 验收：
  ```powershell
  rg -n "writeWithAudit\(|writeChapterSimple\(|repairChapter\(|recordChapterState\(" packages/server/src/http packages/server/src/ai/orchestrator/agent-runner.ts packages/server/src/ai/orchestrator/executor-agent.ts
  ```
  只能在明确的 legacy helper 测试或 deprecated 文件内命中。

### R4. `book-tools.ts` 仍保留 trigger tools，必须从普通聊天能力中物理移除

- 位置：`packages/server/src/ai/tools/book-tools.ts:14-214`
- 现状：`makeTriggerTools` 还定义：
  - `write_next_chapter`
  - `rewrite_chapter`
  - `delete_chapters`
  - `audit_chapter`
- 问题：这些 tool 返回 `__action`，旧 `conversation-orchestrator` 检测后会中断 stream 并执行重流程。这是“普通聊天很容易触发写正文”的历史根因之一。
- Task：
  1. 删除 `makeTriggerTools` 或迁为 executor-agent 内部 action schema，普通聊天 tool registry 不得暴露。
  2. 删除 `TriggerAction` 和 `__action` 中断执行协议。
  3. 写作/删除/审查只能由 main-agent 输出 TaskContract，再由 executor 走 staging 和 policy。
- 验收：
  ```powershell
  rg -n "__action|makeTriggerTools|write_next_chapter|rewrite_chapter|delete_chapters|audit_chapter" packages/server/src
  ```
  不得出现在普通聊天路径。

### R5. 前端 `conversation-pane` 已改打 `/agent/run`，但事件协议仍是三代混用

- 位置：`packages/client/src/components/conversation/conversation-pane.tsx:15-40, 271-379`
- 现状：
  - 旧 tool：`tool_call_start/tool_call_end/chapter_write/chapter_audit/record_chapter_state`
  - 旧 auto：`auto_status`
  - 中间流：`execution_step/acceptance_report`
  - 新流：`agent_phase/main_output/validation_report/done`
- 问题：UI 状态仍由旧 tool 名推断，`done` 仍容易被当作“完成”，没有严格检查 `committed`。
- Task：
  1. 统一进度组件只消费 `agent_phase/execution_plan/validation_report/repair_plan/done/error`。
  2. `text_delta/tool_call_start/tool_call_end/auto_status/acceptance_report` 只允许 legacy wrapper 转换，不直接驱动主 UI。
  3. `done.committed !== true` 不得刷新章节、不得显示完成。
  4. `validation_report.verdict !== "pass"` 必须显示待确认/修复入口。
- 验收：
  ```powershell
  rg -n "WRITING_TOOLS|tool_call_start|tool_call_end|auto_status|acceptance_report|chapter_write|record_chapter_state" packages/client/src/components/conversation
  ```
  主流程组件应无命中。

### R6. `message.tsx` 和 `streaming-message.tsx` 还用旧 tool 名渲染写作状态

- 位置：
  - `packages/client/src/components/conversation/message.tsx`
  - `packages/client/src/components/conversation/streaming-message.tsx`
- 现状：两个组件都有 `WRITING_TOOLS = chapter_write/chapter_audit/record_chapter_state/...`。
- 问题：即使入口收口，历史 UI 仍把旧 tool 作为“写作中”的判定标准，导致隐藏正文、转圈、完成状态都和新 agent 协议不一致。
- Task：
  1. 删除组件内旧 tool label。
  2. 改成展示 store 中规范化后的 `WorkflowStage`，由 event adapter 统一转换。
  3. 旧消息历史如果包含 tool events，只作为历史兼容显示，不参与当前 run 状态。
- 验收：旧 tool 名不会出现在当前 run 的 UI 状态判断。

### R7. `onboard.tsx` 仍走独立 `/onboard` 和旧事件

- 位置：`packages/client/src/pages/onboard.tsx:59-89`
- 现状：页面直接请求 `/api/books/:bookId/onboard`，并处理 `text_delta/tool_call_start/tool_call_end/execution_step/acceptance_report/done`。
- 问题：创书聊天还是独立 UI/协议，和普通聊天/agent run 不统一。
- Task：
  1. `/onboard` 页面若保留，发送 `/api/books/:bookId/agent/run`，`source:"onboard"`。
  2. 删除独立 ToolChip 状态，复用统一 AgentProgress。
  3. `onboard-status` 和 `onboard/skip` 属于状态接口，可保留，但不要执行 AI。
- 验收：
  ```powershell
  rg -n "/onboard\"|tool_call_start|tool_call_end|acceptance_report" packages/client/src/pages/onboard.tsx
  ```
  AI 请求与旧事件解析应无命中。

### R8. `revise-preview.tsx` 已改 `/agent/run`，但候选应用语义还没闭环

- 位置：`packages/client/src/components/editor/revise-preview.tsx:36-51`
- 现状：组件发 `/agent/run source:"revision"`，同时继续拼 `text_delta/main_output` 成预览文本，`done` 后设置 ready。
- 问题：
  - `main_output.reply` 是可见回复，不应等同于改写候选正文。
  - 没有从 staged change/hidden draft 读取 revision candidate。
  - `done committed:false/needsUserDecision:true` 与 `validation_report` 没有控制 ready 状态。
- Task：
  1. revision workflow 明确定义候选输出字段，例如 `main_output.draft` 或 `hidden_draft` event。
  2. ready 必须由 `validation_report.pass && done.committed/needsUserDecision` 组合决定。
  3. 接受候选必须 commit 对应 staged change/runId，不能再直接 `/apply-revision`。
- 验收：模拟 `done committed:false` 时接受按钮不可用。

### R9. `editor-pane.tsx` 使用 `/agent/run`，但只等 reader 结束

- 位置：`packages/client/src/components/editor/editor-pane.tsx:119-175`
- 现状：编辑器写草稿/定稿请求 `/agent/run`，但读取 stream 时只等 `reader.read().done`，不解析 SSE 事件。
- 问题：流结束不代表成功；`validation_report fail`、`done committed:false`、`error` 都可能被误判为可刷新。
- Task：
  1. editor 复用统一 SSE parser。
  2. 解析 `validation_report/done/error`，只在 `done.committed === true` 时刷新章节。
  3. `target.mode` 必须正式进入 shared schema。
- 验收：模拟 error stream，编辑器不刷新、不 toast 成功。

### R10. shared `SseEventSchema` 仍把旧事件作为一等主协议

- 位置：`packages/shared/src/types/sse-events.ts:16-76`
- 现状：同一个 `SseEventSchema` 同时包含：
  - `text_delta/reasoning_delta`
  - `tool_call_start/tool_call_end`
  - `auto_status`
  - `intent/workflow_mode/execution_plan/execution_step/confirmation_required/acceptance_report`
  - `agent_phase/main_output/validation_report/repair_plan/done`
- 问题：类型层面承认三代协议平等存在，前端自然会继续混用。
- Task：
  1. 拆出 `LegacySseEventSchema` 和 `AgentSseEventSchema`。
  2. 新 `/agent/run` 只返回 AgentSseEvent。
  3. 旧 route wrapper 如需兼容，服务端内转换为 AgentSseEvent，或标记 deprecated。
  4. `done` 增加强制字段：`committed`、`runId`、`needsUserDecision`、`failed`、`summary`。
- 验收：`/agent/run` 类型不允许 `auto_status/tool_call_start/tool_call_end`。

### R11. shared `AgentRunRequestSchema.target` 不够表达真实操作

- 位置：`packages/shared/src/types/agent-workflow.ts:169-181`
- 现状：target 只有 `chapterNo/chapterCount/revisionRange`。
- 缺口：
  - editor mode：write/draft/rewrite/finalize。
  - asset audit scope：characters/outline/worldbook/timeline/foreshadowing/all。
  - active review options：是否修复、是否只报告、是否全量资产。
  - onboard intent：创书阶段、用户回答、是否跳过。
  - auto writing：章节范围、默认章节长度 short/medium/long。
- Task：
  1. target schema 按 source 拆 discriminated union。
  2. 前端不得把结构化意图塞进 message。
  3. main-agent 以 source/target 为硬约束，message 只作为用户自然语言补充。
- 验收：`editor-pane.tsx` 的 `target.mode` 能通过 shared schema；asset_audit 不需要靠 prompt 文本表达范围。

### R12. `conversationsRepo.append` 分散在多个 route，历史持久化仍未统一

- 位置：
  - `packages/server/src/http/routes/conversation.ts:77-87`
  - `packages/server/src/http/routes/books.ts:148-154`
  - `packages/server/src/http/routes/worldbook.ts:116-135`
  - `packages/server/src/http/routes/sidebar.ts:40,129,144,173,207,233,260`
  - `packages/server/src/ai/orchestrator/conversation-orchestrator.ts:802`
- 问题：
  - AI 对话、创书、worldbook chat、手动资产 CRUD 都在不同层写 conversation。
  - 主动审查 prompt、隐藏正文、工具结果容易被错误写进聊天历史。
  - 新书读取旧书聊天的问题需要用统一 book-scoped persistence 验证。
- Task：
  1. 定义唯一 conversation persistence service。
  2. `agent-runner` 决定哪些 user-visible 内容入库，hidden draft 和 active audit prompt 不入库。
  3. 手动 sidebar CRUD 可继续写“用户操作日志”，但 metadata 必须与 chat 消息区分。
  4. 添加跨书隔离测试：新书 history 为空，不读取旧书 message。
- 验收：`conversation.ts/books.ts/worldbook.ts` 不再各自拼 assistant buffer 写库。

### R13. `state-tools.ts` 与 `book-meta-tools.ts` 仍是直接写资产工具

- 位置：
  - `packages/server/src/ai/tools/state-tools.ts:171-223`
  - `packages/server/src/ai/tools/book-meta-tools.ts:177-205`
- 现状：
  - `state-tools` 直接 create/pay foreshadowing、create timeline。
  - `book-meta-tools` 直接 create/update outline。
- 问题：旧 agent/tool 流一旦调用这些工具，就绕过 staging、去重、validator，容易重复角色/重复大纲/半程污染。
- Task：
  1. AI tool 执行层改成“返回拟变更”，不直接写 repo。
  2. executor-agent 把拟变更转成 staged changes。
  3. workflow-staging commit 时统一去重和读回验证。
- 验收：模拟 record-state 中途失败，characters/outline/foreshadowing/timeline 不新增半成品。

### R14. 删除章节仍可能是 AI 可达的高风险旧能力

- 位置：
  - `packages/server/src/http/routes/chapters.ts:143-180`
  - `packages/server/src/ai/orchestrator/delete-chapter.ts`
  - `book-tools.ts` 的 `delete_chapters` trigger
- 现状：route 的 DELETE 是手动 CRUD，可以保留；但旧 trigger tool 也能表达删除章节。
- 问题：删除属于 destructive，必须经过 execution policy 和用户确认，不能由普通聊天 tool call 直达。
- Task：
  1. 保留手动 DELETE route，但明确只由 UI 显式删除按钮调用。
  2. AI 删除章节必须走 `agent/run source:"chat" taskType:"delete"`，`executionMode` 至少 confirm。
  3. 删除执行也应有 staged plan 和 rollback/read-back 报告。
- 验收：普通聊天不会因 tool call 直接执行 `deleteChaptersFrom`。

### R15. 测试仍大量维护旧行为，必须拆迁或标记 legacy

- 位置：
  - `packages/client/tests/components/conversation-pane.test.tsx`
  - `packages/client/tests/components/conversation-writing-intent.test.tsx`
  - `packages/client/tests/components/conversation-tool-feedback.test.tsx`
  - `packages/client/tests/components/phase9.test.tsx`
  - `packages/client/tests/components/selection-revise.test.tsx`
  - `packages/client/tests/pages/onboard.test.tsx`
  - `packages/server/tests/integration/auto-mode.test.ts`
  - `packages/server/tests/integration/revise-routes.test.ts`
  - `packages/server/tests/integration/write-chapter-simple.test.ts`
  - `packages/server/tests/integration/write-then-audit.test.ts`
- 问题：测试继续断言旧 endpoint/旧 event/旧 tool，就会逼着代码保留旧流程。
- Task：
  1. UI 测试改成 agent event：`agent_phase/execution_plan/validation_report/done`。
  2. `/auto` 测试改为 `/agent/run source:auto`。
  3. revise 测试改为 staged revision candidate + commit。
  4. 旧 write/audit 测试降级为 helper-only，并明确不走 HTTP route。
- 验收：全量测试中不再要求 `/auto/cancel/auto_status/tool_call_start/chapter_write` 作为主流程。

### R16. 当前护栏测试还不够严

- 位置：
  - `packages/server/tests/unit/http/ai-routes-guard.test.ts`
  - `packages/client/tests/components/ai-entrypoints-guard.test.ts`
- 现状：已有 guard，但主要盯 route 是否调用旧 orchestrator、前端是否含部分旧 URL。
- 缺口：
  - 没检查 `agent-runner/executor-agent` 是否直接 import 旧落库 orchestrator。
  - 没检查 AI tool 是否直接写 repo。
  - 没检查 `/agent/run` 是否可能发旧事件。
  - 没检查 `done.committed` 强制字段。
- Task：
  1. 新增 `ai-staging-guard.test.ts`：AI 路径直接写库必须失败，白名单只有 `workflow-staging.ts` 和手动 CRUD route。
  2. 新增 `agent-event-guard.test.ts`：`/agent/run` event union 不允许旧事件。
  3. 新增 `agent-schema-guard.test.ts`：前端发送的 target 字段必须被 shared schema 接收。
  4. 新增 `legacy-import-guard.test.ts`：HTTP route、agent-runner、executor-agent 不得 import deprecated orchestrator。
- 验收：以后新增旁路时，静态测试第一时间失败。

### R17. 上下文策略仍有两套，长篇连续性问题还没解决

- 位置：
  - `packages/server/src/ai/context-builder/book-context.ts`
  - `packages/server/src/ai/context-builder/builder.ts`
  - `packages/server/src/ai/context-builder/snapshot.ts`
  - 旧 `conversation-orchestrator.ts/auto-mode.ts` 内部上下文拼装
- 问题：1M 上下文策略、近 10 章全文、20-10 章摘要、20 章前总纲，还没有成为唯一 builder 的硬规则。
- Task：
  1. 定义 `buildLongformWriteContext` 作为唯一写作上下文入口。
  2. 所有 write/revise/audit/repair/auto 都用同一 context object。
  3. context metadata 暴露 `recentFullChapters/summaryChapters/globalSummaryTokens/omittedReason` 方便日志审查。
  4. 第 N 章写作必须读取第 N-1 等近章全文，验证第一人称/风格连续。
- 验收：写第二章时 prompt metadata 显示第一章全文已注入；超过 20 章时按策略降级。

---

## 2026-06-24 三次复核：当前工作树完整任务化清单

> 本节只记录当前工作树仍能静态命中的混用点。前文里已完成的项不在这里重复算完成；这里的每个编号都应作为后续整改 task 跟踪，修完一项就用对应验收命令证明。

### T01. 前端创书页仍直连旧 AI `/onboard`

- 状态：已修前端。`OnboardPage` 的 AI 对话已改为 `/agent/run source:"onboard"`；页面不再解析旧 `tool_call_start/tool_call_end/execution_step/acceptance_report/text_delta`。`/onboard-status` 和 `/onboard/skip` 作为非 AI 状态接口保留。
- 证据：
  - `packages/client/src/pages/onboard.tsx:59` 请求 `/api/books/${bookId}/onboard`。
  - `packages/client/src/pages/onboard.tsx:63-88` 解析 `text_delta/tool_call_start/tool_call_end/execution_step/acceptance_report/done`。
  - `packages/client/tests/pages/onboard.test.tsx` 仍挂载 `/books/:bookId/onboard`。
- 问题：创书聊天仍是独立 AI 入口和旧事件协议，和普通聊天、编辑器、新 agent 进度 UI 不统一。
- 任务：
  1. `OnboardPage` 的 AI 请求改为 `/api/books/:bookId/agent/run`，body 使用 `source:"onboard"`、`executionMode`、结构化 `target`。
  2. 删除页面内旧 ToolChip/旧事件解析，复用统一 agent progress adapter。
  3. `/onboard-status` 和 `/onboard/skip` 只作为非 AI 状态接口保留，明确写入白名单。
  4. 更新 `onboard.test.tsx`，断言创书 AI 请求不再命中 `/onboard`，只命中 `/agent/run`。
- 验收：
  ```powershell
  rg -n 'startSseStream\(|/onboard`|/onboard"|tool_call_start|tool_call_end|execution_step|acceptance_report' packages/client/src/pages/onboard.tsx packages/client/tests/pages/onboard.test.tsx
  ```
  除 `/onboard-status`、`/onboard/skip` 外不应命中旧 AI 入口和旧事件。
- 已验证：
  ```powershell
  pnpm --filter @scribe/client exec vitest run tests/pages/onboard.test.tsx
  pnpm --filter @scribe/client exec vitest run tests/components/ai-entrypoints-guard.test.ts
  pnpm --filter @scribe/client typecheck
  ```

### T02. 前端对话主面板仍以旧 tool/SSE 事件驱动写作 UI

- 证据：
  - `packages/client/src/components/conversation/conversation-pane.tsx:16-39` 定义 `chapter_write/chapter_audit/record_chapter_state` 等旧写作工具和阶段。
  - `conversation-pane.tsx:271-379` 仍处理 `text_delta/tool_call_start/tool_call_end/auto_status/execution_step/acceptance_report/done`。
  - `packages/client/tests/components/conversation-pane.test.tsx` 仍构造 `tool_call_start chapter_write`。
- 问题：即使请求已经打到 `/agent/run`，UI 状态仍由旧工具名推断，容易出现“正文进聊天框”“转圈不停”“失败当成功”的老问题。
- 任务：
  1. 建立统一 `AgentRunEventAdapter`，只把 `agent_phase/execution_plan/validation_report/repair_plan/done/error` 转成 UI 状态。
  2. `conversation-pane` 删除当前运行态对旧 tool 名的依赖；旧 tool event 只允许作为历史消息兼容展示。
  3. `done.committed !== true` 时不得刷新章节、不得显示完成；`needsUserDecision` 要进入等待确认状态。
  4. 迁移 `conversation-pane.test.tsx` 到新事件。
- 验收：
  ```powershell
  rg -n 'WRITING_TOOLS|tool_call_start|tool_call_end|auto_status|acceptance_report|chapter_write|record_chapter_state' packages/client/src/components/conversation/conversation-pane.tsx
  ```
  主运行态组件不应再命中。

### T03. 消息组件仍把旧工具名当成“写作流”判定

- 证据：
  - `packages/client/src/components/conversation/message.tsx:7-23` 有旧 `WRITING_TOOLS`。
  - `packages/client/src/components/conversation/streaming-message.tsx:8-27` 有旧 `WRITING_TOOLS` 和旧 label。
- 问题：历史消息展示组件会继续用旧工具事件决定隐藏正文和进度，和新 agent 事件协议不一致。
- 任务：
  1. `Message`、`StreamingMessage` 改读规范化后的 workflow stage，而不是 raw tool event。
  2. 旧 tool events 仅作为历史兼容文本，不参与当前 run 状态。
  3. 补测试：旧历史 tool event 不会触发当前运行态转圈。
- 验收：
  ```powershell
  rg -n 'WRITING_TOOLS|chapter_write|chapter_audit|record_chapter_state|chapter_repair' packages/client/src/components/conversation/message.tsx packages/client/src/components/conversation/streaming-message.tsx
  ```

### T04. 选区改写候选仍没有 staged candidate 协议

- 状态：已修前端旧协议消费。`RevisePreview` 不再把 `text_delta` 或 `main_output.reply` 当候选正文，也不再调用旧 `/apply-revision`；候选只读取 `main_output.draft`，并要求 `validation_report:pass + done.needsUserDecision:true` 才允许接受。真正确认后 commit 指定 `runId/changeId` 仍归入 T12 统一 confirm/commit API。
- 证据：
  - `packages/client/src/components/editor/revise-preview.tsx:44` 仍把 `text_delta` 拼成候选文本。
  - `revise-preview.tsx:47-50` 对 `done.committed` 的处理直接调用 `onAccepted("")`。
  - `packages/client/tests/components/selection-revise.test.tsx` 仍断言 `/apply-revision`。
  - 服务端 `packages/server/src/http/routes/revise.ts:60` 已让 `/apply-revision` 返回 410，但测试还在维护旧行为。
- 问题：改写候选到底来自可见回复、hidden draft、还是 staged change 没定义清楚，接受按钮无法正确绑定某个 workflow run/change。
- 任务：
  1. 定义 revision 专用输出：`hidden_draft` event 或 staged `revision_candidate` change。
  2. `RevisePreview` 只展示候选 payload，不把 `main_output.reply/text_delta` 当正文。
  3. 接受候选改为 commit 指定 `runId/changeId`，不再请求 `/apply-revision`。
  4. 重写 `selection-revise.test.tsx`，覆盖 `done.committed:false` 时不能接受。
- 验收：
  ```powershell
  rg -n 'text_delta|apply-revision|onAccepted\\(\"\"\\)' packages/client/src/components/editor/revise-preview.tsx packages/client/tests/components/selection-revise.test.tsx
  ```
- 已验证：
  ```powershell
  pnpm --filter @scribe/client exec vitest run tests/components/selection-revise.test.tsx
  pnpm --filter @scribe/client exec vitest run tests/components/ai-entrypoints-guard.test.ts
  pnpm --filter @scribe/client typecheck
  ```

### T05. `/auto` 前后端仍保留旧 endpoint 与旧取消语义

- 当前进度：
  - 前端 `phase9.test.tsx` 已迁移：不再断言 `/auto`、`auto_status`、`/auto/cancel` 为主流程。
  - 新测试明确保护：多章写作自然语言仍走统一 `/agent/run`，前端不做正则意图路由；取消只 abort 当前 stream，不请求 `/auto/cancel`。
  - `packages/client/src/pages/settings.tsx` 旧 `/auto N` 文案已移除。
  - `packages/server/tests/integration/auto-mode.test.ts` 已迁移：主测试走 `/agent/run source:"auto"`，legacy `/auto` 只验证 wrapper 不再发 `auto_status/tool_call_*`。
  - `packages/server/tests/unit/ai/orchestrator/auto-retry.test.ts` 已删除，测试套件不再保护 `runAutoMode + auto_status` 旧状态机。
  - 剩余工作在生产源码：`/auto` wrapper、`/auto/cancel`、`auto-mode.ts` legacy helper 本体仍未下线。
- 证据：
  - `packages/server/src/http/routes/auto.ts:27` 仍暴露 `POST /api/books/:bookId/auto` wrapper。
  - `packages/server/src/http/routes/auto.ts:69` 仍暴露 `/auto/cancel`，当前只是返回 `{ ok:true, deprecated:true }`。
  - `packages/server/src/ai/orchestrator/auto-mode.ts` 仍保留 `runAutoMode` 和旧 `auto_status` 输出。
- 问题：兼容入口可以短期存在，但测试仍把旧入口当主流程，会逼着旧状态机和旧 UI 协议继续活着。
- 任务：
  1. 前端删除 `/auto` 直连和 `/auto/cancel` 测试，自动写统一进入 `/agent/run` 完整工作流，且不靠前端正则识别意图。已完成。
  2. 服务端 `/auto` 只保留兼容 wrapper 或返回 410；不得新增任何旧状态机逻辑。
  3. `/auto/cancel` 接入统一 workflow cancel，或明确下线并更新 UI。
  4. `auto-mode.test.ts` 迁为 `/agent/run source:auto` 集成测试；旧 `runAutoMode` 只作为 deprecated helper 测试。已完成主测试迁移，且删除旧 helper 测试。
- 验收：
  ```powershell
  rg -n '/auto|auto_status|auto/cancel|runAutoMode' packages/client/src packages/client/tests packages/server/tests -g '*.ts' -g '*.tsx'
  ```
  只允许文案、deprecated helper 测试或白名单注释命中。

### T06. 服务端旧 orchestrator 模块仍可直接写入或发旧事件

- 证据：
  - `packages/server/src/ai/orchestrator/write-chapter.ts:104-109` 直接 `chaptersRepo.saveVersion` + `chapterFiles.save`。
  - `packages/server/src/ai/orchestrator/repair-chapter.ts:96-101` 直接保存修复正文。
  - `packages/server/src/ai/orchestrator/audit-persist.ts:87-103` 直接 `saveAudit/saveSummary`。
  - `packages/server/src/ai/orchestrator/auto-mode.ts:110` 调 `writeWithAudit`，并发 `auto_status/tool_call_start`。
  - `packages/server/src/ai/orchestrator/conversation-orchestrator.ts:109/174/419` 仍可调 `recordChapterState/writeWithAudit/auditChapter`。
- 问题：HTTP route 虽然已收口很多，但旧模块仍在生产源码里具备“生成即落库”和旧事件输出能力，任何内部 import 都可能复活旁路。
- 任务：
  1. 给 `write-chapter/write-with-audit/repair-chapter/audit-persist/record-state/auto-mode/conversation-orchestrator/new-book/worldbook-chat/revise-segment` 标记 `@deprecated legacy workflow`。
  2. 把可复用的生成逻辑拆成 pure helper，只返回 payload，不落库。
  3. 所有落库迁入 `workflow-staging.ts`，validator 通过后统一 commit。
  4. 新增 `legacy-import-guard.test.ts`：`http/routes`、`agent-runner`、`executor-agent` 不得 import deprecated orchestrator。
- 验收：
  ```powershell
  rg -n 'writeWithAudit\\(|writeChapterSimple\\(|repairChapter\\(|recordChapterState\\(|chaptersRepo\\.saveVersion|chapterFiles\\.save|saveAudit|saveSummary|auto_status|tool_call_start' packages/server/src/ai/orchestrator packages/server/src/http/routes -g '*.ts'
  ```
  除 deprecated 文件和 `workflow-staging.ts` 外不应命中执行路径。

### T07. 旧 `conversation-orchestrator` 仍保留 slash command 和计划执行分支

- 证据：
  - `packages/server/src/ai/orchestrator/conversation-orchestrator.ts:3` import `parseSlashCommand`。
  - `conversation-orchestrator.ts:719-751` 仍解析 `/help`、`/note`、`/recall`、`/revise`、`/auto`。
  - `packages/shared/src/slash-commands.ts` 仍定义 `/write`、`/auto`、`/revise`、`/audit` 等命令。
  - `packages/client/src/components/conversation/slash-suggestions.tsx` 仍提供 slash UI。
- 问题：用户已经要求“所有指令都不要正则/命令直接匹配，全部经过完整工作流”。当前 slash command 是另一条硬编码意图系统。
- 任务：
  1. 停用写作/改写/审查/自动写相关 slash command 的硬执行，只作为输入补全文本或彻底移除。
  2. `/note`、`/recall` 如需保留，也应走 `agent/run` 的 query/memory contract，而非旧 orchestrator。
  3. 删除 `conversation-orchestrator` 的 slash routing 单测，改成 main-agent 结构化意图测试。
  4. 前端 slash suggestion 文案改为“快捷输入”，不得触发专用 endpoint。
- 验收：
  ```powershell
  rg -n 'parseSlashCommand|SLASH_COMMANDS|/write|/auto|/revise|/audit|/note|/recall' packages/server/src packages/client/src packages/shared/src packages/server/tests packages/client/tests -g '*.ts' -g '*.tsx'
  ```
  只允许非执行性补全文案或废弃说明命中。

### T08. shared SSE 类型仍把三代协议放在同一个主 union

- 证据：
  - `packages/shared/src/types/sse-events.ts:16-76` 同时定义 `text_delta/reasoning_delta/tool_call_start/tool_call_end/auto_status/intent/workflow_mode/execution_step/acceptance_report/agent_phase/main_output/validation_report/done/error`。
  - `done` 的 `committed/needsUserDecision/runId` 仍是 optional。
- 问题：类型层面承认旧协议是一等主协议，前端和测试自然会继续混用。
- 任务：
  1. 拆分 `LegacySseEventSchema`、`AgentRunEventSchema`、`UsageEventSchema`。
  2. `/agent/run` 返回类型只允许新 agent 事件和 usage/error。
  3. `done` 对新 agent 强制包含 `committed`、`needsUserDecision`、`runId`、`summary`，并加 `failed?: boolean` 或等价字段。
  4. 旧 wrapper 如需兼容，在服务端转换为新事件，不把旧事件传到新 UI。
- 验收：
  ```powershell
  rg -n 'tool_call_start|tool_call_end|auto_status|intent|workflow_mode|execution_step|acceptance_report' packages/shared/src/types/sse-events.ts
  ```
  不应出现在新 agent event schema 中。

### T09. `AgentRunTargetSchema` 已扩展但仍未按 source 严格区分

- 证据：
  - `packages/shared/src/types/agent-workflow.ts:169-194` 的 `AgentRunTargetSchema` 是一个 `.passthrough()` object，所有字段均 optional。
  - `source` 与 `target` 没有 discriminated union 约束。
- 问题：editor/auto/onboard/revision/asset_audit 的必填字段无法被类型层保证，容易再次把结构化语义塞回 `message`。
- 任务：
  1. 改为按 `source` 的 discriminated union：`EditorAgentRunRequest`、`AutoAgentRunRequest`、`RevisionAgentRunRequest`、`OnboardAgentRunRequest`、`AssetAuditAgentRunRequest`、`ChatAgentRunRequest`。
  2. editor 必须带 `target.chapterNo + target.mode`；auto 必须带 `chapterCount/defaultChapterLength`；revision 必须带 `revisionRange`。
  3. 去掉 `.passthrough()` 或只给 `metadata` 留扩展口。
  4. 补 shared schema test，前端实际请求体必须 parse 成功，缺字段必须失败。
- 验收：
  ```powershell
  pnpm --filter @scribe/shared exec vitest run tests/agent-workflow.test.ts
  ```

### T10. AI 对话历史持久化仍分散在多个 route

- 证据：
  - `packages/server/src/http/routes/conversation.ts:77-87` 自己 append user/assistant。
  - `packages/server/src/http/routes/books.ts:148-154` onboard 自己 append。
  - `packages/server/src/http/routes/worldbook.ts:116-135` worldbook chat 自己 append。
  - `packages/server/src/http/routes/sidebar.ts:40,129,144,173,207,233,260` 手动资产 CRUD 也写 conversation。
  - `packages/server/src/ai/orchestrator/conversation-orchestrator.ts:739` 旧 `/note` 写 conversation。
- 问题：聊天记录、主动审查提示、隐藏正文、手动操作日志的边界不统一，容易出现新书读旧聊天、审查 prompt 进聊天、AI 正文进聊天。
- 任务：
  1. 新建唯一 conversation persistence service，所有 agent run 的可见消息由它写入。
  2. `agent-runner` 明确定义：visible user message 入库；hidden draft、active audit prompt、工具原始参数不入库。
  3. 手动 CRUD 日志使用独立 metadata kind，例如 `manual_asset_change`，不得混成 chat。
  4. 加跨书隔离测试：book A 的 conversation 不会进入 book B 的 agent context/history。
- 验收：
  ```powershell
  rg -n 'conversationsRepo\\.append' packages/server/src/http/routes packages/server/src/ai -g '*.ts'
  ```
  只允许统一 persistence service 和明确手动日志入口命中。

### T11. AI 工具层仍有直接写资产工具

- 证据：
  - `packages/server/src/ai/tools/state-tools.ts:176/198/223` 直接 create/pay foreshadowing、create timeline。
  - `packages/server/src/ai/tools/book-meta-tools.ts:179/205` 直接 create/update outline。
  - `packages/server/src/ai/tools/genre-section-tools.ts` 也包含 create/update/delete genre item 的执行工具，需要同样审计。
- 问题：旧 agent/tool 流如果还能调用这些工具，会绕过 staging、去重、validator，重复角色/重复大纲/半程污染都会复发。
- 任务：
  1. 工具层区分 `readTools` 和 `mutationProposalTools`。
  2. mutation tool 只返回 `StagedChange` proposal，不直接写 repo。
  3. executor-agent 负责把 proposal 统一提交到 workflow staging。
  4. workflow commit 前做去重、读回、失败回滚/failed 标记。
- 验收：
  ```powershell
  rg -n '\\.create\\(|\\.update\\(|\\.delete\\(|\\.pay\\(' packages/server/src/ai/tools -g '*.ts'
  ```
  写操作必须只出现在 proposal 构造或白名单 read-only 不可变路径。

### T12. `agent-runner` 已加错误终态，但缺统一 cancel/confirm/commit API

- 证据：
  - `packages/server/src/ai/orchestrator/agent-runner.ts` 会 yield `waiting_user` 和 `done committed:false`。
  - `packages/server/src/ai/orchestrator/workflow-staging.ts` 有 `begin/add/commit/discard`，但没有“用户确认后 commit 某个 run/change”的 HTTP API。
  - 旧 `/auto/cancel` 还在独立 route 中。
- 问题：UI 可以进入等待确认，但没有完整的“同意/打回重 roll/取消/修复”统一接口；于是旧按钮和旧 route 容易继续存在。
- 任务：
  1. 新增 `POST /api/books/:bookId/agent/runs/:runId/approve`。
  2. 新增 `POST /api/books/:bookId/agent/runs/:runId/reroll`、`/repair`、`/cancel` 或合并为 action endpoint。
  3. 所有 confirm_each/low_risk_auto 需要确认的任务都走该 API。
  4. UI 执行模式选择器、确认弹窗、主动审查修复按钮都接这个 API。
- 验收：模拟 `needsUserDecision:true` 后，点击同意能 commit staged change；点击取消会 discard，且不写库。

### T13. `executor-agent` 仍是极窄实现，收口后无法完成真实写作/创书/审查

- 证据：
  - 当前 `executor-agent` 主要只根据 `affectedEntities` 做有限 `character_upsert` staged change。
  - 旧的写正文、审查、修复、创书、世界书对话逻辑仍分散在 legacy orchestrator。
- 问题：如果现在强行下线旧模块，统一入口会变成“能跑流程但不能办事”的空壳。
- 任务：
  1. executor-agent 按 TaskContract 支持 `chapter_write`、`revision_candidate`、`outline_upsert`、`character_upsert`、`worldbook_upsert`、`audit_report`、`memory_update`。
  2. 章节正文生成复用旧 prompt/context，但只产出 staged `chapter_version`。
  3. 创书流程必须先 list/read 现有资产并去重，禁止重复创建同名角色/同章大纲。
  4. 主动审查可以产出 report-only 或 report-and-fix staged changes。
- 验收：用集成测试覆盖“新书写 5 章大纲”“整理重复角色”“写第 2 章保持第一人称”“主动全量审查并修复”。

### T14. `validator-agent` 和验收标准未完全回归 main-agent 的标准

- 证据：
  - `packages/server/src/ai/orchestrator/validator-agent.ts` 当前只做很轻的 staged change 检查。
  - `packages/server/src/ai/orchestrator/workflow-contract.ts` 虽有 acceptance criteria 检查 helper，但未成为所有 agent run 的强制验收。
- 问题：用户要求“第一个 agent 提标准，最后验收 agent 回归标准并检查其他东西”。当前链路还没完全做到。
- 任务：
  1. main-agent 输出标准化 `acceptanceCriteria`、`mustDo`、`mustNotDo`。
  2. validator-agent 必须逐条回归这些标准，输出 `userCriteria/processCriteria/domainCriteria`。
  3. 对写作任务增加固定领域标准：视角、文风、章节长度、章尾禁用待续式总结、章节大纲命中、连续性命中。
  4. 验证失败时只能 `repairable/needs_user/fail`，不得 commit。
- 验收：单测让第二章从第一人称漂到第三人称，validator 必须 fail 或 repairable。

### T15. 长篇上下文 builder 仍未成为唯一写作上下文入口

- 证据：
  - `packages/server/src/ai/context-builder/book-context.ts`、`builder.ts`、`snapshot.ts` 同时存在。
  - 旧 `conversation-orchestrator.ts`、`auto-mode.ts` 仍有内部上下文拼装。
  - `docs/ISSUE-2026-06-23-long-context-continuity.md` 已记录近 10 章全文、20-10 章摘要、20 章前总纲需求，但尚未成为强约束。
- 问题：这解释了“第一章第一人称对了，第二章又错了”的风险：写作链未保证读取应该读取的前文和大纲。
- 任务：
  1. 定义唯一 `buildLongformWriteContext`。
  2. 写作/改写/审查/修复/自动写全部调用它。
  3. 1M 模型使用高上下文预算：近 10 章全文、前 20-10 章章节小结、20 章以前总纲。
  4. prompt metadata 记录实际注入的章节全文、摘要范围、被省略原因。
- 验收：写第二章时日志/usage metadata 明确显示第一章全文已注入；超过 20 章时摘要降级可追踪。

### T16. 测试套件仍大量要求旧行为，必须迁移否则旧流程删不掉

- 证据：
  - 客户端：`conversation-writing-intent.test.tsx`、`phase9.test.tsx`、`selection-revise.test.tsx`、`onboard.test.tsx` 仍断言旧事件/旧 endpoint。
  - 服务端：`auto-mode.test.ts`、`books-routes.test.ts`、`revise-routes.test.ts`、`write-chapter-simple.test.ts`、`write-then-audit.test.ts`、`conversation-orchestrator.test.ts` 仍直接维护旧 orchestrator 或旧 HTTP 入口。
- 问题：测试是旧流程的“保命绳”。不迁测试，后续删除旧代码会被测试阻止。
- 任务：
  1. 把 endpoint 测试迁移到 `/agent/run` 和统一 confirm/commit API。
  2. 旧 helper 测试只保留 pure generation 逻辑，不允许断言 direct persistence。
  3. 旧 SSE 事件测试改成 agent event adapter 测试。
  4. 给所有 legacy 测试文件加迁移 issue 编号，逐步删除。
- 验收：
  ```powershell
  rg -n 'runConversation|runAutoMode|runNewBookConversation|writeWithAudit|writeChapterSimple|reviseSegment|auto_status|tool_call_start|chapter_write|acceptance_report|/auto|/onboard|/write-draft|/finalize|apply-revision|revise-segment' packages/server/tests packages/client/tests -g '*.ts' -g '*.tsx'
  ```
  只允许 deprecated helper 测试或明确迁移说明命中。

### T17. 静态护栏仍不够，不能阻止“新增一套流程”的坏习惯

- 证据：
  - 已有 `ai-routes-guard.test.ts`、`ai-entrypoints-guard.test.ts`、`legacy-trigger-guard.test.ts`，但当前仍能从源码扫到旧 orchestrator、旧工具写入、旧 SSE 类型、旧测试断言。
- 问题：只查 HTTP route 不够；新的旁路可能出现在 agent-runner、executor-agent、AI tools、client event parser、shared schema。
- 任务：
  1. 新增 `legacy-import-guard.test.ts`：HTTP route、agent-runner、executor-agent 禁止 import legacy orchestrator。
  2. 新增 `ai-tools-mutation-guard.test.ts`：AI tools 禁止直接 repo create/update/delete/pay。
  3. 新增 `agent-event-guard.test.ts`：`AgentRunEventSchema` 禁止旧事件。
  4. 新增 `client-ai-entrypoint-guard.test.ts`：前端 AI SSE 只允许 `/agent/run`，状态/手动 CRUD 白名单必须显式列出。
  5. 新增 `conversation-persistence-guard.test.ts`：AI route 不得各自 `conversationsRepo.append`。
- 验收：任意新增旧入口、旧事件、直接落库工具时，单测立刻失败。

### T18. 直接删除章节是手动 CRUD，但 AI 删除能力必须重新建模

- 证据：
  - `packages/server/src/http/routes/chapters.ts:129/152` 保留手动 DELETE。
  - `packages/server/src/ai/orchestrator/delete-chapter.ts` 会删除章节相关 timeline/foreshadowing 等资产。
  - `conversation-orchestrator.ts:578-603` 仍存在 `delete_chapters_from` 执行步骤。
- 问题：删除是 destructive，不能被普通聊天或旧计划执行分支触发。
- 任务：
  1. 手动 DELETE route 保留，但必须只由显式 UI 删除按钮调用。
  2. AI 删除建模为 `agent/run` destructive task，默认至少 `confirm_each`。
  3. 删除前生成 staged plan，列出将删除的章节、版本、摘要、timeline、foreshadowing。
  4. 用户确认后 commit；取消则 discard。
- 验收：普通聊天输入删除意图只产生 confirmation，不直接调用 `deleteChaptersFrom`。

---

## 2026-06-24 四次复核：按“当前工作树”重新归类的任务

> 这一节用于纠正前面部分过期证据。当前很多 HTTP route 已经改成 `runAgentWorkflow` wrapper，但 wrapper 之外仍然存在旧协议、旧持久化、旧测试保护网。后续修复时以本节为准：先分清“前端已迁”“服务端 wrapper 仍留”“旧模块仍能复活”“测试仍在保旧”。

### T19. 前端主入口大多已迁到 `/agent/run`，但文案、测试和兼容状态还没收干净

- 当前进度：
  - `packages/client/tests/components/phase9.test.tsx` 已改成 `/agent/run` 新事件流测试。
  - `packages/client/tests/components/slash-suggestions.test.tsx` 不再选择 `/auto`，只验证 slash 是普通文本快捷输入。
  - `packages/client/src/pages/settings.tsx` 不再显示 `/auto N` 文案。
  - 搜索 `packages/client/src packages/client/tests` 中 `/auto|auto_status|auto/cancel` 只剩负向护栏/负向断言。
- 当前证据：
  - `packages/client/src/components/conversation/conversation-pane.tsx:70` 默认 endpoint 已是 `/api/books/:bookId/agent/run`。
  - `packages/client/src/pages/onboard.tsx:99` 创书页 AI 对话已走 `/agent/run`，`/onboard-status` 与 `/onboard/skip` 是状态接口，不是 AI SSE。
  - `packages/client/src/components/editor/revise-preview.tsx:35` 选区改写已走 `/agent/run`。
  - `packages/client/src/components/editor/editor-pane.tsx:162/202` 写草稿和 finalize 按钮已走 `/agent/run`。
  - `packages/client/src/components/editor/editor-pane.tsx:382` 空状态仍提示 `/write`。
- 问题：
  - 用户看到 UI 文案仍会以为 slash command 是正式入口。
  - 测试里还在验证旧 `/auto`、旧 slash suggestion，导致后续删除旧路径会被测试拦住。
- 任务：
  1. 把 UI 文案从 `/auto N`、`/write` 改成自然语言引导，例如“让 AI 写下一章”“连续写 N 章”。
  2. `SlashSuggestions` 若保留，只能作为快捷输入，不得暗示它会绕过主工作流。
  3. `phase9.test.tsx` 删除旧 `/auto` 断言，迁移成 `/agent/run source:"auto"`。
  4. `slash-suggestions.test.tsx` 改为“只插入普通文本，不触发旧路由”的测试，或跟随产品决定移除。
- 验收：
  ```powershell
  rg -n '/auto|/write|/revise|/audit|/note|/recall|auto_status|auto/cancel' packages/client/src packages/client/tests -g '*.ts' -g '*.tsx'
  ```
  只允许非执行性快捷输入说明、状态接口白名单或迁移测试命中。

### T20. 服务端 route 已大量 wrapper 到 `runAgentWorkflow`，但仍保留旧 URL 作为正式 API 形态

- 当前证据：
  - `packages/server/src/http/routes/chapters.ts:69-71` 仍暴露 `/chapters/:no/write`、`/write-draft`、`/finalize`，内部 wrapper 到 `runAgentWorkflow`。
  - `packages/server/src/http/routes/auto.ts:27` 仍暴露 `/auto`，内部 wrapper 到 `runAgentWorkflow`。
  - `packages/server/src/http/routes/books.ts:120` 仍暴露 `/onboard`，内部 wrapper 到 `runAgentWorkflow`。
  - `packages/server/src/http/routes/worldbook.ts:99` 仍暴露 `/worldbook/chat`，内部 wrapper 到 `runAgentWorkflow`。
  - `packages/server/src/http/routes/revise.ts:20` 仍暴露 `/revise-segment`，内部 wrapper 到 `runAgentWorkflow`。
  - `packages/server/src/http/routes/revise.ts:60` 仍暴露 `/apply-revision`，目前返回旧接口下线语义。
- 问题：
  - 即使内部暂时走新 runner，外部 API 表面仍是多入口；新代码或测试很容易继续调用旧 URL。
  - usage、conversation persistence、staging repo 都在 wrapper 里各自创建，入口越多，统一语义越难保证。
- 任务：
  1. 短期：所有旧 AI URL 保留时必须显式标 `deprecated wrapper`，并在 guard 测试中白名单到期删除。
  2. 中期：前端和集成测试只调用 `/agent/run` 与后续 `/agent/runs/:runId/action`。
  3. 长期：旧 AI URL 统一返回 410 或只保留迁移期兼容，不作为文档入口。
  4. route 层不再各自创建 `createWorkflowStaging(createWorkflowRunsRepo(...))`，改由统一 agent service 建立 run。
- 验收：
  ```powershell
  rg -n 'app\\.post\\("/api/books/:bookId/(auto|onboard|worldbook/chat)|write-draft|finalize|revise-segment|apply-revision' packages/server/src/http/routes packages/server/tests -g '*.ts'
  ```
  除明确 deprecated wrapper 和迁移测试外，不应有生产调用。

### T21. 用量记录仍挂在各 route wrapper，不能覆盖所有模型调用边界

- 当前证据：
  - `packages/server/src/http/routes/auto.ts:59`、`books.ts:139`、`chapters.ts:58`、`conversation.ts:67`、`revise.ts:50`、`worldbook.ts:122` 各自包 `withUsageRecording`。
  - `packages/server/src/http/routes/agent.ts:39-43` 原生 `/agent/run` 只调用 `runAgentWorkflow`，没有在 route 中包 `withUsageRecording`。
  - `packages/server/src/ai/orchestrator/intent.ts:65/102` 直接 `generateText`，不经 `generateTextWithRetry` 或 usage recorder。
  - `packages/server/src/ai/orchestrator/audit-chapter.ts` 返回 usage，但由调用方决定是否落库。
  - `packages/server/src/ai/llm-call.ts` 会 yield `usage`，但非流式和结构化调用并不统一进入同一记账服务。
- 问题：
  - 用户觉得 API 调用量夸张时，当前账本只能统计部分 SSE usage event；缺少“哪个 agent/phase/prompt/context 花了多少”的完整 trace。
  - 原生 `/agent/run` 与旧 wrapper 的用量口径可能不一致。
  - 如果 main-agent、executor-agent、validator-agent 后续都模型化，必须按 phase 记录，否则无法知道钱花在哪里。
- 任务：
  1. 把 usage recording 下沉到统一 LLM gateway，而不是分散在 route wrapper。
  2. 每次模型调用必须记录 `runId`、`bookId`、`source`、`agentPhase`、`taskType`、`modelRole`、`chapterNo?`、`promptTokens`、`completionTokens`、`cachedTokens`、`reasoningTokens`、`costUsd`。
  3. `/agent/run` 原生入口必须和兼容 wrapper 同口径记账。
  4. 对无 usage 的供应商请求记录 `usageMissing:true`，不能静默当作 0。
  5. usage 页面增加按 run/phase 聚合，能回答“一次写章到底调用了几个模型”。
- 验收：
  ```powershell
  rg -n 'generateText\\(|streamText\\(|doGenerate|doStream|withUsageRecording' packages/server/src -g '*.ts'
  ```
  每个模型调用必须经过统一 gateway 或在 guard 白名单中说明原因。

### T22. 旧 `conversation-orchestrator` 已不一定被 route 调用，但仍是最大复活源

- 当前证据：
  - `packages/server/src/ai/orchestrator/conversation-orchestrator.ts:8-11` 仍 import `writeWithAudit`、`auditChapter`、`recordChapterState`。
  - `conversation-orchestrator.ts:109/174/419` 仍能执行记录状态、写章、审查。
  - `conversation-orchestrator.ts:719` 仍调用 `parseSlashCommand`。
  - `conversation-orchestrator.ts:739` `/note` 仍直接写 `conversationsRepo.append`。
  - `packages/server/tests/unit/ai/orchestrator/conversation-orchestrator.test.ts` 仍大量测试 `runConversation`、`execution_step`、`acceptance_report`、`chapter_write`、`record_chapter_state`。
- 问题：
  - 即使 HTTP route 当前不调用它，只要这个模块还在生产源码并有测试维护，就会成为未来“顺手 import 一下”的旧流程入口。
- 任务：
  1. 文件顶部加 `@deprecated legacy workflow - do not import from routes/agent-runner/executor-agent`。
  2. 把能复用的上下文、prompt、纯生成逻辑移到 pure helper。
  3. 删除或迁移 `conversation-orchestrator.test.ts` 中所有执行写作/审查/状态记录的测试。
  4. 新增 import guard：`packages/server/src/http/routes`、`agent-runner.ts`、`executor-agent.ts` 禁止 import `conversation-orchestrator.ts`。
- 验收：
  ```powershell
  rg -n 'runConversation|conversation-orchestrator|execution_step|acceptance_report|chapter_write|record_chapter_state' packages/server/src packages/server/tests -g '*.ts'
  ```
  只允许 deprecated 说明、迁移说明或新 guard 测试命中。

### T23. 章节写作旧模块仍然“生成即落库”，必须拆成 pure generation

- 当前证据：
  - `packages/server/src/ai/orchestrator/write-chapter.ts:104-109` 直接 `saveVersion` + `chapterFiles.save`。
  - `packages/server/src/ai/orchestrator/repair-chapter.ts:96-101` 直接保存修复版本。
  - `packages/server/src/ai/orchestrator/write-with-audit.ts` 串联 `writeChapterSimple -> auditChapter -> repairChapter`，并发旧 tool events。
  - `packages/server/tests/integration/write-chapter-simple.test.ts`、`write-then-audit.test.ts` 仍把这些旧落库行为当主流程保护。
- 问题：
  - 半程失败记录一半、正文泄漏到错误通道、validator/staging 被绕过，都来自这些模块的落库契约。
- 任务：
  1. 拆出 `generateChapterDraft`：只返回正文、usage、diagnostics，不保存。
  2. 拆出 `generateChapterRepair`：只返回修复正文，不保存。
  3. `writeWithAudit` 若保留，只能变成 legacy adapter，不允许被新 agent import。
  4. 新 agent 写章只能产出 staged `chapter_version`，由 validator 通过后 commit。
- 验收：
  ```powershell
  rg -n 'chaptersRepo\\.saveVersion|chapterFiles\\.save|tool_call_start|tool_call_end' packages/server/src/ai/orchestrator/write-chapter.ts packages/server/src/ai/orchestrator/repair-chapter.ts packages/server/src/ai/orchestrator/write-with-audit.ts
  ```
  pure generation 文件不得命中保存和旧事件。

### T24. AI tools 里仍有直接 mutation，创书/整理角色重复会复发

- 当前证据：
  - `packages/server/src/ai/tools/book-meta-tools.ts:125/159` 直接 create/update character。
  - `book-meta-tools.ts:179/205` 直接 create/update outline。
  - `packages/server/src/ai/tools/state-tools.ts:125/141` 直接 create/update character state。
  - `state-tools.ts:176/198/223` 直接 create/pay foreshadowing、create timeline。
  - `packages/server/src/ai/tools/worldbook-tools.ts:32/46/57` 直接 create/update/delete worldbook。
- 问题：
  - 只要 executor 或旧 agent 能拿到这些工具，就会绕过 staged changes、去重、validator 和用户确认。
  - “宋玉/小佑重复创建三次”这类问题会继续出现。
- 任务：
  1. 工具层拆成 `readTools` 和 `proposalTools`。
  2. mutation 工具只返回 `{ proposedChange }`，不直接调用 repo。
  3. executor 在创建角色/大纲前必须 read/list 现有资产并做名称归一化去重。
  4. workflow commit 再做最后一次去重校验，防并发重复。
- 验收：
  ```powershell
  rg -n '\\.create\\(|\\.update\\(|\\.delete\\(|\\.pay\\(' packages/server/src/ai/tools -g '*.ts'
  ```
  mutation 工具不得直接写 repo，除非文件名和注释明确是 deprecated legacy tool。

### T25. `/agent/run` 缺少统一后续动作 API，导致“同意/打回/修复/取消”只能在前端假装

- 当前证据：
  - `packages/client/src/components/conversation/execution-confirmation-card.tsx` 有“同意执行 / 打回重 roll / 取消”按钮。
  - `packages/client/src/components/conversation/conversation-pane.tsx:329-331` 当前同意逻辑是重新发送上一条消息，并覆盖 `executionMode:"trusted_auto"`。
  - `packages/server/src/ai/orchestrator/workflow-staging.ts` 有 `commit(runId)`、`discard(runId)`，但没有 HTTP action route。
  - `packages/server/src/http/routes/auto.ts:69-75` `/auto/cancel` 只是旧取消占位。
- 问题：
  - 用户点同意时不是 approve 当前 staged run，而是重新跑一次 agent，容易再次弹窗、重复调用模型、重复创建资产。
- 任务：
  1. 新增统一 action endpoint：`POST /api/books/:bookId/agent/runs/:runId/action`。
  2. 支持 `approve`、`reroll`、`repair`、`cancel`。
  3. 前端确认卡必须绑定 `runId`，不能重发上一条自然语言消息。
  4. action endpoint 必须校验 bookId/runId/source/phase，防止跨书提交。
- 验收：
  - 触发 `needsUserDecision:true` 后，点击同意不产生新的 main-agent 调用，只 commit 原 staged changes。
  - 点击取消会 discard staged changes，刷新后不再显示可提交。

### T26. shared schema 仍允许旧 action/event 名称作为一等类型

- 当前证据：
  - `packages/shared/src/types/sse-events.ts` 仍包含 `text_delta`、`tool_call_start`、`tool_call_end`、`auto_status`、`intent`、`workflow_mode`、`execution_step`、`acceptance_report`。
  - `packages/shared/src/types/agent-workflow.ts` 的 confirmation action 仍可出现 `{ type: "chapter_write" }`，测试也在使用。
  - `packages/shared/tests/agent-workflow.test.ts:123` 仍测试 `acceptance_report`。
  - `packages/shared/tests/slash-commands.test.ts` 仍把 `/auto`、`/续写`、`/查找` 解析成 command。
- 问题：
  - 类型层没有把 legacy 和 agent-run 隔离，任何前端/服务端代码都能理直气壮消费旧事件。
- 任务：
  1. `AgentRunEventSchema` 只允许新事件：`agent_phase`、`main_output`、`reasoning_delta`、`execution_plan`、`validation_report`、`repair_plan`、`confirmation_required`、`usage`、`error`、`done`。
  2. `LegacySseEventSchema` 单独导出，标 deprecated，不被 conversation/onboard/editor 当前运行态引用。
  3. `AgentRunRequestSchema` 改 discriminated union，去掉 `target.passthrough()`。
  4. slash command 类型从 shared 主导出中移除，或标为 UI autocomplete only。
- 验收：
  ```powershell
  rg -n 'tool_call_start|tool_call_end|auto_status|intent|workflow_mode|execution_step|acceptance_report|parseSlashCommand|SLASH_COMMANDS' packages/shared/src packages/shared/tests -g '*.ts'
  ```
  只允许 legacy schema/test 或 autocomplete-only 说明命中。

### T27. 服务端集成测试仍是旧流程最大保护网

- 当前进度：
  - `packages/server/tests/integration/auto-mode.test.ts` 已从旧 `/auto` 状态机测试迁为 `/agent/run source:auto` + deprecated wrapper 测试。
  - `packages/server/tests/unit/ai/orchestrator/auto-retry.test.ts` 已删除，不再直接维护 `runAutoMode`。
  - 剩余旧保护网仍包括：`books-routes.test.ts`、`worldbook-routes.test.ts`、`revise-routes.test.ts`、`user-journey.test.ts`、`write-chapter-simple.test.ts`、`write-then-audit.test.ts` 等。
- 当前证据：
  - `packages/server/tests/integration/books-routes.test.ts` 仍测试 `/onboard` 并期待 `execution_step`、`acceptance_report`、`tool_call_start`。
  - `packages/server/tests/integration/worldbook-routes.test.ts` 仍请求 `/worldbook/chat` 并期待 `tool_call_start/tool_call_end`。
  - `packages/server/tests/integration/revise-routes.test.ts` 仍请求 `/revise-segment`、`/apply-revision`。
  - `packages/server/tests/integration/user-journey.test.ts` 仍请求 `/write-draft`、`/finalize`，并期待 `chapter_audit/hard_fact_gate/record_chapter_state` tool events。
  - `packages/server/tests/integration/write-chapter-simple.test.ts`、`write-then-audit.test.ts` 仍保护 `writeChapterSimple/writeWithAudit`。
- 问题：
  - 只要这些测试还在，删除旧流程就会被迫回滚。
- 任务：
  1. 把 HTTP 集成测试迁到 `/agent/run` + `agent/runs/:runId/action`。
  2. 原旧 route 测试只保留“deprecated wrapper 转换到新 event”或“410 gone”。
  3. `writeChapterSimple/writeWithAudit` 测试迁到 pure generator 和 staging commit 测试。
  4. `user-journey.test.ts` 重写为新用户旅程：创书、设置文风、写 5 章、主动审查、确认修复、查看 usage。
- 验收：
  ```powershell
  rg -n '/auto|/onboard|worldbook/chat|revise-segment|apply-revision|write-draft|finalize|tool_call_start|tool_call_end|auto_status|acceptance_report|execution_step|writeWithAudit|writeChapterSimple' packages/server/tests -g '*.ts'
  ```
  只允许 deprecated wrapper/legacy adapter 测试命中。

### T28. 前端运行态已忽略部分旧事件，但测试里仍需要明确“旧事件不会改变新状态”

- 当前进度：
  - `phase9.test.tsx` 已不再发送 `auto_status`，改为 `agent_phase + execution_plan`。
  - `conversation-tool-feedback.test.tsx` 继续作为 legacy `tool_call_end` ignored 的防回归测试。
  - `selection-revise.test.tsx` 继续保护 legacy `text_delta` 不会被当候选正文。
- 当前证据：
  - `packages/client/tests/components/conversation-tool-feedback.test.tsx` 已转为“旧 `tool_call_end` 被忽略”的防回归测试。
  - `packages/client/tests/components/selection-revise.test.tsx` 已覆盖“不把 legacy `text_delta` 当候选”。
  - `packages/client/tests/components/execution-confirmation-card.test.tsx` 仍用 `actions: [{ type: "chapter_write" }]`。
- 问题：
  - 前端测试目前一半在防旧协议，一半还在保护旧协议。
- 任务：
  1. `phase9.test.tsx` 改为新 agent auto flow：`agent_phase/execution_plan/validation_report/done`。
  2. confirmation card 的 action 展示从旧 `chapter_write` 改成 staged change 摘要，例如 `chapter_version`。
  3. 保留 legacy event ignore 测试，但不要在正常运行态测试里发送旧事件。
- 验收：
  ```powershell
  rg -n 'auto_status|tool_call_start|tool_call_end|chapter_write|record_chapter_state|text_delta|acceptance_report' packages/client/tests -g '*.ts' -g '*.tsx'
  ```
  只能出现在“legacy event ignored”测试中。

### T29. `workflow-staging` 是唯一允许落库的 AI commit 层，但需要补事务和失败回滚

- 当前证据：
  - `packages/server/src/ai/orchestrator/workflow-staging.ts:82-174` 统一 apply staged changes。
  - `workflow-staging.ts:93-98` character upsert 有简单同名去重。
  - `workflow-staging.ts:109-115` chapter_version 仍先 `saveVersion` 再 `chapterFiles.save`。
  - `workflow-staging.ts:128-171` summary/audit/foreshadowing/timeline/outline/worldbook 分别直接落库。
- 问题：
  - 即便统一到 staging，如果 commit 没事务，仍会出现“DB 版本已写、文件保存失败”或多资产部分成功。
  - 当前 commit 只能逐 change 标记 committed，缺少 run-level 原子语义。
- 任务：
  1. `commit(runId)` 使用 workspace DB transaction 包裹所有 DB 操作。
  2. 文件写入与 DB 事务的顺序要有补偿策略：文件失败不得留下已提交 version；或先写临时文件再事务内切换。
  3. 每个 change 失败要记录 error，run verdict 必须 failed，`done.committed` 必须 false。
  4. commit 后 read-back 验证：章节文件、repo 版本、资产实体都能重新读到。
- 验收：
  - 模拟 `chapterFiles.save` 抛错后，`chapter_versions` 不新增，run failed。
  - 模拟第 2 个 staged asset 失败后，第 1 个 asset 不应半提交，或必须有明确 partial failure 标记且前端显示。

### T30. 主动审查、隐藏正文、聊天历史三者边界还需要产品级验收测试

- 当前证据：
  - `packages/server/src/http/routes/conversation.ts` 会把 user message 和 assistant reply 写入 chat。
  - `books.ts`、`worldbook.ts` 也各自写 onboard/worldbook conversation。
  - `sidebar.ts` 手动资产 CRUD 会写 conversation log。
  - 用户明确要求主动审查 prompt 不进聊天，只展示“触发了主动审查”和 AI 进度。
- 问题：
  - 当前没有统一的“可见消息/隐藏 draft/工具参数/主动审查 prompt/手动日志”分类契约。
- 任务：
  1. 定义 conversation message kind：`user_visible`、`assistant_visible`、`agent_progress_summary`、`manual_asset_change`、`system_note`，并明确哪些进普通聊天。
  2. 主动审查入库内容只能是“触发了主动审查：scope/categories”，不能保存原始审查 prompt。
  3. 写正文和改写候选默认 hidden，不进入 chat content。
  4. agent context builder 读取历史时按 bookId 和 kind 过滤，不能跨书、不能把 hidden draft 当普通对话。
- 验收：
  - 新建 book B 后，book A 的 conversation 不进入 B 的 context。
  - 触发全量审查后，conversation history 只出现触发摘要，不出现原始 prompt。
  - 写章完成后，聊天区不显示正文全文。

### T31. 工作流进度 UI 与后端 phase 还没统一到“全流程未完就持续运行”

- 当前证据：
  - `conversation-pane.tsx` 只按事件更新 local `workflowStages`。
  - `onboard.tsx` 有自己的 `PHASE_LABELS` 和 stages。
  - `streaming-message.tsx`、`message.tsx` 分别渲染 workflow stages。
  - 服务端 `agent-runner.ts` 输出 phase，但旧 wrapper 和旧 tests 仍混入其他状态概念。
- 问题：
  - 用户反馈“全流程还没完就转圈圈表示才行”。当前前端没有从 run 状态持久化恢复，也没有区分 stream 结束、等待确认、已失败、已提交。
- 任务：
  1. 后端 `done` 强制包含 `runId`、`committed`、`needsUserDecision`、`finalStatus`。
  2. 前端只用 run finalStatus 决定停止转圈；stream abort、网络断开不能被当成成功。
  3. `waiting_user` 显示等待用户，不显示已完成。
  4. 页面刷新后通过 run status API 恢复最近 waiting/running run。
- 验收：
  - validator 失败时 UI 停在失败/可修复，不刷新章节。
  - confirmation_required 后 UI 停在等待确认，不自动重发。
  - 网络断开后显示可重试/未知，不显示成功。

---

## 建议执行顺序

1. R2、C5-C6：先修 `agent-runner/workflow-staging`，否则所有收口都会变成“统一入口但错误提交”。
2. R1、R11：补 shared schema，让 mode/scope/range 成为结构化字段，不再靠 message 猜。
3. R5-R10：前端和 shared SSE 协议只认新 Agent event，停止旧事件驱动 UI。
4. R3-R4、R13-R14：隔离旧 orchestrator 和 trigger tools，禁止普通聊天触发写作/删除/审查。
5. R12：统一聊天历史持久化，处理主动审查 prompt、隐藏正文、跨书隔离。
6. C1-C4、D1-D3：补完整 main/executor/validator/repair，并把 AI 写入全部改为 staging。
7. R15-R16、H1-H5：迁移测试并加静态护栏，防止以后继续新增旁路。
8. R17、F1-F4：统一长篇上下文和章节级大纲注入，解决连续性和“不按大纲走”。

---

## 2026-06-24 当前真实识别快照：旧流程残留逐项 task

> 本节按当前工作树重新扫描，不沿用上方历史进度判断。结论：HTTP AI mutation 入口大多已经改为调用 `runAgentWorkflow` wrapper，但生产代码里仍保留可复活的旧 orchestrator、旧 trigger 协议、旧 SSE 类型、旧直接落库工具、旧测试保护网。后续修复必须逐项关闭，不能再新增“兼容旧逻辑”的旁路。

### 扫描命令

```powershell
rg -n 'runAgentWorkflow|runConversation|runAutoMode|runNewBookConversation|runWorldbookChat|writeWithAudit|writeChapterSimple|reviseSegment|auditChapter|repairChapter|recordChapterState' packages/server/src/http/routes -g '*.ts'
rg -n 'makeTriggerTools|TriggerAction|__action|write_next_chapter|rewrite_chapter|delete_chapters|audit_chapter|自动写作请用|parseSlashCommand|SLASH_COMMANDS' packages/server/src packages/server/tests packages/shared/src packages/client/src packages/client/tests -g '*.ts' -g '*.tsx'
rg -n 'chaptersRepo\.saveVersion|chapterFiles\.save|saveAudit\(|saveSummary\(|readerIssuesRepo\.create|charactersRepo\.create|charactersRepo\.update|outlineRepo\.create|outlineRepo\.update|foreshadowingRepo\.create|timelineRepo\.create|worldbookRepo\.create|worldbookRepo\.update|worldbookRepo\.delete' packages/server/src/ai packages/server/src/http/routes -g '*.ts'
rg -n 'conversation\?mode=chat|/auto|auto/cancel|/onboard|worldbook/chat|revise-segment|apply-revision|write-draft|finalize|tool_call_start|tool_call_end|chapter_write|chapter_audit|record_chapter_state|auto_status|acceptance_report|execution_step|text_delta|startSseStream\(|fetch\(' packages/client/src packages/client/tests -g '*.ts' -g '*.tsx'
rg -n 'runConversation|runAutoMode|runNewBookConversation|runWorldbookChat|writeWithAudit|writeChapterSimple|auditChapter|repairChapter|recordChapterState|reviseSegment|streamLlm|generateText|generateObject|streamText|doStream|doGenerate' packages/server/src packages/server/tests -g '*.ts'
```

### 当前确认事实

- 服务端 route 层当前已看到 `agent.ts`、`conversation.ts`、`chapters.ts`、`auto.ts`、`books.ts`、`worldbook.ts`、`revise.ts` 都 import 并调用 `runAgentWorkflow`。
- 旧 `auto-mode.ts` 已删除，但部分文档和测试说明仍提到它，需要清理成历史记录或删除。
- `conversation-orchestrator.ts` 仍 import 不存在的 `makeTriggerTools` / `TriggerAction`，当前会导致 server typecheck 失败；同时它仍包含完整旧 trigger 中断执行逻辑。
- 前端运行入口基本改为 `/agent/run`，但仍有旧协议 ignore 测试、旧 command suggestion、旧 `/write` 文案、确认卡旧 action 类型。
- AI 写入层仍有大量直接 repo mutation，尤其是 tools 和旧章节 orchestrator；即使入口统一，只要 executor 复用这些模块，仍会半程落库或重复创建资产。

### Task A：先修当前编译失败的旧 trigger import

- 文件：`packages/server/src/ai/orchestrator/conversation-orchestrator.ts`
- 状态：已完成核心修复。`makeTriggerTools` / `TriggerAction` import、工具注入、`__action` 中断分支、`agenticChatWithTriggers` 调用已移除；`/auto N` 旧提示也已改成统一 Agent 工作流提示。`server typecheck` 与 `legacy-trigger-guard` 已通过。
- 当前证据：
  - 第 20 行仍有 `makeTriggerTools`、`TriggerAction` import。
  - 第 317 行仍 `Object.assign(tools, makeTriggerTools({ handle }))`。
  - 第 363-417 行仍检测 `__action` 并执行 `write_next_chapter/rewrite_chapter/delete_chapters/audit_chapter`。
- 问题：
  - `book-tools.ts` 已删除 trigger exports，导致 `pnpm --filter @scribe/server typecheck` 失败。
  - 这是“普通聊天调用工具后突然写正文/删章/审查”的旧根因之一，不能用重新导出 trigger 来修。
- 任务：
  1. 删除 `makeTriggerTools` / `TriggerAction` import。
  2. 删除 `makeTriggerTools` 注入。
  3. 删除 `__action` 检测和 switch 执行分支。
  4. `agenticChatWithTriggers` 改名或降级为普通 `agenticChat`，只允许普通对话工具，不允许重 mutation。
  5. `/help`、`/note`、`/recall` 等 slash 也不能在该 orchestrator 内形成写作旁路。
- 验收：
  ```powershell
  pnpm --filter @scribe/server typecheck
  pnpm --filter @scribe/server exec vitest run tests/unit/ai/orchestrator/legacy-trigger-guard.test.ts
  rg -n 'makeTriggerTools|TriggerAction|__action|write_next_chapter|rewrite_chapter|delete_chapters|audit_chapter|自动写作请用' packages/server/src/ai/orchestrator/conversation-orchestrator.ts
  ```
  生产文件应无命中，`audit-persist.ts` 注释里的 `audit_chapter` 可另行改名清理。
- 已验证：
  ```powershell
  pnpm --filter @scribe/server typecheck
  pnpm --filter @scribe/server exec vitest run tests/unit/ai/orchestrator/legacy-trigger-guard.test.ts
  pnpm --filter @scribe/server exec vitest run tests/unit/http/ai-routes-guard.test.ts tests/unit/ai/orchestrator/agent-runner.test.ts tests/integration/auto-mode.test.ts
  ```
  三组命令均通过。

### Task B：把旧 `conversation-orchestrator` 从生产可用路径里隔离

- 文件：
  - `packages/server/src/ai/orchestrator/conversation-orchestrator.ts`
  - `packages/server/tests/unit/ai/orchestrator/conversation-orchestrator.test.ts`
- 状态：部分完成。`runConversation` 已不再解析 slash command，不再发 `command_explicit`，不再调用旧 `plannedChapterWriteFlow/plannedAuditFlow/plannedDeleteFlow`，不再从 `/note` 直接 `conversationsRepo.append`。文件内未触达的 `planned*` 重流程源码也已删除。`conversation-orchestrator.test.ts` 的 active slash 测试已改为“slash-like 输入仍走 agentic、不直接落 note/recall/revise canned 分支”的防回归测试。
- 当前证据：
  - 仍调用 `writeWithAudit`、`auditChapter`、`recordChapterState`。
  - 仍发 `tool_call_start/tool_call_end`、`execution_step`、`acceptance_report`。
  - 仍有 `parseSlashCommand` 分支，`/note` 直接写 `conversationsRepo.append`。
- 问题：
  - 即使 HTTP route 暂不调用，模块仍在生产源码里，有测试维护，后续很容易被重新 import。
- 任务：
  1. 文件顶部标 `@deprecated legacy workflow`。
  2. 新增 import guard：`packages/server/src/http/routes`、`agent-runner.ts`、`executor-agent.ts`、`main-agent.ts` 禁止 import `conversation-orchestrator`。
  3. 迁移或删除 `conversation-orchestrator.test.ts` 中保护写章/审查/记录状态的测试。
  4. 可复用的 recall/context/prompt helper 移到纯 helper，不能保留执行写入职责。
- 验收：
  ```powershell
  rg -n 'runConversation|conversation-orchestrator|writeWithAudit|recordChapterState|execution_step|acceptance_report|chapter_write|record_chapter_state' packages/server/src packages/server/tests -g '*.ts'
  ```
  只允许 deprecated 文件、迁移说明、负向 guard 测试命中。
- 已验证：
  ```powershell
  pnpm --filter @scribe/server typecheck
  pnpm --filter @scribe/server exec vitest run tests/unit/ai/orchestrator/conversation-orchestrator.test.ts tests/unit/ai/orchestrator/legacy-trigger-guard.test.ts tests/unit/http/ai-routes-guard.test.ts tests/unit/ai/orchestrator/agent-runner.test.ts tests/integration/auto-mode.test.ts
  rg -n 'parseSlashCommand|SLASH_COMMANDS|command_explicit|plannedChapterWriteFlow|plannedAuditFlow|plannedDeleteFlow|delete_chapters_from|writeWithAudit|auditChapter|persistAuditResult|recordChapterState|buildArchiveSummary|recallChapters|conversationsRepo\.append|/auto|/write' packages/server/src/ai/orchestrator/conversation-orchestrator.ts packages/server/tests/unit/ai/orchestrator/legacy-trigger-guard.test.ts
  ```
  当前 `conversation-orchestrator.ts` 无上述旧重流程命中；搜索命中只剩 guard 测试断言。

### Task C：清理 shared slash command 的“命令即意图”旧模型

- 文件：
  - `packages/shared/src/slash-commands.ts`
  - `packages/client/src/components/conversation/slash-suggestions.tsx`
  - `packages/server/src/ai/orchestrator/intent.ts`
- 状态：已完成 shared/frontend 主体迁移。`packages/shared/src/slash-commands.ts` 已从“命令解析器”改为“slash suggestions”，删除 `parseSlashCommand` / `SlashCommandId` / 命令执行语义，改为导出 `SLASH_SUGGESTIONS` 和 `matchSlashSuggestions`；`packages/client/src/components/conversation/slash-suggestions.tsx` 已改为消费 `insertText` 自然语言模板，不再向输入框回填命令；新增 `packages/shared/tests/slash-suggestions.test.ts` 和改写 `packages/client/tests/components/slash-suggestions.test.tsx` 以防回到命令语义。`intent.ts` 的旧注释/类型仍待清。
- 当前证据：
  - shared 仍定义 `/write`、`/auto`、`/rewrite`、`/revise`、`/audit`、`/recall`、`/note`。
  - 服务端旧 intent 注释仍说 `command_explicit` 由 `parseSlashCommand` 在分类前判定。
  - 前端 slash suggestion 仍从 shared 导出 `SLASH_COMMANDS`。
- 问题：
  - 用户明确要求“不再有任何正则/命令直接触发，全部经过完整工作流”。slash 可以作为输入快捷，但不能决定执行链。
- 任务：
  1. `parseSlashCommand` 从服务端执行路径移除。
  2. slash suggestion 降级为“插入自然语言模板”，例如“请帮我写下一章”，不输出 command id。
  3. shared 文档和测试明确 slash 仅 UI autocomplete，不是意图路由。
  4. 删除 `/auto N`、`/write` 等会暗示旧入口的 UI 文案。
- 验收：
  ```powershell
  rg -n 'parseSlashCommand|command_explicit|/auto|/write|/rewrite|/revise|/audit|/recall|/note' packages/server/src packages/client/src packages/shared/src -g '*.ts' -g '*.tsx'
  ```
  服务端执行路径不得命中；前端只允许“插入提示语”的 autocomplete 命中。
- 已验证：
  ```powershell
  pnpm --filter @scribe/shared exec vitest run tests/slash-suggestions.test.ts
  pnpm --filter @scribe/client exec vitest run tests/components/slash-suggestions.test.tsx
  ```
  两组测试均通过。

### Task D：统一 Agent run 后续动作，不再用“重发上一条消息”模拟同意

- 文件：
  - `packages/server/src/http/routes/agent.ts`
  - `packages/server/src/ai/orchestrator/workflow-staging.ts`
  - `packages/client/src/components/conversation/conversation-pane.tsx`
  - `packages/client/src/components/conversation/execution-confirmation-card.tsx`
- 当前证据：
  - `workflow-staging.ts` 有 `commit(runId)` / `discard(runId)`。
  - route 层没有 `POST /api/books/:bookId/agent/runs/:runId/action`。
  - 前端确认卡此前逻辑是重新发送上一条消息并改 `executionMode`，会导致重复 main-agent 调用。
- 问题：
  - 用户“一直点同意一直弹”的根因是没有 approve 当前 run 的 action API。
- 任务：
  1. 新增 `agent/runs/:runId/action`，支持 `approve`、`reroll`、`repair`、`cancel`。
  2. `approve` 只提交已有 staged changes，不能再次调用 main-agent。
  3. `reroll` 创建新 run，但必须关联原 run，并废弃原 staged changes。
  4. `repair` 只调用 repair-agent，输入 validator 问题和原 staged changes。
  5. `cancel` 调 `discard(runId)`，并持久化 finalStatus。
- 验收：
  - 点击同意不会新增模型调用量。
  - 点击取消后刷新页面，原 staged changes 不可再提交。
  - 点击修复后前端展示 repair phase，而不是重新走完整对话。

### Task E：AI 写入只允许 staging commit，旧生成模块必须拆 pure

- 文件：
  - `packages/server/src/ai/orchestrator/write-chapter.ts`
  - `packages/server/src/ai/orchestrator/repair-chapter.ts`
  - `packages/server/src/ai/orchestrator/write-with-audit.ts`
  - `packages/server/src/ai/orchestrator/audit-persist.ts`
  - `packages/server/src/ai/orchestrator/record-state.ts`
- 当前证据：
  - `write-chapter.ts` 直接 `chaptersRepo.saveVersion` + `chapterFiles.save`。
  - `repair-chapter.ts` 直接保存修复版本。
  - `audit-persist.ts` 直接 `saveAudit` / `saveSummary` / `readerIssuesRepo.create`。
  - `record-state.ts` 直接更新 outline summary、写 reader issue。
- 问题：
  - 统一入口后如果 executor 复用这些模块，仍会出现“没跑完全程但记录一半”。
- 任务：
  1. 拆 `generateChapterDraft`：只返回正文、usage、diagnostics，不落库。
  2. 拆 `generateChapterRepair`：只返回修复正文和 diagnostics，不落库。
  3. audit/summary/state 只生成 staged changes。
  4. 旧 `writeWithAudit` 标 deprecated，不允许新 executor import。
  5. 新增 staging guard，禁止 AI orchestrator 直接 save version/file/audit/summary。
- 验收：
  ```powershell
  rg -n 'chaptersRepo\.saveVersion|chapterFiles\.save|saveAudit\(|saveSummary\(|readerIssuesRepo\.create' packages/server/src/ai/orchestrator -g '*.ts'
  ```
  只允许 `workflow-staging.ts` 或 deprecated legacy adapter 命中。

### Task F：AI tools 直接 mutation 改为 proposal tools，解决重复角色/资产

- 文件：
  - `packages/server/src/ai/tools/book-meta-tools.ts`
  - `packages/server/src/ai/tools/state-tools.ts`
  - `packages/server/src/ai/tools/worldbook-tools.ts`
- 当前证据：
  - `book-meta-tools.ts` 直接 create/update character 和 outline。
  - `state-tools.ts` 直接 create/update character state，create foreshadowing/timeline。
  - `worldbook-tools.ts` 直接 create/update/delete worldbook。
- 问题：
  - 创书聊天或执行 agent 一旦拿到这些工具，就可能重复创建角色和大纲，绕过去重、validator、用户确认。
- 任务：
  1. 拆 read tools：list/get/search 只读。
  2. 拆 proposal tools：返回 `StagedChange` 或 `proposedChange`，不写 repo。
  3. executor 在 proposal 前必须读取现有资产并做归一化匹配。
  4. workflow commit 再做名称/别名/章号二次去重。
- 验收：
  ```powershell
  rg -n '\.create\(|\.update\(|\.delete\(' packages/server/src/ai/tools -g '*.ts'
  ```
  mutation tools 不得直接写 repo；只读工具和 deprecated 文件需明确标注。

### Task G：shared SSE schema 拆新旧协议

- 文件：
  - `packages/shared/src/types/sse-events.ts`
  - `packages/shared/tests/agent-workflow.test.ts`
- 当前证据：
  - 一个 `SseEventSchema` 同时包含 `text_delta`、`tool_call_start`、`tool_call_end`、`auto_status`、`intent`、`workflow_mode`、`execution_step`、`acceptance_report`、`agent_phase`、`validation_report`、`done`。
- 问题：
  - 类型层没有阻止新 UI 继续消费旧事件。
- 任务：
  1. 新增 `AgentRunEventSchema`，只允许新 agent events。
  2. `LegacySseEventSchema` 单独导出并标 deprecated。
  3. `/agent/run` route 只能发送 `AgentRunEventSchema`。
  4. 前端 conversation/onboard/editor 只解析 AgentRunEvent。
- 验收：
  ```powershell
  rg -n 'tool_call_start|tool_call_end|auto_status|intent|workflow_mode|acceptance_report|text_delta' packages/shared/src packages/client/src/components packages/client/src/pages/onboard.tsx -g '*.ts' -g '*.tsx'
  ```
  只允许 legacy adapter 或 ignore 测试命中。

### Task H：前端旧协议残留改成明确 ignore，不再作为主流程 UI

- 文件：
  - `packages/client/src/components/conversation/conversation-pane.tsx`
  - `packages/client/src/components/conversation/message.tsx`
  - `packages/client/src/components/conversation/streaming-message.tsx`
  - `packages/client/src/components/editor/revise-preview.tsx`
  - `packages/client/src/components/editor/editor-pane.tsx`
  - `packages/client/tests/components/execution-confirmation-card.test.tsx`
- 当前证据：
  - 前端主入口已基本用 `/agent/run`。
  - 测试仍出现 `tool_call_end` ignore、`text_delta` ignore、`chapter_write` action。
  - `editor-pane.tsx` 仍显示“或在左侧对话框输入 /write 让 AI 写第一章”。
- 问题：
  - 旧协议虽然不一定驱动成功刷新，但 UI 和测试还在给旧概念留位置。
- 任务：
  1. 所有正常流程测试改用 `agent_phase/execution_plan/validation_report/done`。
  2. legacy event 测试命名必须包含 `legacy ignored`，防止误以为是主流程。
  3. confirmation card action 从 `chapter_write` 改为 staged change summary，例如 `chapter_version`。
  4. 删除 UI 中 `/write`、`/auto` 等旧命令文案。
- 验收：
  ```powershell
  rg -n 'auto_status|tool_call_start|tool_call_end|chapter_write|record_chapter_state|text_delta|acceptance_report|/write|/auto' packages/client/src packages/client/tests -g '*.ts' -g '*.tsx'
  ```
  只允许 ignore 测试或非运行态迁移说明命中。

### Task I：服务端旧测试保护网迁移

- 文件：
  - `packages/server/tests/unit/ai/orchestrator/conversation-orchestrator.test.ts`
  - `packages/server/tests/integration/write-chapter-simple.test.ts`
  - `packages/server/tests/integration/write-then-audit.test.ts`
  - `packages/server/tests/integration/books-routes.test.ts`
  - `packages/server/tests/integration/worldbook-routes.test.ts`
  - `packages/server/tests/integration/revise-routes.test.ts`
  - `packages/server/tests/integration/user-journey.test.ts`
  - `packages/server/tests/integration/new-book-flow.test.ts`
- 当前证据：
  - 多个测试仍直接调用 `runConversation`、`runNewBookConversation`、`writeChapterSimple`、`writeWithAudit`、`auditChapter`。
  - 多个 route test 仍期待 `tool_call_start/tool_call_end/execution_step/acceptance_report`。
- 问题：
  - 这些测试会在删除旧流程时把旧行为“保护回来”。
- 任务：
  1. route 测试迁到 `/agent/run` 和 `agent/runs/:runId/action`。
  2. 旧 route 只测 410 或 wrapper 不发旧事件。
  3. `writeChapterSimple/writeWithAudit` 测试迁为 pure generator + staging commit 测试。
  4. `new-book-flow` 改为 onboard source 的 agent run，验证 staged characters/outline 去重。
- 验收：
  ```powershell
  rg -n 'runConversation|runNewBookConversation|runWorldbookChat|writeWithAudit|writeChapterSimple|/onboard|worldbook/chat|revise-segment|apply-revision|write-draft|finalize|tool_call_start|tool_call_end|acceptance_report|execution_step' packages/server/tests -g '*.ts'
  ```
  只允许 legacy adapter/negative guard 命中。

### Task J：统一聊天历史分类，避免跨书、隐藏正文、主动审查 prompt 污染上下文

- 文件：
  - `packages/server/src/http/routes/conversation.ts`
  - `packages/server/src/http/routes/books.ts`
  - `packages/server/src/http/routes/worldbook.ts`
  - `packages/server/src/http/routes/sidebar.ts`
  - `packages/server/src/ai/context-builder/*`
- 当前证据：
  - `conversation.ts`、`books.ts`、`worldbook.ts`、`sidebar.ts` 都会各自写 `conversationsRepo.append`。
  - 当前没有统一 message kind 契约来区分用户可见聊天、主动审查触发摘要、隐藏正文、手动资产日志。
- 问题：
  - 用户已要求：聊天记录必须按书绑定；主动审查 prompt 不进聊天，只显示触发了审查；正文默认不在对话框展示。
- 任务：
  1. 定义 message kind：`user_visible`、`assistant_visible`、`agent_progress_summary`、`manual_asset_change`、`hidden_draft`、`system_note`。
  2. 所有 conversation append 统一走一个 service。
  3. 主动审查只存“触发了主动审查：scope/categories”，不存原始 prompt。
  4. 写章正文、改写候选、工具参数默认 hidden，不进入聊天显示。
  5. context builder 按 `bookId + kind` 过滤，禁止跨书读历史。
- 验收：
  - 新建 book B 后发起写作，context 不包含 book A 的 conversation。
  - 主动审查后聊天区只出现触发摘要。
  - 写章完成后聊天区不显示正文全文，只显示进度和结果摘要。

### Task K：长篇上下文与章节级大纲统一接入主 Agent

- 文件：
  - `packages/server/src/ai/context-builder/book-context.ts`
  - `packages/server/src/ai/context-builder/builder.ts`
  - `packages/server/src/ai/orchestrator/main-agent.ts`
  - `packages/server/src/ai/orchestrator/executor-agent.ts`
- 当前证据：
  - context builder 已有“最近章原文/小结/中程摘要”的思路，但主 agent/executor 是否稳定消费仍需验证。
  - 用户明确要求：前 10 章全文、前 20-10 章每章小结、20 章以前大总结，并精确注入本章大纲。
- 问题：
  - 如果只有旧写章 prompt 使用 context，新 agent 写章仍可能读不到前文，导致第一章第一人称、第二章又错。
- 任务：
  1. 定义统一 `WritingContextBundle`。
  2. main-agent 和 executor-agent 写章/续写/改写都必须使用同一个 builder。
  3. 本章 chapter outline 必须作为硬约束注入，不再用 arc/volume 替代。
  4. validator 检查视角、文风、章级大纲覆盖、跨章连续性。
- 验收：
  - 写第 11 章时 prompt/context 包含第 1-10 章全文或等价窗口。
  - 写第 21 章时包含最近 10 章全文、10 章小结窗口、20 章以前总摘要。
  - 测试验证第二章继承第一章视角要求。

### Task L：工作流状态、超时、失败不半记录

- 文件：
  - `packages/server/src/ai/orchestrator/agent-runner.ts`
  - `packages/server/src/ai/orchestrator/workflow-staging.ts`
  - `packages/server/src/db/repositories/workflow-runs.ts`
  - `packages/client/src/components/conversation/conversation-pane.tsx`
  - `packages/client/src/components/editor/revise-preview.tsx`
- 当前证据：
  - `agent-runner` 已有 `done.committed`，但 run status API、timeout、resume/recover 仍不足。
  - `workflow-staging.ts` commit 仍逐 change 落库，没有事务/补偿策略。
- 问题：
  - 没有超时处理、没跑完全程的不要记录一半，是当前用户最新指出的核心 bug。
- 任务：
  1. 所有 LLM call 支持可配置 timeout 和 abort reason。
  2. run 状态持久化：`running/waiting_user/committing/committed/failed/cancelled/timeout`。
  3. staging commit 用事务或补偿，失败后 `done.committed:false`。
  4. 前端 stream 断开不等于成功，必须按 run finalStatus 展示。
- 验收：
  - 模拟 LLM timeout：不新增章节、不新增角色、不新增大纲，UI 显示超时可重试。
  - 模拟 commit 第二项失败：第一项不应静默半提交，或必须显示 partial failure 且禁止宣称成功。

### Task M：用量记录接入每个模型调用，识别“API 调用量很大”来源

- 文件：
  - `packages/server/src/ai/llm-call.ts`
  - `packages/server/src/ai/orchestrator/main-agent.ts`
  - `packages/server/src/ai/orchestrator/executor-agent.ts`
  - `packages/server/src/ai/orchestrator/validator-agent.ts`
  - 所有直接 `generateText/streamText/doGenerate/doStream` 的测试和生产 helper
- 当前证据：
  - 搜索显示 `llm-call.ts` 是统一 stream/generate helper，但旧 orchestrator 和测试里仍有多处直接模型 provider 调用形态。
  - 用户已要求“先落地用量记录”，但后续还要确保所有 agent phase 都归因。
- 问题：
  - 如果 main/executor/validator/repair 都各自调用模型，但 usage 只记录一部分，用户看不到成本来源。
- 任务：
  1. 每次 LLM call 必须带 `runId/bookId/source/phase/purpose/model/provider`。
  2. usage 事件按 phase 发给前端。
  3. settings/model refresh 等非写作调用也要单独归类。
  4. 新增 guard：生产代码不得绕过 `withUsageRecording` 或统一 llm gateway。
- 验收：
  ```powershell
  rg -n 'generateText|streamText|generateObject|doGenerate|doStream' packages/server/src -g '*.ts'
  ```
  每个命中必须在统一 gateway 内或有明确白名单说明。

---

## 2026-06-25 本轮补扫任务

> 这一节是本轮“完整识别所有地方”的补充落表。目标不是再讲一遍方向，而是把仍然存在的新旧混用、旧协议残留、工具脚本残留、测试残留和文档残留，逐项变成可执行 task。

### Task N：统一服务端 AI 入口，收口所有 legacy route/wrapper

**文件：**
- `packages/server/src/http/routes/chapters.ts`
- `packages/server/src/http/routes/auto.ts`
- `packages/server/src/http/routes/books.ts`
- `packages/server/src/http/routes/revise.ts`
- `packages/server/src/http/routes/worldbook.ts`
- `packages/server/src/http/routes/conversation.ts`
- `packages/server/src/http/server.ts`

**要点：**
- `chapters.ts` 只保留手动 CRUD，`/write`、`/write-draft`、`/finalize` 必须持续 410 或被彻底移除。
- `auto.ts` 不能再承载独立自动模式语义，`/auto` 和 `/auto/cancel` 只能做兼容壳或直接下线。
- `books.ts` 的 `onboard` 需要明确是统一 workflow 的一种 source，不是独立 AI 流。
- `revise.ts` 的 `revise-segment` 必须只产生统一 workflow 的 proposal，`apply-revision` 继续保持 legacy 退出态。
- `worldbook.ts` 不允许再自己 append 一套独立聊天历史或独立执行链。
- `conversation.ts` 不能再偷偷走旧 orchestrator 或旧事件协议。

**验收：**
```powershell
rg -n "runConversation|runAutoMode|runNewBookConversation|runWorldbookChat|writeWithAudit|writeChapterSimple|auditChapter|repairChapter|recordChapterState|reviseSegment|/write-draft|/finalize|/auto|/onboard|worldbook/chat|apply-revision" packages/server/src/http/routes packages/server/src/ai/orchestrator -g "*.ts"
```

### Task O：拆分 SSE 协议，旧事件只做 legacy ignore

**文件：**
- `packages/shared/src/types/sse-events.ts`
- `packages/shared/tests/agent-workflow.test.ts`
- `packages/server/src/ai/orchestrator/agent-runner.ts`
- `packages/server/src/ai/orchestrator/conversation-orchestrator.ts`
- `packages/client/src/components/conversation/conversation-pane.tsx`
- `packages/client/src/components/conversation/message.tsx`
- `packages/client/src/components/conversation/streaming-message.tsx`
- `packages/client/src/components/editor/revise-preview.tsx`
- `packages/client/src/pages/onboard.tsx`

**要点：**
- 新协议只保留统一 agent 事件。
- `tool_call_start/tool_call_end/text_delta/workflow_mode/execution_step/acceptance_report` 只能作为 legacy ignore。
- `main_output/validation_report/agent_phase/done` 是主流程唯一可见协议。
- 正文、审查提示、工具参数不得直接落进聊天可见区。

**验收：**
```powershell
rg -n "tool_call_start|tool_call_end|text_delta|workflow_mode|execution_step|acceptance_report" packages/shared/src packages/client/src packages/server/src -g "*.ts" -g "*.tsx"
```

### Task P：清掉所有 slash / regex 命令触发残留

**文件：**
- `packages/server/src/ai/orchestrator/intent.ts`
- `packages/shared/src/slash-commands.ts`
- `packages/client/src/components/conversation/slash-suggestions.tsx`
- `packages/client/src/components/conversation/conversation-pane.tsx`
- `packages/client/src/i18n/zh-CN.ts`
- `packages/client/tests/components/slash-suggestions.test.tsx`
- `packages/shared/tests/natural-language-shortcuts.test.ts`

**要点：**
- `command_explicit`、`parseSlashCommand`、命令 id 语义都要消失。
- slash 只能做自然语言模板插入，不能触发执行。
- UI 文案里不能再保留“输入 /xx 执行”的暗示。

**验收：**
```powershell
rg -n "command_explicit|parseSlashCommand|SLASH_COMMANDS|/write|/auto|/rewrite|/revise|/audit|/recall|/note" packages/server/src packages/shared/src packages/client/src -g "*.ts" -g "*.tsx"
```

### Task Q：统一创书 / 改写 / 自动写的前端入口，移除旧按钮与旧成功判定

**文件：**
- `packages/client/src/components/editor/editor-pane.tsx`
- `packages/client/src/components/editor/revise-preview.tsx`
- `packages/client/src/components/conversation/conversation-pane.tsx`
- `packages/client/src/components/conversation/message.tsx`
- `packages/client/src/components/conversation/streaming-message.tsx`
- `packages/client/src/pages/onboard.tsx`
- `packages/client/src/pages/settings.tsx`
- `packages/client/src/stores/conversation.ts`

**要点：**
- 编辑器只保留统一工作流入口，不再让用户直接接触 draft/finalize/旧写作按钮。
- 对话页、创书页、改写预览页都必须按 `done.committed` / `validation_report` 判定，不允许“半程成功”。
- 主动审查、正文生成、修复确认的进度 UI 必须分层显示，不混在聊天正文里。

**验收：**
```powershell
rg -n "/write-draft|/finalize|/auto|/onboard|/apply-revision|text_delta|acceptance_report|tool_call_start" packages/client/src packages/client/tests -g "*.ts" -g "*.tsx"
```

### Task R：清理工具脚本里的旧事件消费与旧流程入口

**文件：**
- `packages/server/tools/test-full-flow.ts`
- `packages/server/tools/run-mimo-book.ts`
- `packages/server/tools/run-auto.ts`
- `packages/server/tools/run-pet-capture-demo.ts`
- `packages/server/tools/monitor-sillytavern-longform.ts`
- `packages/server/tools/monitor-generic-record-flow.ts`
- `packages/server/tools/backfill-record-state.ts`

**要点：**
- 这些脚本现在还在消费 `text_delta`、`tool_call_start`、旧写作链或旧 workflow 产物。
- 需要逐个改成统一 run 协议，或者明确标成 legacy debug tool。
- 不允许脚本继续成为“绕开主流程”的第二入口。

**验收：**
```powershell
rg -n "text_delta|tool_call_start|tool_call_end|writeWithAudit|writeChapterSimple|runAutoMode|runNewBookConversation|runWorldbookChat" packages/server/tools -g "*.ts"
```

### Task S：把仍在保护旧行为的测试拆成“主流程”与“legacy 负向”

**文件：**
- `packages/server/tests/integration/books-routes.test.ts`
- `packages/server/tests/integration/auto-mode.test.ts`
- `packages/server/tests/integration/worldbook-routes.test.ts`
- `packages/server/tests/integration/revise-routes.test.ts`
- `packages/server/tests/integration/chapter-roundtrip.test.ts`
- `packages/server/tests/integration/user-journey.test.ts`
- `packages/server/tests/integration/write-chapter-simple.test.ts`
- `packages/server/tests/integration/write-then-audit.test.ts`
- `packages/server/tests/integration/new-book-flow.test.ts`
- `packages/server/tests/integration/chat-streaming.test.ts`
- `packages/server/tests/unit/ai/orchestrator/conversation-orchestrator.test.ts`
- `packages/server/tests/unit/ai/orchestrator/legacy-trigger-guard.test.ts`
- `packages/server/tests/unit/http/ai-routes-guard.test.ts`
- `packages/client/tests/components/conversation-pane.test.tsx`
- `packages/client/tests/components/conversation-tool-feedback.test.tsx`
- `packages/client/tests/components/conversation-writing-intent.test.tsx`
- `packages/client/tests/components/editor-pane.test.tsx`
- `packages/client/tests/components/phase9.test.tsx`
- `packages/client/tests/components/selection-revise.test.tsx`
- `packages/client/tests/pages/onboard.test.tsx`

**要点：**
- 主流程测试只断言新协议和新入口。
- legacy 测试必须明确命名为 ignore / removed / 410，不再保护旧行为。
- 任何仍断言 `tool_call_start`、`execution_step`、`acceptance_report` 的测试，都要先判断是不是纯负向护栏。

**验收：**
```powershell
rg -n "tool_call_start|tool_call_end|text_delta|workflow_mode|execution_step|acceptance_report|/write-draft|/finalize|/auto|/onboard|worldbook/chat|apply-revision" packages/server/tests packages/client/tests -g "*.ts" -g "*.tsx"
```

### Task T：把旧架构说明和手册显式标成 obsolete，避免下一位实现者误读

**文件：**
- `docs/ARCHITECTURE-REVIEW-2026-06-24.md`
- `docs/CLAUDE-AGENT-WORKFLOW-REWORK.md`
- `docs/_implementation-notes.md`
- `docs/HANDOFF-codex.md`
- `docs/HANDOFF-2026-06-21.md`
- `docs/README.md`

**要点：**
- 文档里凡是描述旧流程、旧路由、旧事件的段落，都要明确标记为历史记录或 obsolete。
- 当前规范只能保留统一 agent workflow。
- 不允许新文档继续把 `/write`、`/auto`、`writeWithAudit`、`tool_call_start` 写成推荐方案。

**验收：**
```powershell
rg -n "writeWithAudit|writeChapterSimple|runAutoMode|runNewBookConversation|runWorldbookChat|tool_call_start|tool_call_end|acceptance_report|/write-draft|/finalize|/auto|/onboard|worldbook/chat|apply-revision" docs -g "*.md"
```

### Task U：补一轮“旧入口全量清查”总检索，作为后续合并前门禁

**文件：**
- `packages/server/src/**/*`
- `packages/client/src/**/*`
- `packages/shared/src/**/*`
- `packages/server/tests/**/*`
- `packages/client/tests/**/*`
- `packages/server/tools/**/*`
- `docs/**/*`

**要点：**
- 每次改完一个入口，都要再跑一次全量检索。
- 检索命中只允许出现在 legacy adapter、negative test、obsolete 文档里。
- 任何新加的旁路、重复流程、旧协议消费，都要在这一步被拦住。

**验收命令：**
```powershell
rg -n "runAgentWorkflow|runConversation|runAutoMode|runNewBookConversation|runWorldbookChat|writeWithAudit|writeChapterSimple|auditChapter|repairChapter|recordChapterState|parseSlashCommand|makeTriggerTools|/auto|/onboard|/worldbook/chat|/revise-segment|/apply-revision|/write-draft|/finalize|/conversation\\?mode=chat|agent/run|generateObject|generateText|streamText|doStream|withUsageRecording" packages docs -g "*.ts" -g "*.tsx" -g "*.md"
```

### Task V：生产源码里仍保留 legacy orchestrator 文件，必须隔离或删除

**本轮证据：**
- `packages/server/src/ai/orchestrator/conversation-orchestrator.ts`
- `packages/server/src/ai/orchestrator/new-book.ts`
- `packages/server/src/ai/orchestrator/worldbook-chat.ts`
- `packages/server/src/ai/orchestrator/revise-segment.ts`
- `packages/server/src/ai/orchestrator/write-chapter.ts`
- `packages/server/src/ai/orchestrator/write-with-audit.ts`
- `packages/server/src/ai/orchestrator/repair-chapter.ts`
- `packages/server/src/ai/orchestrator/record-state.ts`
- `packages/server/src/ai/orchestrator/delete-chapter.ts`

**问题：**
- 这些文件虽然大多已经不再被 HTTP route 直接调用，但仍在生产源码内导出旧流程。
- 其中多处仍产出旧 SSE 事件：`workflow_mode`、`intent`、`text_delta`、`tool_call_start`、`tool_call_end`、`execution_step`、`acceptance_report`。
- `write-chapter.ts`、`repair-chapter.ts`、`write-with-audit.ts`、`record-state.ts` 仍包含直接落库逻辑，一旦被重新 import 就会绕过统一 workflow。

**任务：**
1. 对每个 legacy orchestrator 做二选一处理：删除，或移动到 `legacy/` 并明确只供负向测试/迁移参考使用。
2. 生产 route、agent runner、executor、validator 禁止 import 这些旧 orchestrator。
3. 如果保留旧文件，文件头必须标注 `@deprecated legacy only`，并加静态护栏防止生产路径 import。
4. 旧写作逻辑需要拆成 pure generator/helper 后再被新 executor 使用，不允许保留“生成即落库”的导出函数。

**验收：**
```powershell
rg -n "runConversation|runNewBookConversation|runWorldbookChat|reviseSegment|writeWithAudit|writeChapterSimple|repairChapter|recordChapterState|deleteChapter" packages/server/src -g "*.ts"
```
命中只能出现在 `legacy` 标注文件或负向 guard 白名单中。

### Task W：`conversation.ts` 仍自己写聊天历史，需交给统一 message service

**本轮证据：**
- `packages/server/src/http/routes/conversation.ts`
  - `handle.conversationsRepo.append({ role: "user", content: message, metadata: { kind: "chat" } })`
  - `handle.conversationsRepo.append({ role: "assistant", content: "(已通过统一 Agent 管线完成变更)", metadata: { kind: "chat" } })`
  - `handle.conversationsRepo.append({ role: "assistant", content: buf, metadata: { kind: "chat" } })`
- `packages/server/src/http/routes/sidebar.ts` 也在多个手动资产 CRUD 中直接 append conversation。

**问题：**
- `/conversation` 虽然 wrapper 到 `runAgentWorkflow`，但聊天历史持久化仍在 route 层自己做。
- 它还靠 `text_delta` 拼 assistant buffer，这会把旧流式正文/回复协议继续绑定到聊天记录。
- Sidebar 手动资产变更也直接写 conversation，容易污染 AI 上下文，且没有统一 kind 过滤。

**任务：**
1. 新建统一 conversation/message service，所有 append 只能经过它。
2. message kind 至少区分：`user_visible`、`assistant_visible`、`agent_progress_summary`、`manual_asset_change`、`hidden_draft`、`hidden_prompt`、`system_note`。
3. `/conversation` 只记录用户可见聊天和 agent 结果摘要，不拼旧 `text_delta`。
4. 主动审查只记录“触发了主动审查 + scope/categories”，不记录原始 prompt。
5. context builder 必须按 bookId 和 kind 取历史，禁止把 hidden draft/prompt 当普通聊天注入。

**验收：**
```powershell
rg -n "conversationsRepo\\.append" packages/server/src -g "*.ts"
```
除统一 message service 和白名单测试外不得命中。

### Task X：AI tools 仍可直接 mutation，重复角色/重复大纲的根源还在

**本轮证据：**
- `packages/server/src/ai/tools/book-meta-tools.ts`
  - `charactersRepo.create`
  - `charactersRepo.update`
  - `outlineRepo.create`
  - `outlineRepo.update`
- `packages/server/src/ai/tools/worldbook-tools.ts`
  - `repo.create`
  - `repo.update`
  - `repo.delete`
- `packages/server/src/ai/tools/state-tools.ts`
  - `charactersRepo.create`
  - `charactersRepo.update`
  - `foreshadowingRepo.create`
  - `timelineRepo.create`

**问题：**
- 用户已多次遇到“同一角色被创建三次”“工具调用看似没反应或重复执行”。
- 当前 AI 工具可以直接写 repo，没有统一去重、staging、用户确认和 validator 回查。
- 即使 route 已统一到 `/agent/run`，executor 如果继续拿这些 mutation tools，也会绕过新 workflow 的 staged changes。

**任务：**
1. AI tool 分层：read tools 只读，proposal tools 只返回 staged change，不直接写库。
2. executor 在创建角色/大纲/世界书前必须读取现有资产，按名称、别名、章号、标题做归一化匹配。
3. workflow-staging commit 时再做二次去重，避免并发或多轮工具调用造成重复。
4. 直接 mutation tools 只能用于手动 CRUD route 或 legacy debug，不可暴露给主 agent/executor。

**验收：**
```powershell
rg -n "\\.create\\(|\\.update\\(|\\.delete\\(" packages/server/src/ai/tools packages/server/src/ai/orchestrator -g "*.ts"
```
AI tools/orchestrator 中不得出现直接资产 mutation，`workflow-staging.ts` 是唯一 AI commit 白名单。

### Task Y：LLM 调用仍没有完全统一到 usage/timeout gateway

**本轮证据：**
- `packages/server/src/ai/llm-call.ts` 统一封装了 `streamLlm`、`generateLlmText`、`generateTextWithRetry`。
- `packages/server/src/http/routes/conversation.ts` 在 route 层套了 `withUsageRecording`。
- `packages/server/src/ai/orchestrator/intent.ts` 仍直接 import `generateText` 并调用。
- 多个 legacy orchestrator 仍调用 `streamLlm` / `generateLlmText`，但没有传 runId、phase、purpose。
- `agent-runner.ts` 的 main/executor/validator/repair 阶段没有统一记录每次模型调用的 phase 成本。

**问题：**
- 用户已经发现 API 调用量过大，但现在无法稳定解释每次调用来自 main、executor、validator、repair、model refresh、context summary 还是 legacy fallback。
- route 层统计只能包住 SSE 总流，不能精确归因到 agent phase。
- 超时和 abort reason 也没有成为所有 LLM call 的硬参数。

**任务：**
1. 建立唯一 LLM gateway，所有生产 `generateText/streamText/generateObject` 必须从该 gateway 走。
2. 每次调用强制带 `bookId/runId/source/phase/purpose/provider/model/timeoutMs`。
3. usage 记录按 phase 入库，并通过 agent 事件可选展示。
4. `intent.ts` 不得直接 `generateText`，要迁入 gateway，或被新 main-agent 完全替代。
5. 所有 LLM call 都要支持 timeout、abortSignal、abort reason；timeout 后不得 commit staged change。

**验收：**
```powershell
rg -n "generateText|streamText|generateObject|doGenerate|doStream" packages/server/src -g "*.ts"
rg -n "withUsageRecording|phase|purpose|timeoutMs|runId" packages/server/src/ai packages/server/src/http/routes -g "*.ts"
```
生产代码中的模型调用必须能追溯到统一 gateway 和 usage phase。

### Task Z：`agent/run` 自身还是骨架，收口后可能变成“唯一入口但能力不足”

**本轮证据：**
- `packages/server/src/ai/orchestrator/agent-runner.ts` 当前流程为：
  - `analyzeIntent`
  - `runExecutor`
  - `validateStagedChanges`
  - `runRepair`
  - `staging.commit`
- `agent-runner.ts` 没有显式 run status 持久化更新阶段。
- `workflow-staging.ts` commit 是逐 change 写入，缺事务边界。
- `main-agent.ts` / `executor-agent.ts` 的能力需要继续确认是否真的能完成创书、写章、改写、主动审查、世界书编辑。

**问题：**
- 如果只把旧 route 全部 410，但 `/agent/run` 不能完整执行，用户会看到“入口统一了，但工具没反应”。
- 当前 `done.committed:false` 已有保护，但 run 状态、用户 action、修复 action、确认 action、重 roll action 仍需闭环。

**任务：**
1. 补全 run status：`running`、`thinking`、`executing`、`validating`、`waiting_user`、`repairing`、`committing`、`committed`、`failed`、`timeout`、`cancelled`。
2. 补全后续 action endpoint：approve、reject、repair、reroll、cancel、resume，不能靠“重发上一条消息”模拟。
3. executor 必须能产出所有主场景 staged changes：章节正文、章节摘要、审查、角色、世界书、大纲、伏笔、时间线、主动审查 issue。
4. validator 必须回归 main-agent 任务标准，再额外检查一致性、正文是否隐藏、章级大纲覆盖、视角文风延续。
5. commit 前后必须事务化或有补偿策略，失败时不得宣称成功。

**验收：**
```powershell
rg -n "agent/runs|approve|reject|reroll|resume|waiting_user|committing|timeout|cancelled" packages/server/src packages/client/src -g "*.ts" -g "*.tsx"
pnpm --filter @scribe/server exec vitest run tests/unit/ai/orchestrator/agent-runner.test.ts
```

### Task AA：前端仍存在旧语义 UI 和 legacy event 兼容，需全部改成新 workflow 视图

**本轮证据：**
- `packages/client/src/components/editor/editor-pane.tsx`
  - `data-testid="btn-write-draft"`
  - `finalizeChapter`
  - `target: { chapterNo: currentNo, mode: "finalize" }`
- `packages/client/src/pages/onboard.tsx`
  - 独立 onboard page 和 workflow UI 仍存在，虽然 SSE URL 已是 `/agent/run`。
- `packages/client/src/components/conversation/conversation-pane.tsx`
  - 仍拉 `/conversation?limit=100` 和 `/onboard-status`。
- 多个 client test 仍断言 `text_delta`、`tool_call_start`、`acceptance_report`、旧写作意图。

**问题：**
- 用户要的是统一流程进度 UI，而不是旧按钮换一个新 URL。
- “创书聊天”和普通聊天应该同一套 workflow 展示，不应维护两套页面状态和事件解析。
- 旧 test id 和函数名会持续诱导后续实现者把 draft/finalize 当用户级入口。

**任务：**
1. 编辑器 UI 改成单一写作入口：写/续写/改写/审查均通过统一工作流任务描述和 target。
2. `finalize` 从用户按钮概念下线，变成 validator/commit 内部阶段或显式“确认提交 staged changes”。
3. Onboard 页面如果保留，只是同一 ConversationPane/WorkflowPane 的特殊 source，不维护独立事件协议。
4. 所有旧 event 兼容分支命名为 legacy ignore，并从主 UI 渲染路径拿掉。
5. 前端所有成功刷新都以 `done.committed === true` 或 run status `committed` 为准。

**验收：**
```powershell
rg -n "btn-write-draft|finalizeChapter|mode: \"finalize\"|text_delta|tool_call_start|tool_call_end|acceptance_report|workflow_mode|/write|/auto" packages/client/src packages/client/tests -g "*.ts" -g "*.tsx"
```

### Task AB：上下文构建需要统一成写作上下文包，确保多章连续性和章级大纲

**本轮证据：**
- `packages/server/src/ai/context-builder/book-context.ts`
- `packages/server/src/ai/context-builder/builder.ts`
- `packages/server/src/ai/context-builder/snapshot.ts`
- `conversation-orchestrator.ts` 自己拼 recent/outlines/characters/contextBlock。
- 旧写作、审查、修复、record-state、new-book 各自拼 prompt/context。

**问题：**
- 用户指出“第一章第一人称对了，第二章又错”，高度符合不同流程使用不同上下文 builder 的症状。
- 当前需要的是长篇统一策略：最近 10 章全文、前 20-10 章小结、20 章以前大总结、本章章级大纲、文风参考、视角/基调约束。
- 如果 main-agent、executor、validator、repair 不是同一套 context bundle，就会继续断章、丢视角、丢文风。

**任务：**
1. 定义 `WritingContextBundle`，作为写章、续写、改写、修复、审查的唯一上下文输入。
2. 最近窗口策略标准化：最近 10 章全文；第 20 到第 10 章每章小结；20 章以前总摘要；不足时按实际可用内容填充。
3. 本章 chapter outline 必须精确注入，不能只注入 volume arc。
4. 文风参考、深层提示词、书本规则、视角要求必须进入同一个 bundle，并在 validator 中回查。
5. 禁止旧 orchestrator 自己拼 contextBlock。

**验收：**
```powershell
rg -n "buildBookPromptContext|loadBookSnapshot|listSummaries\\(|contextBlock|recent|outlineBrief|charBrief" packages/server/src/ai -g "*.ts"
```
除统一 context builder 外，不允许业务 orchestrator 手写长篇上下文拼装。

### Task AC：工具脚本和 monitor 仍可绕开主流程，需分级处理

**本轮证据：**
- `packages/server/tools/run-mimo-book.ts`
- `packages/server/tools/run-rainwell-user-flow.ts`
- `packages/server/tools/run-pet-capture-demo.ts`
- `packages/server/tools/monitor-sillytavern-longform.ts`
- `packages/server/tools/monitor-generic-record-flow.ts`
- `packages/server/tools/monitor-worldbook-flow.ts`
- `packages/server/tools/verify-sillytavern-import.ts`
- `packages/server/tools/backfill-record-state.ts`

**问题：**
- tools 目录里仍有大量直接 create/update/saveVersion/saveSummary 或旧事件消费。
- 这些脚本可能被当作“全流程验证”继续运行，但它们验证的是旧路径或手动绕过路径。
- monitor/backfill 如果写真实数据，也可能制造和用户 UI 不一致的状态。

**任务：**
1. 工具脚本分级：`current-flow`、`manual-seed`、`legacy-debug`、`backfill`。
2. current-flow 脚本必须调用 `/agent/run` 或 `runAgentWorkflow`，并消费新 agent events。
3. manual-seed 脚本只能写种子数据，文件头写明不代表 AI 流程。
4. legacy-debug 脚本默认不参与测试和交接，并标注 obsolete。
5. backfill 脚本必须 dry-run 默认开启，显式确认才写库。

**验收：**
```powershell
rg -n "text_delta|tool_call_start|tool_call_end|writeWithAudit|writeChapterSimple|runAutoMode|runNewBookConversation|runWorldbookChat|saveVersion|saveSummary|\\.create\\(|\\.update\\(" packages/server/tools -g "*.ts"
```
每个命中必须有脚本分级说明或迁移任务。

### Task AD：文档存在多层历史规格，必须建立“当前唯一规范”入口

**本轮证据：**
- `docs/ARCHITECTURE-REVIEW-2026-06-24.md`
- `docs/CLAUDE-AGENT-WORKFLOW-REWORK.md`
- `docs/HANDOFF-2026-06-21.md`
- `docs/_implementation-notes.md`
- `docs/ISSUE-2026-06-23-long-context-continuity.md`
- `docs/superpowers/specs/2026-06-24-agent-workflow-unified-pipeline.md`
- `docs/_backups/20260604-162405/2026-06-04-scribe-mvp.md`

**问题：**
- 文档里既有旧 MVP 规格，也有架构评审，也有新 workflow 方案，但缺一个“当前唯一事实来源”。
- 旧文档中 `/auto`、`/write-draft`、`runNewBookConversation`、`tool_call_start` 等内容如果不标 obsolete，很容易让后续 AI 继续照旧实现。

**任务：**
1. 新建或指定 `docs/CURRENT-ARCHITECTURE.md` 作为当前唯一规范入口。
2. 所有旧文档开头加状态：`Obsolete`、`Historical`、`Superseded by CURRENT-ARCHITECTURE.md`。
3. `docs/README.md` 只链接当前规范和本任务清单。
4. 当前规范明确写死：唯一 AI 入口、唯一事件协议、唯一 staging commit、唯一上下文 builder、唯一 usage gateway。
5. 旧文档保留历史价值，但不得作为实现依据。

**验收：**
```powershell
rg -n "Current architecture|CURRENT-ARCHITECTURE|Obsolete|Superseded|writeWithAudit|writeChapterSimple|runAutoMode|runNewBookConversation|tool_call_start|/write-draft|/auto" docs -g "*.md"
```

### Task AE：最终合并前必须跑“旧流程零容忍矩阵”

**矩阵范围：**
- 服务端生产源码
- 客户端生产源码
- shared 类型
- server/client/shared 测试
- tools
- docs

**任务：**
1. 每个旧关键词命中都必须分类为：`removed`、`410 negative test`、`legacy ignore test`、`obsolete docs`、`manual CRUD allowed`、`current flow allowed`。
2. 未分类命中不得合并。
3. 把分类结果贴回本文，形成下一轮审查基线。

**验收命令：**
```powershell
rg -n "runConversation|runAutoMode|runNewBookConversation|runWorldbookChat|writeWithAudit|writeChapterSimple|auditChapter\\(|repairChapter\\(|recordChapterState\\(|reviseSegment\\(|parseSlashCommand|makeTriggerTools|command_explicit|/auto\\b|/onboard\\b|worldbook/chat|revise-segment|apply-revision|write-draft|finalize|conversation\\?mode=chat|tool_call_start|tool_call_end|text_delta|workflow_mode|execution_step|acceptance_report|chapter_write|chapter_audit|record_chapter_state|generateText|streamText|generateObject|conversationsRepo\\.append|chaptersRepo\\.saveVersion|chapterFiles\\.save" packages docs -g "*.ts" -g "*.tsx" -g "*.md"
```

**合格标准：**
- 生产 AI 入口只有 `/api/books/:bookId/agent/run`。
- 旧 AI route 只能 410 或非 AI 状态/手动 CRUD。
- 旧事件只能 legacy ignore，不参与主 UI。
- AI mutation 只能通过 staging commit。
- 所有模型调用都有 usage phase 和 timeout。
- 当前架构文档只有一个事实来源。
