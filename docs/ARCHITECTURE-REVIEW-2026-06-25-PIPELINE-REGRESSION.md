# 统一管线回归问题清单

Date: 2026-06-25
Scope: Codex `f53f004`(Consolidate agent workflow)引入的回归

## 头号问题:写作引擎核心被砍成孤儿

Codex 把所有 AI 入口砍成 410,全部走 `/agent/run`。但新管线的写作路径依赖 **Main Agent 在一次非流式 JSON 调用里产出 `draft` 字段**。

**孤儿文件确认**(生产代码零调用方):
- `streamLlm`(llm-call.ts):正文流式输出,**零调用方**
- `buildWriteContext` / `buildChapterWriteMessages`(builder.ts + book-context.ts):分层上下文,**零调用方**
- `auditChapter`(audit-chapter.ts):7 维语义审查,**零调用方**
- `recordChapterState`(record-state.ts):角色/伏笔/时间线/题材记录抽取,**零调用方**
- `compressArc` / `compressVolume`(compress-arc.ts):弧/卷总结长程记忆,**零调用方**

**因此新管线全部失去**:
1. 正文流式输出(用户等整章生成完才看到字)
2. 语义审查(validator 只剩 3 条正则)
3. 记忆抽取(角色/伏笔/时间线不再自动落库)
4. 弧/卷长程记忆(书写到 20 章就失忆)
5. 分层上下文(设定/前文/中程/弧卷去重 + 预算),被简化字符串取代

**根因证据**:Ch15 在旧路径(`streamLlm`)稳定 3-7k 字;经新管线(JSON `draft` 字段)系统性偏短(实测 700 字)。模型在 JSON 值里倾向截断。

---

## P0 — 功能性回归(必修)

### P0-1 写章意图下无独立流式 writer
**现状**:executor.planChapterWrite 直接包 `task.draft`(Main Agent 在 JSON 里塞的正文)。
**应当**:write_chapter 时 executor 调独立 writer(复用 buildChapterWriteMessages + streamLlm),产出进 staging。
**影响**:正文截断 + 不流式 + 无分层上下文。

### P0-2 commit 后无 record-state
**现状**:record-state.ts 零调用方,commit 后不抽取记忆。
**应当**:commit 成功后异步跑 record-state,失败写 reader_issue 不阻断。
**影响**:书写到 20 章角色/伏笔/时间线全失忆。

### P0-3 staging.commit 半提交不回滚
**现状**:`commit()` 逐条写,第 2 条失败时第 1 条已提交,第 3 条可能继续。`failed.length>0` 标 `failed` 但已提交部分留库。9 种 change 类型里只有 chapter_version 有 deleteVersion 回滚。
**应当**:全失败回滚 — 单条失败回滚本 run 所有已提交变更,或包在一个 DB 事务里。
**违反**:Codex brief 6.1 "No More Half Commits"。

---

## P1 — 假实现 / 误导

### P1-1 validator 是空壳 LLM
**现状**:`ValidatorDeps.model`/`auditModel` 收了但全程 `_deps` 未用。"验证"是 3 条正则(≥100字 / 无"待续"结尾 / 第一人称启发式)。
**应当**:chapter_version 接回 audit-chapter(LLM 7 维审查);或老实改名 `lintStagedChanges`。

### P1-2 repair-agent 是空操作
**现状**:`runRepair` 返回 `{...plan, summary: "修复:..."}`,**不改 draft**。trusted_auto 下的"自动修复"= 把同一个 plan 再验一遍 → 大概率再 fail。summary 谎报"修复了 N 个问题"。
**应当**:repair 对 `reroll` 类 issue 回 executor 真正重生成(带 issue 反馈);`repair` 类 issue 调用具体修复逻辑。

### P1-3 空 plan 静默成功
**现状**:write_chapter 但 Main Agent 没产出 draft → executor 返回空 steps → runner 发 `verdict=pass commitAllowed=false` + `done committed=false`。用户看"完成"但什么都没写,无 error。
**应当**:write_chapter 意图 + 空 plan → 发 `error`(draft_missing),不静默。

---

## P2 — 成本 / UX

### P2-1 buildMainAgentBookContext 成本爆炸
**现状**:把最近 10 章全文 + 中程摘要 + 全部角色塞进**意图分类**这一个调用。query_only 闲聊("你好")也付这堆上下文费。
**应当**:按意图裁剪 — 意图分类只给概要(title/premise/最近章 oneLiner);只有 write_chapter 才注入全文。

### P2-2 conversation 持久化丢助手原文
**现状**:`done.committed=true` 时记固定串"(已通过统一 Agent 管线完成变更)",不是 `assistantReply`。用户聊天历史看不到 AI 实际说了什么。
**应当**:committed 时也持久化 `assistantReply`(若有)。

### P2-3 planAssetAudit 类型错配
**现状**:把 assets 列表塞进 `chapter_audit` staged change,但 commit 里 `chapter_audit` 走 `chaptersRepo.saveAudit`(章级审查)。"资产审查"和"章级审查"是两回事。
**应当**:要么新增 `asset_audit` staged type,要么去掉 asset_audit 意图。

---

## ✅ 做得好的部分(保留)

- 旧路由全 410 + 5 个 guard test — 防回潮扎实
- SSE 事件收敛到 7 个核心 + 通用 agent_progress payload — 方向对
- staging 持久化(workflow_runs/staged_changes)+ approve/cancel 端点 — 刷新可恢复
- main-agent 的 LLM 意图分类思路 — 取代脆弱正则,JSON 解析失败 fallback query_only 安全
