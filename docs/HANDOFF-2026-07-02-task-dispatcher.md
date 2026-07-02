# 任务分派架构落地(2026-07-02)

> 计划:`docs/superpowers/plans/2026-07-02-simplify-to-task-dispatcher.md`
> 问题清单:`docs/ARCHITECTURE-REVIEW-2026-06-25-PIPELINE-REGRESSION.md`
> 分支:`codex/generic-record-architecture`(`59e7050..23ccc67+`,未推送前先人工验收)

## 架构一句话

系统只做三件事:**选提示词模板 → 注入裁剪过的上下文 → 解析 AI 反馈落库**。
前端 `source` 一对一决定任务,不再让 LLM 分类意图;没有 Main/Executor/Validator/Repair
四 Agent,没有 staging/approve/cancel,apply 成功即落库。

```
POST /agent/run {message, source, target}
  → resolveTask(source)        editor→write-chapter | revision→revise |
                               onboard→onboard | asset_audit→audit | chat/auto→chat
  → dispatchTask(task, ctx)    stream(流式 SSE text_delta)
                               → parse(结构化,可二次 LLM 抽取)
                               → apply(同步 DB 事务 + FS 回滚)
  → SSE: text_delta / done{committed} / error{errorClass} / usage(schema 保留未发)
```

每个任务一个文件(`packages/server/src/ai/tasks/`),契约 `TaskDef = {name, mutates, stream, parse, apply}`。

## 关键机制

- **写章两次调用**:写手模型纯流式 prose(经 `buildChapterWriteMessages` 分层上下文
  + 文风参考),抽取模型从 prose 产出角色/伏笔/时间线/**章节小总结**(中程记忆),
  apply 在一个 better-sqlite3 事务里落库,章节文件写盘失败反向删版本。
- **最深处提示词**:书级 `book_meta.master_prompt`(开关 `master_prompt_enabled`)
  覆盖全局 `config.masterPrompt`,路由解析后所有 6 处默认 LLM 调用统一 prepend。
- **计费**:`streamLlm` 的 usage 事件在任务内消费,经 `ctx.onUsage` 回调由路由按
  modelRole 选价目表落 `token_usage` + `booksRepo.addCost`。SSE 不再发 usage 事件。
- **committed 语义**:`done.committed = task.mutates`(chat=false);
  `onChapterCommitted`(标脏+快照)只对 write-chapter/revise 触发。
- **对话表**:章节类任务只存简短进度说明(正文已在 chapters 表);
  chat/onboard/audit 存真实回复。audit 的回复=摘要+逐条问题清单。
- **流错误**:`streamLlm` 只 yield error 事件不抛;任务默认流一律转 throw,
  防止供应商中途失败让截断正文被当完整章节提交。
- **审查(audit)**:report-only,issues 落 `reader_issues` 表 → 下次写作时
  `loadBookSnapshot.listOpen()` 注入写作上下文自动规避;用户可见面在聊天回复。

## 数据迁移

`0011_drop_workflow_tables.sql` drop 掉 `workflow_runs` / `workflow_staged_changes`。
老书打开时自动应用,无手动步骤。

## 防回潮

- `ai-routes-guard`:dispatchTask 是唯一 AI 入口;auto.ts/revise.ts 路由文件不得复活;
  无 `/agent/runs/` staging 端点;五个任务文件必须存在并在 registry 注册。
- `legacy-production-import-guard` / `legacy-trigger-guard`:orchestrator 文件不得复活。

## 已知限制(有意为之/下一档)

| 项 | 状态 |
|---|---|
| 弧/卷压缩 `compress-arc.ts` | 孤儿保留,record 数据齐了再接(长程记忆下一档) |
| 7 维章审查 `audit-chapter.ts` | 孤儿保留,可作为章后异步质检的下一档素材 |
| `audit-persist.ts` / `hard-fact-gate.ts` / `budget-check.ts` | 孤儿;预算控制随多章连写一起搁置 |
| 多章连写(source:"auto") | 现在等同 chat,不再自动循环写章 |
| reader_issues 无独立 UI 面板 | 报告可见面在聊天;issues 自动反哺写作上下文 |
| SSE 无 runId 关联 | 日志排查靠时间戳+bookId |
| `executionMode` 请求字段 | schema 接受但服务端忽略(staging 已删) |
| chat 不做资产修改 | 设计如此:改资产用侧栏 CRUD |

## 人工验收清单(Task 14,用 opencodego + deepseek-v4-pro)

1. **onboard**:新建书 → 对话流式;侧栏世界书/角色/大纲出现**有内容**的条目
2. **写 3 章**:编辑器逐段流出;≥1500 字/章;角色 currentState / 伏笔 / 时间线 /
   章节摘要更新;用量页有 write+audit 两类记录
3. **选段改写**:预览流式只显示新段;确认后仅该段变化、标题保留;版本历史 +1
4. **全量审查**:聊天里出现摘要+逐条问题;下一章写作应规避这些问题
5. **闲聊**:"你好" prompt tokens < 5000;无"已提交"提示;侧栏无变化

## 全绿证据(2026-07-02)

- typecheck:shared 0 / server 0 / client 0(起点 84 错)
- 测试:server 597/597 · shared 32/32 · client 114/114
- 端到端集成(mock 模型):写章全链路(流式→抽取→落库→计费→短注)、
  段落改写(服务端合并、标题保留、错误不落库)、审查范围拼装、
  最深处提示词到达模型、流错误传播
