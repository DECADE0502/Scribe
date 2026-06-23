# 写作上下文 / 记忆拼接设计

Date: 2026-06-23
Status: Draft, awaiting user approval
Author: Claude (Opus 4.7 [1M])

## 1. 背景与问题

实际写作过程中,用户第一章用第一人称、过去式;**第二章 POV 漂移**,退化为通用第三人称。

Codex 上一档(commit `103c54b`)定位到:`builder.ts` 没有把 `snapshot.recentFullChapters` 接入 `sections`,所以"前一章原文"被加载到 snapshot 又被悄悄丢弃。同时:

- 默认 `budgetTokens = 32_000`,对 1M 模型(Gemini 2.5 Pro / 任何 `[1m]` 变体)严重低估;
- `recentSummaries` 与 `recentFullChapters` 完全没去重,同一章信息塞两份;
- write 路径 `buildChapterWriteMessages` 没把本章 outline 节点拼进 `intent.chapterPlan`(audit 路径有,write 路径漏);
- `midRangeSummaries` 字段已经加上,但同样没接入 `sections`;
- 章数超 20 后,11+ 章前的事件没有压缩通路,要么靠召回偶然命中,要么被丢。

**根本症状**:写作 prompt 里没有任何信号能稳定锚定叙事腔调与长程信息,模型只能靠召回 + 摘要拼一个"近似"——召回不命中、摘要太抽象,就漂。

## 2. 设计原则

1. **不引入新机制**——不加新工具、不改 onboard 对话流、不引入"叙事契约"独立字段。
2. **拼接而非堆积**——同一信息按距离选择一个粒度,不重复塞。
3. **细节随距离衰减**——最近章原文 → 中近章小总结 → 远期弧总结 → 久远卷总结。
4. **天然层级**——压缩边界沿用 outline 树(章 → 弧 → 卷),不另建结构。
5. **同趟产出**——大总结由 `record_chapter_state` 在已有审查循环里顺手生成,不引入新任务/队列。
6. **降级路径**——用户没填弧/卷的扁平 outline 也要工作。

## 3. 记忆三层

### 3.1 小总结 ChapterSummary(已有)

- **来源**:`record_chapter_state` 在每章写完后产出 `oneLiner + paragraph + keyEvents`。
- **存储**:`workspace.db.chapter_summaries`。
- **消费者**(分级使用,**去重**):
  | 距离 | 用途 |
  |---|---|
  | 第 N-1 ~ N-3 章 | 已被全文覆盖 → **跳过**,不塞 |
  | 第 N-4 ~ N-10 章 | 全文塞不下了 → 小总结顶替 |
  | 第 N-11 ~ N-20 章 | `midRangeSummaries`,中程记忆 |
  | 更远 | 不直接全量塞,等召回命中或被大总结覆盖 |
  | 召回层 | `allSummaries` → 关键词命中检索 5 条 |

### 3.2 弧总结 ArcSummary(新增)

- **来源**:`record_chapter_state` 写完小总结后,**多判一句**:"这一章是不是它所在 arc 节点的最后一章?"
  - 判定方式:outline 树里查本章节点的父节点(arc),取该 arc 下所有 chapter 子节点,看是否本章是最大章号且都已写完。
  - 是 → 同一审查模型再跑一趟,把该 arc 下所有 `ChapterSummary` 揉成 **1-2 段**`ArcSummary`(覆盖:本弧主线/关键事件/留给后续的悬念/视角与文风延续要点)。
  - 写入 `outline_nodes.summary`(节点级 TEXT 列)。
- **失败**:压缩失败时写一条 `reader_issue (severity=warning, type=continuity)`,但不阻断章节提交。
- **重新生成**:用户编辑 outline 或重写章节时,该 arc 的 `summary` 被置空,下次触发时重生。

### 3.3 卷总结 VolumeSummary(新增)

