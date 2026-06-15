# 交接文档:题材记录系统的通用化重构(给 Codex review + 规划)

> 作者:Claude(上一任)。读者:Codex(下一任)。目标:请你 **review 当前实现 + 指出我的架构错误 + 规划真正通用的方案**,而不是直接照我的思路改。

## 1. 一句话背景

这是一个本地运行的中文长篇小说写作引擎(monorepo:`packages/shared` 类型、`packages/server` Hono+SQLite+Vercel AI SDK、`packages/client` React)。核心卖点是**对话式建书 + AI 自动连续写作 + AI 按题材自动记录设定**(防漂移/防 OOC)。

链路:对话建书(onboard)→ 一级/弧级大纲 → 逐章 `写作 → 审查 → 章末状态记录` 自动循环。供应商支持 DeepSeek 和小米 MiMo(OpenAI 兼容,`api-key` 头)。

## 2. 用户的核心诉求(必须读懂,这是验收标准)

用户原话,逐条:

> "小说专属的数据类还可以多一些细一些(不一定只有一种,例如修仙小说会有特别多)"

> "你这个到底是专属优化还是通用的,我咋感觉你写死了这篇小说的优化呢"

> **"你得通过合理的提示词和知识注入约束 AI,让 AI 输出符合目标的东西,再用脚本去解析我们需要的东西才对啊"**

> **"我只要本地做好通用接口,AI 来调用增加各种记录,你怎么一直在特化"**

**用户要的架构(我反复领会后的理解,请你校验对不对):**
- 本地(server)只提供**题材无关的通用接口/工具**(建板块、加条目、记角色/伏笔/时间线…)。
- AI 通过**提示词 + 知识注入**被约束成"按目标输出结构化数据",然后**调用通用工具**把记录落库。
- 脚本端**只读 AI 已声明/已结构化的东西,绝不靠"猜"**(不能硬编码"功法名/势力名"这种字段名,也不能假设"第一个必填字段就是名字")。
- 不允许出现任何针对某一本书 / 某一题材写死的逻辑分支。

## 3. 我做了什么(可能对、可能是错的方向)

我承认我反复在"特化"和"伪通用"之间打转,用户批评了我两次。当前 HEAD 的状态:

### 3a. 已有的通用工具接口(AI 可调用,定义在 `packages/server/src/ai/tools/`)
- `genre-section-tools.ts`:`create_genre_section`、`add_genre_section_item`、`update_genre_section_schema`、`update_genre_section_item`、`delete_genre_section`、`delete_genre_section_item`
- `state-tools.ts`:`create_character`、`update_character_state`、`add_character_appearance`、`add_foreshadowing`、`pay_foreshadowing`、`add_timeline_event`
- `book-meta-tools.ts`:`set_book_meta`、`create_character`、`create_outline_node` 等(onboard 用)

这套"AI 自建题材板块"的设计本身是通用的:板块不是预定义的,schema 由 AI 用 `create_genre_section` 自由定义。字段类型系统见 `packages/shared/src/types/genre-section.ts` 的 `GenreFieldTypeSchema`(支持 string/text/number/enum/ref:character/ref:section/list:* 等)。

### 3b. 我最近这次改动(`isLabel` 方案)—— 重点请你审这个对不对
**问题起源**:`buildArchiveSummary`(`packages/server/src/ai/orchestrator/record-state.ts`)要把"已有条目"列给 AI 看,需要每个条目的"显示名"。我原来写的是:
```js
i.data.name ?? i.data["名称"] ?? i.data["功法名"] ?? i.data["境界名"] ?? i.data["势力名"] ?? "?"
```
这是硬编码字段名猜测 —— 用户正是看到这行才说"你写死了这篇小说的优化"。前端 `genre-section-panel.tsx` 也有 `item.data.name ?? item.data.label`,对中文字段名(功法名)直接显示"(未命名)"。

**我的修法(已提交,见最近 commit)**:给字段 schema 加 `isLabel: boolean` 标志,要求 AI 在 `create_genre_section` 时声明哪个字段是显示名;`normalizeLabelField` 保证落盘 schema 恰好一个 `isLabel`;共享 `resolveItemLabel/resolveLabelFieldName` 给前后端统一调用。

## 4. 我自己怀疑的点(请你重点判断)

1. **`isLabel` 到底算不算"真通用"?** 它确实做到了"AI 声明 + 脚本读声明,不猜"。但 `normalizeLabelField` 里我又写了一层兜底:AI 没声明 isLabel 时,自动把"第一个必填字段、否则第一个字段"提升为 label。**这层兜底是不是又在'猜'?** 还是说作为旧数据/AI 偶尔不听话时的降级是合理的?请你判断这个边界。

