# 架构审视 2026-06-24:三代叠加的 AI 工作流

Audience: 下一轮实现 agent / Codex review。

## 现状诊断

Scribe 当前同时存在三代 AI 工作流架构,旧的没删,新的骨架未通电:

### 文件证据

```
conversation-orchestrator.ts (824 行 god file)
  ├─ 导入 30+ 模块
  ├─ 混了:意图分类 + 写章 + 审查 + 记录状态 + 四套工具 + 对话 + 删除 + SSE 路由
  └─ 一个文件里拼了 8 个 async generator

三套写章路径,互不通气:
  /chapters/:no/write        → writeWithAudit → 直接落盘(gen1)
  /chapters/:no/write-draft  → writeChapterSimple → 只写 prose 不验证(gen2)
  /chapters/:no/finalize     → audit → repair → hard-fact-gate 独立三步(gen2)
  /agent/run                 → agent-runner(骨架,Main Agent 还是 regex)(gen3)

SSE 事件:30+ discriminated union variant,加一个事件要改 shared/server/client 三处
```

### 数字

| 维度 | 数字 |
|---|---|
| AI 入口点 | 8 个(/conversation、/write、/write-draft、/finalize、/auto、/onboard、/worldbook/chat、/revise-segment) |
| orchestrator 文件 | 18 个,其中 conversation-orchestrator 824 行 |
| 路由文件 | 14 个,2339 行 |
| shared types | 15 个,1094 行 |
| 写章路径 | 3 套独立实现 |

### 核心问题

**Codex 提出的"统一管线"目标根本没达成。** `agent-runner` 是骨架,真正的 prose 生成还在 `write-chapter.ts` 里直接写盘。Main Agent 用 `/写\s*第?\s*(\d+)\s*章/` 这种正则做意图分类——已经在测试中出现"写第 6 章"没被匹配的 bug。

---

## 6 条改动建议(按影响排序)

### ① P0 — record-state 异步化

**现状**:每章写完要等 record-state 跑完(60s+)才返回 `done`。

**改动**:prose 写完后立即 `done`,record-state 异步后台跑,失败写 `reader_issue`。

**效果**:用户感知速度翻倍,写完就能立刻读正文。record-state 失败不阻断章节,已经通过现有 reader_issue 机制可见。

**工作量**:1h。`recordChapterState` 改成 fire-and-forget:`void recordChapterState(deps, input)` 不 await,在主流程里继续 yield done。

---

### ② P0 — Main Agent 换 LLM 而非 regex

**现状**:`main-agent.ts` 用 `/写\s*第?\s*(\d+)\s*章/` 做意图分类。脆弱,且已经出现漏匹配。

**改动**:换成 10 行 LLM 调用,用 structured output 返回 `taskContract`。AI 最适合干"理解用户要什么",不需要手写正则。

**效果**:意图识别不再出错,且能识别"帮我把第三章的角色列表出来"这种 regex 永远抓不到的复合意图。

**工作量**:2h。复用 `generateLlmText` + `agent-workflow.ts` 里已有的 `IntentContractSchema` 做 structured output。

---

### ③ P1 — Executor 吞掉 write-chapter.ts

**现状**:executor-agent.ts 只做角色去重,真正的 prose 生成还在 write-chapter.ts 里直接写盘。

**改动**:把 write-chapter 的 prose 生成逻辑移到 executor 内部,输出到 staging,validator 通过后才 commit。

**效果**:真正实现 Codex 提的"验证不通过不落盘"。当前 `/write` 还是 prose 直接落盘后再审查,审查失败时章已经写进磁盘了。

**工作量**:4h。`writeChapterSimple` 的逻辑拆出来,产出 `chapter_version` 类型的 `StagedChange`,不直接调 `chapterFiles.save`。

---

### ④ P2 — 合并 /write-draft + /finalize 进 /agent/run

**现状**:前端有"写草稿"和"定稿"两个按钮,是 gen2 的中间态。

**改动**:前端只暴露一个"写"按钮。draft/finalize 是管线内部状态,不应该是用户选择。write-draft 这个中间态直接拿掉。

**效果**:减少用户困惑(写完到底是草稿还是定稿?)。codex 在 brief 里明确说要废弃 write-draft。

**工作量**:2h。前端 editor-pane 改成单一"写"按钮,后端 `/write-draft` 返回 410。