- **来源**:同上,边界改为"volume 节点的最后一章"。
- **存储**:也写在 `outline_nodes.summary`(volume 节点和 arc 节点共用一列)。
- **内容粒度**:3-5 段。覆盖整卷主线、核心人物变化、本卷未结尾的伏笔/承接。

## 4. 数据模型变更

仅一处:

```sql
-- migration: outline_nodes 加 summary 列
ALTER TABLE outline_nodes ADD COLUMN summary TEXT;
```

- 列允许 NULL;arc/volume 节点压缩后填写,chapter 节点保持 NULL。
- 不新建表、不动 chapter_summaries、不动 book_meta、不动 characters/foreshadowing/genre_*。

## 5. 写作上下文的拼接顺序(最终消息序)

```
[system prompt]
[preset blocks]
[设定 DNA]                  ← title/premise/tone/genre/rules.md
[风格参考]                  ← 若启用
[卷总结(远古卷)]           ← VolumeSummary,最粗,通常只 1-3 段
[弧总结(已完成的远弧)]     ← ArcSummary,中粒度
[章小总结(N-11~N-20 章)]   ← midRangeSummaries 接入
[章小总结(N-4~N-10 章)]   ← 与 recentFullChapters 去重后
[召回命中的久远章]          ← worldbook + 召回章节
[当下结构化状态]            ← 出场角色 currentState、活跃伏笔、timeline、reader-issues
[前 N-1~N-3 章原文]         ← 全文,腔调/POV 锚
[本章 outline 节点 + 计划]
[整书 goal 与进度]
[用户最新指令]
[task: "现在写第 N 章"]
```

**关键顺序约束**:
- "前文原文"**必须**紧贴 task 指令前,最大化注意力贴近度。
- "卷/弧总结"按时间倒序进入(更远的先讲、更近的压轴),与人类回忆走向一致。
- 当下结构化状态在前文原文之前——让模型先知道"谁在哪、知道什么",再读前文。

### 5.1 层级选择算法(每章只用一个粒度,不重复)

写第 N 章时,对**每个已写章 c < N**按以下规则选一个粒度:

1. `N - c ∈ [1, 3]` → **全文**(进 recentFullChapters 块)
2. `N - c ∈ [4, 10]` → **小总结**(进"4-10 章小总结"块)
3. `N - c ∈ [11, 20]` → **小总结**(进 midRangeSummaries 块)
4. `N - c > 20`:
   - 4.1 该章所在 arc 节点已有 summary → 进**弧总结块**(整个 arc 只贡献 1 条,不重复)
   - 4.2 arc 没 summary,但所在 volume 已有 summary → 进**卷总结块**
   - 4.3 都没有(扁平 outline)→ 落到 auto_digest 区间块(见 §8)
   - 4.4 召回命中 → 单独进召回层(可叠加,但只补差)

去重原则:**一个 chapter 同时间只出现在一个层级里**。例如某 arc 的 5 章中有 2 章在 [11-20] 窗内、3 章已脱出窗,则:
- 2 章用各自小总结(midRange);
- 3 章**不**用各自小总结,但**不**用整个 arc summary(因为 arc 没全脱出,summary 会描述 arc 内未发生的事件,语义不准)→ 那 3 章退到"只通过召回命中时出现"。
- 一旦该 arc 的 5 章全部脱出窗 → 整 arc 用 ArcSummary 一条搞定。

这样信息既不丢、也不重。

## 6. 裁切优先级(`fitWithinBudget` 数值越大越后裁)

```
任务指令         100
本章 outline+plan 99
设定 DNA         98
前 N-1~N-3 章原文 97
当下结构化状态    96
活跃伏笔         95
弧总结(本卷未脱出窗的) 92
小总结(11~20)   90
worldbook       88
reader-issues   85
小总结(4~10)    82
卷总结           80
召回命中         70
风格参考         65
全部角色背景档案 / 记录集合 schema  40
```

**40 这一档是有意压低的**——批量档案是补差,预算紧时第一个该裁。

## 7. 写作预算 profile