2. **更根本的问题:`isLabel` 是不是只解决了"显示名"这一个症状,没解决病根?** 用户说的是"小说专属数据类要多要细、要通用"。除了显示名,通用题材记录可能还需要:
   - 条目的**唯一标识/去重键**(现在 `add_genre_section_item` 完全不去重,AI 可能重复添加"吞天诀"两次 —— 这是真 bug,我没修)。
   - 条目之间的**关系/引用**(已有 `ref:section` 字段类型,但 AI 几乎不用)。
   - 字段的**语义角色**(哪个是名字、哪个是等级/排序、哪个是描述)—— 现在除了 isLabel 全靠 AI 自由发挥,渲染和召回都没法利用这些语义。
   - **召回**(`recall.ts`)目前只对摘要全文做子串匹配捞相关历史章,题材条目根本没参与召回。

3. **是否该让 AI 定义 schema 时就声明每个字段的"语义角色"(label/rank/desc/ref…)**,而不是只声明一个 isLabel?这样脚本端能完全通用地渲染、排序、去重、召回。这是不是用户真正想要的"通用接口"?

4. **去重缺失**:`genre-section-tools.ts` 的 `add_genre_section_item` 没有任何去重。`state-tools.ts` 的 `create_character`/`add_foreshadowing` 有按名字去重。题材条目应该按"label 字段值"去重吗?还是让 AI 先查再加?

## 5. 关键文件清单(你 review 时按这个顺序看)

| 文件 | 作用 | 我改过的地方 |
|---|---|---|
| `packages/shared/src/types/genre-section.ts` | 题材板块字段类型 + `isLabel` + `resolveItemLabel/resolveLabelFieldName` | 新增 isLabel 和两个 resolver |
| `packages/server/src/ai/tools/genre-section-tools.ts` | AI 的板块增删改工具 + `normalizeLabelField` | create/update 加 normalize;**无去重** |
| `packages/server/src/ai/tools/state-tools.ts` | AI 的角色/伏笔/时间线工具 | create_character 有去重 |
| `packages/server/src/ai/orchestrator/record-state.ts` | 章末状态记录编排 + `buildArchiveSummary`(给 AI 看的档案概要) + `RECORD_STATE_PROMPT` | 用 resolveItemLabel 替换硬编码猜名 |
| `packages/server/src/ai/prompts/new-book-onboard.ts` | onboard 提示(要求 AI 建板块、声明 isLabel、拆弧级大纲) | 加 isLabel 要求、板块宁多宁细 |
| `packages/server/src/ai/context-builder/recall.ts` | 召回相关历史章(子串匹配打分) | 上一轮改成子串匹配;题材条目未参与 |
| `packages/server/src/ai/context-builder/book-context.ts` | `buildChapterWriteMessages` 组装每章写作上下文 | deriveRecallIntent |
| `packages/client/src/components/sidebar/genre-section-panel.tsx` | 题材板块的前端渲染/编辑 | 用 resolveItemLabel/resolveLabelFieldName |
| `packages/server/src/ai/genre-section-validator.ts` | 条目数据按 schema 校验 | 未改;isLabel 未纳入校验 |

## 6. 当前测试状态(你改之前的基线)
- `pnpm --filter @scribe/shared test` → 27 passed
- `pnpm --filter @scribe/server test` → 361 passed
- `pnpm --filter @scribe/client test` → 80 passed
- E2E:`pnpm --filter scribe-e2e test`(需先关掉占用 6789 的 dev server)→ 2 passed
- 全部 typecheck 干净:`pnpm -r exec tsc --noEmit`

## 7. 我请你做的事(明确)

1. **审 `isLabel` 方案**:是朝对的方向走,还是治标不治本?该不该推倒重来成"字段语义角色"体系?
2. **规划真正通用的题材记录架构**:让本地只提供通用接口、AI 靠提示词+知识注入产出结构化数据、脚本只读声明。给出具体的数据模型 + 工具接口 + 提示词约束设计。
3. **点名我遗留的真 bug**:题材条目无去重;召回不含题材条目;isLabel 未进 validator。哪些必须修、哪些可延后。
4. 给一个**分步落地计划**(每步可独立测试),别一次性大改。

## 8. 怎么跑起来看实际产出
- 启动:`packages/server` 跑 `pnpm exec tsx src/main.ts`(读 `~/.../scribe` 的 config,当前 provider=mimo);前端 `packages/client` 跑 `pnpm dev`(:5173,代理 /api 到 :6789)。
- 已有两本真实跑出来的书可供观察记录质量:`玄剑录`(仙侠,DeepSeek,17 章)、`回溯者`(都市异能,MiMo,12 章)。
- 有现成的质检脚本:`packages/server/tools/quality-dump.ts <bookId>`(dump 审查/摘要逐章产出)、`tools/audit-state.ts <bookId>`(dump 题材板块/角色/伏笔/时间线)。
- **已知的链路真问题**(我上一轮发现并部分修过):召回"燃料"曾因摘要伏笔词与伏笔表 label 用词不一致几乎全失效(已改子串匹配缓解);审查 7 维 score 曾落盘丢失(已修)。这些可作为"链路质量"判断的参考。