---

### ⑤ P3 — SSE 事件简化

**现状**:30+ discriminated union variant,`execution_plan` 已经出现了"新旧两种 shape 共存"的兼容补丁(见 sse-events.ts:50-61)。

**改动**:30+ variant → 6 个通用事件:`phase` / `text` / `tool_start` / `tool_end` / `done` / `error`。工具相关 shape 做 JSON payload,不在类型层区分。

**效果**:加新功能不用改 shared 类型。当前每加一个 workflow 阶段都要改 shared + server + client 三处。

**工作量**:3h。shared 重写 sse-events,server 把所有自定义事件塞进通用 payload,client 解析时按 type 分发。

---

### ⑥ P3 — 拆 conversation-orchestrator.ts god file

**现状**:824 行的 god file,单一职责严重违反。

**改动**:拆成 4 个文件:
- `intent.ts`(已有,意图分类)
- `chat-handler.ts`(纯对话部分)
- `tool-registry.ts`(四套工具体系注册)
- `trigger-router.ts`(trigger action 路由)

每个文件 <200 行。

**效果**:可读性,可测性。改一处写章逻辑不用翻 800 行。

**工作量**:3h。纯重构,无行为变化。

---

## 优先级矩阵

| 优先级 | 改动 | 影响 | 工作量 |
|---|---|---|---|
| P0 | ① record-state 异步 | 用户体验直接翻倍 | 1h |
| P0 | ② Main Agent 换 LLM | 意图识别不再出错 | 2h |
| P1 | ③ Executor 吞 write-chapter | 真正实现"验证后落盘" | 4h |
| P2 | ④ 干掉 write-draft/finalize | 减少用户困惑 | 2h |
| P3 | ⑤ SSE 简化 | 降低维护成本 | 3h |
| P3 | ⑥ 拆 god file | 可读性 | 3h |

**总工作量:15h(约 2 工作日)。** 不含测试。每条都应带 TDD。

---

## 15 章实测验证的发现

用 opencodego → deepseek-v4-pro 跑了《废土长生》15 章:

| 模型 | 章节 | 费用/章 | POV 漂移 | record_state |
|---|---|---|---|---|
| claude-sonnet-4-6 | Ch1-12 | $0.18 | 0 次 | 12/12 ✅ |
| deepseek-v4-pro | Ch13-15 | $0.028 | 0 次 | 3/3 ✅ |

### 质量对比

| 维度 | Claude Sonnet | DeepSeek V4 Pro |
|---|---|---|
| 对话 | 紧凑,潜台词密度高 | 功能性强,略平 |
| 描写 | 精准,用最少字 | 极细腻,密度大,偶尔偏长 |
| 节奏 | 快,剪辑感强 | 偏慢,沉浸式 |
| 逻辑推理 | 好 | Ch14 莫尔斯电码段是真厉害 |
| 人物 | 几句话立住 | 通过细节积累 |
| AI 痕迹 | 无 | 无 |
| **成本** | $0.18/章 | $0.028/章(1/6) |

**结论**:两个模型都在产出可发表级别的中文小说。Claude 赢在节奏和对话,DeepSeek 赢在感官密度和推理链条。DeepSeek 是性价比最高的一刀。

### 已暴露的运行时问题

1. **Ch15 被 deepseek-v4-pro 截断到 700 字** — 重写指令明确"3000字以上"后才正常产出 5552 字。说明当前模型调用没有 min_tokens 或 max_tokens 的硬约束,模型偶尔会输出过短。
2. **正则意图漏匹配** — "写第 6 章"这种正常输入在 live 测试里没被 main-agent.ts 的 `/写\s*第?\s*(\d+)\s*章/` 捕获(实际是 curl UTF-8 编码问题,但暴露了 regex 方案的脆弱)。
3. **record_state 同步阻塞** — 每章 done 事件之前要等 60s+ 的 record-state 跑完。

---

## 不在本档范围

- 旧 conversation-orchestrator.ts / write-with-audit.ts / write-chapter.ts 的删除(等 gen3 管线完全通电后再做)
- 前端四阶段 UI 改造(Codex brief Phase 9,单独档)
- worldbook/chat 迁移
- 暂存层持久化 commit 失败的逐条回滚(当前只记 failed[],不回滚已成功)