`buildChapterWriteMessages` 新增可选入参 `writeBudgetTokens?: number`,4 个调用点(`chapters.ts` ×2 / `auto.ts` / `conversation-orchestrator.ts`)从 `modelManager.getWriteModelInfo().contextWindow` 阶梯换算:

| contextWindow | writeBudgetTokens |
|---|---|
| ≥ 500_000 | 400_000 |
| ≥ 200_000 | 80_000 |
| ≥ 64_000 | 32_000 |
| < 64_000 | max(8_000, contextWindow * 0.5) |

预留 ~25-30% 给生成输出。

### `[1m]` 后缀识别

`local-model-table.ts` 的 `lookupLocal(id)` 改为:

```ts
export function lookupLocal(id: string): Partial<ModelInfo> | undefined {
  const direct = LOCAL_MODEL_TABLE[id];
  if (id.endsWith("[1m]")) {
    const base = LOCAL_MODEL_TABLE[id.slice(0, -4)] ?? {};
    return { ...base, contextWindow: 1_000_000 };
  }
  return direct;
}
```

任何 `[1m]` 后缀(如 `claude-opus-4-7[1m]`)→ 走基础条目 + 强制 1M。

## 8. 降级:扁平 outline

如果 outline 树里没有 arc/volume 节点(只有章节):

- 大总结不触发,小总结一直用到 20 章窗。
- **当章数 > 30 且无 arc 节点时**,record_chapter_state 自动每 10 章揉一个匿名段,写进 `book_meta` 的 `auto_digest_<startCh>_<endCh>` key——不污染 outline 表,纯 k-v fallback。
- builder 在拼"卷/弧总结层"时,优先取 outline 节点的 summary;没有则按 chapter 区间到 book_meta 取 auto_digest。

## 9. write 路径修 outline 漏接

`buildChapterWriteMessages` 当前 `intent.chapterPlan` 是空的,但 `buildChapterAuditContext` 是有的——这是漏接。统一改为:

```ts
const chapterPlanNode = handle.outlineRepo.findChapterNode(chapterNo);
const chapterPlanText = chapterPlanNode
  ? renderOutlineNodeForWriting(chapterPlanNode)  // 目标 + 关键事件 + 新出场人物
  : undefined;
```

`renderOutlineNodeForWriting` 是新的纯函数,组装节点目标、关键事件、新出场人物为短描述。

## 10. 噪声税(本档同步清理)

1. `renderRecordsBlock` 当前给写作 prompt 也喂了 `(identity:xxx; display:yyy; search:zzz)` schema 描述——这是给记录员看的,写作员不需要。改为只露 `label | 一句 summary`(无 schema 字样)。
2. `renderCharactersBlock` 当前喂 `background/motivation/languageHabits`(baseData)——这是召回层信息。写作 prompt 的 character 块改为"本章出场名单 + currentState 一行",baseData 进召回层(命中本章关键词的角色才补 baseData)。
3. `recentSummaries` 与 `recentFullChapters` 重合的章节号,在 recentSummaries 注入时主动跳过。

## 11. 不在本档范围

明确不做,留下一档:

- ❌ 引入独立的"叙事契约"字段或 `record_narrative_contract` 工具
- ❌ Audit/record-state 输出 `pov/tense/styleFingerprint` 等结构化契约字段
- ❌ 多候选写作(Codex 提的)
- ❌ Memory Clinic(记忆体检 UI)
- ❌ Prompt diagnostics 前端展示(后端 `droppedSectionIds` + 每段 token 估算返回保留,前端展示后续做)
- ❌ 双视图记忆(stale-vs-live 角色档案过滤)

## 12. 验收标准

可写成自动化测试:

1. **前文原文注入**:`snapshot.recentFullChapters` 非空时,messages 里必含其原文片段(可断言含某固定字符串)。
2. **去重**:`recentFullChapters` 覆盖 [18,19,20] 时,messages 中不存在第 18/19/20 章的小总结块。
3. **outline 接入 write 路径**:有 outline 节点时,messages 必含该节点目标文字。
4. **1M 预算**:`writeModelInfo.contextWindow=1_000_000` 时,10 章 ~300k 字符全文不被裁。
5. **裁切顺序**:`budgetTokens = 5_000` 时,首先被丢的是"全部角色背景/记录集合 schema",不是前文原文/任务/本章 plan。
6. **`[1m]` 识别**:`lookupLocal("claude-opus-4-7[1m]")` 返回 contextWindow=1_000_000。
7. **弧总结写入**:种一个 arc 节点含 3 章子节点,模拟跑完第 3 章 record_chapter_state → `outline_nodes.summary` 必非空,且包含 1-2 段中文。
8. **弧总结读出**:有弧总结的弧节点章节脱出 20 章窗后,写下一章时 messages 必含该弧总结(而非该弧下的零散小总结)。
9. **降级**:扁平 outline + 章数 35 → `book_meta.auto_digest_*` 必非空,写第 36 章时 messages 必含该 auto_digest。
10. **噪声去除**:写作 messages 不含 `identity:` / `display:` / `searchFields` 字样;不含角色 `baseData.background` 除非该角色在本章召回意图里命中。

## 13. 涉及文件预估

| 文件 | 改动 |
|---|---|
| `packages/server/src/db/migrations/workspace/0010_outline_summary.sql` | 新文件,加 summary 列 |
| `packages/server/src/db/repositories/outline.ts` | 加 `updateSummary(nodeId, text)`、`findChapterNode(chapterNo)` |
| `packages/server/src/ai/context-builder/snapshot.ts` | 取 outline 节点的 summary,挂到 snapshot |
| `packages/server/src/ai/context-builder/builder.ts` | 加 arc/volume summary section、去重、调整 priority、调整 records/characters 渲染 |
| `packages/server/src/ai/context-builder/book-context.ts` | write 路径补 outline 节点接入;callers 加 writeBudgetTokens |
| `packages/server/src/ai/orchestrator/record-state.ts` | 写完小总结后判 arc/volume 边界,触发大总结压缩;失败写 reader_issue;扁平 outline 触发 auto_digest |
| `packages/server/src/ai/providers/local-model-table.ts` | `lookupLocal` 加 `[1m]` 识别 |
| `packages/server/src/http/routes/chapters.ts` | 2 个调用点 + 预算 |
| `packages/server/src/http/routes/auto.ts` | 1 个调用点 + 预算 |
| `packages/server/src/ai/orchestrator/conversation-orchestrator.ts` | 1 个调用点 + 预算 |
| `packages/server/tests/integration/context-builder.test.ts` | 加 5+ 测试 |
| `packages/server/tests/integration/record-state-arc-summary.test.ts` | 新文件,arc/volume 边界触发 |

工作量估算:**2-3 个工作日**。

## 14. 风险与降级

- **大总结压缩失败**:写一条 reader_issue;builder 在该 arc 的 summary 仍为 NULL 时回退到该弧下的小总结,不至于丢信息(只是多占预算)。
- **outline 中途被用户编辑**:相关 arc/volume 的 summary 应被置 NULL,下次触发重生。**触发清空的具体动作**(在 outline 写接口里加):
  - 节点本身被重命名 / 描述被改 → 清自身 summary
  - 节点的子节点被增/删/移 → 清自身 summary + 所有祖先节点 summary
  - 节点被移到另一个父节点下 → 清原父祖先链 + 新父祖先链
  - "重生时机"沿用现有触发(下次该 arc/volume 末章 record_chapter_state 时);**清空后到下次写章节中间这段窗口,builder 退回到该弧/卷的小总结层**,信息不丢只是粒度变粗。
- **重写章节(/rewrite)**:重写的章被替换,该 arc/volume(以及它们的祖先链)的 summary 应被置 NULL 重生——在 chapters 重写接口里加同样的"清祖先链"调用。
- **章节数极多(100+)**:每写一章可能触发多层压缩(章末 → arc 末 → volume 末)。多层串行,可接受;若延迟敏感,后续可异步化,这一档不做。
