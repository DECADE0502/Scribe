# 恢复写作引擎实现计划

> **问题清单:** `docs/ARCHITECTURE-REVIEW-2026-06-25-PIPELINE-REGRESSION.md`

**Goal:** 在统一管线 `/agent/run` 内接回流式 writer / record-state / 语义审查 / 弧压缩,消除半提交,修假 repair,不再静默失败。

**Architecture:** Main Agent 只做意图分类(不写正文);write_chapter 时 executor 调独立流式 writer(复用 buildChapterWriteMessages + streamLlm);commit 全失败回滚(单事务);commit 后异步 record-state + arc 压缩;validator 对 chapter_version 接回 audit-chapter;repair 对 reroll 真正重生成。

**Tech Stack:** TS5+, Hono, better-sqlite3, Vercel AI SDK, Vitest, Zod.

**工作目录:** `D:\desktop\Scribe-gh`。命令从根跑。

---

### Task 1: writer service — 提取流式正文生成

**Files:**
- Create: `packages/server/src/ai/orchestrator/writer-service.ts`
- Create: `packages/server/tests/unit/ai/orchestrator/writer-service.test.ts`

把 `buildChapterWriteMessages` + `streamLlm` 封装成一个可被 executor 调用的纯函数,产出完整正文(供 staging)。

- [ ] **Step 1: 写失败测试**

```ts
// writer-service.test.ts
import { describe, expect, it, vi } from "vitest";
import { generateChapterDraft } from "../../../../src/ai/orchestrator/writer-service.js";

describe("generateChapterDraft", () => {
  it("用 mock streamLlm 返回拼好的完整正文", async () => {
    const mockHandle = {
      bookId: "b1", bookMetaRepo: { get: () => undefined },
      charactersRepo: { list: () => [] }, outlineRepo: { listAll: () => [], findChapterNode: () => undefined },
      foreshadowingRepo: { list: () => [] }, chaptersRepo: { listSummaries: () => [] },
      chapterFiles: { list: () => [], read: () => undefined },
      genreSectionsRepo: { listSections: () => [], listItems: () => [] },
      worldbookRepo: { list: () => [] }, promptPresetsRepo: { listPresets: () => [], listBlocks: () => [] },
      readerIssuesRepo: { listOpen: () => [] },
      timelineRepo: { listAll: () => [] }, rulesMdPath: "/dev/null",
    } as any;
    const result = await generateChapterDraft({
      handle: mockHandle, model: {} as any, chapterNo: 5, userIntent: "写第 5 章",
      streamDeltas: async function* () { yield "我推开门。"; yield "冷风扑面。"; },
    });
    expect(result.text).toBe("我推开门。冷风扑面。");
  });

  it("正文不足阈值抛 draft_too_short", async () => {
    await expect(generateChapterDraft({
      handle: {} as any, model: {} as any, chapterNo: 5, userIntent: "x",
      streamDeltas: async function* () { yield "短"; },
    })).rejects.toThrow(/draft_too_short/);
  });
});
```

- [ ] **Step 2: 跑测确认失败** → FAIL(import 不存在)。

- [ ] **Step 3: 实现**

```ts
// writer-service.ts
import type { BookHandle } from "../../http/book-registry.js";
import type { LanguageModel } from "ai";
import { buildChapterWriteMessages } from "../context-builder/book-context.js";

export interface WriterDeps {
  handle: BookHandle;
  model: LanguageModel;
  abortSignal?: AbortSignal;
  styleReferences?: any[];
}

export interface GeneratedDraft {
  text: string;
  messages: import("ai").CoreMessage[];
}

const MIN_DRAFT_CHARS = 500;

export async function generateChapterDraft(
  deps: WriterDeps,
  opts: { chapterNo: number; userIntent: string },
  streamDeltas: (deps: WriterDeps) => AsyncIterable<string>,
): Promise<GeneratedDraft> {
  // 复用分层上下文构建(prompt-cache 友好)
  const ctx = buildChapterWriteMessages(
    deps.handle, opts.chapterNo, opts.userIntent, undefined, deps.styleReferences ?? [],
  );
  let text = "";
  for await (const delta of streamDeltas(deps)) text += delta;
  if (text.trim().length < MIN_DRAFT_CHARS) {
    throw new Error(`draft_too_short: ${text.trim().length} chars (need ${MIN_DRAFT_CHARS})`);
  }
  return { text, messages: ctx.messages };
}
```

`streamDeltas` 注入:生产里包 `streamLlm`,测试里 mock。

- [ ] **Step 4: 跑测确认通过** → PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/ai/orchestrator/writer-service.ts packages/server/tests/unit/ai/orchestrator/writer-service.test.ts
git commit -m "feat(writer): extract streaming chapter draft service"
```

---

### Task 2: executor — write_chapter 调 writer service

**Files:**
- Modify: `packages/server/src/ai/orchestrator/executor-agent.ts`
- Modify: `packages/server/tests/unit/ai/orchestrator/executor-agent.test.ts`

write_chapter 意图时不再依赖 `task.draft`,改调 `generateChapterDraft`。

- [ ] **Step 1: 写失败测试**

```ts
it("write_chapter 调 writer 注入器产出 chapter_version staged change", async () => {
  const deps = {
    model: {} as any,
    handle: { bookId: "b1", charactersRepo: { list: () => [] }, outlineRepo: { listAll: () => [] } } as any,
    writeDraft: async () => ({ text: "我推开门,冷风扑面。".repeat(60), messages: [] }),  // 600+ chars
  } as any;
  const plan = await runExecutor(deps, {
    intent: "write_chapter", userInstruction: "写第 5 章",
    affectedEntities: [], targetChapterNo: 5,
  });
  expect(plan.steps).toHaveLength(1);
  expect(plan.steps[0].type).toBe("chapter_version");
  expect((plan.steps[0].payload as any).content.length).toBeGreaterThan(500);
});
```

- [ ] **Step 2: 跑测确认失败** → FAIL(仍走旧 draft 路径,内容为空)。

- [ ] **Step 3: 实现**

`ExecutorDeps` 加可选 `writeDraft`:
```ts
export interface ExecutorDeps {
  model: unknown;
  handle: { /* 同前 */ };
  writeDraft?: (chapterNo: number, userIntent: string) => Promise<{ text: string }>;
}
```
`planChapterWrite` 改签名 `async`,优先调 `deps.writeDraft`,失败回退 `task.draft`,都无则空 plan + summary 标 draft_missing。
`runExecutor` 把 `write_chapter` 分支改成 `await planChapterWrite(deps, task)`。

- [ ] **Step 4: 跑测确认通过** → PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/ai/orchestrator/executor-agent.ts packages/server/tests/unit/ai/orchestrator/executor-agent.test.ts
git commit -m "feat(executor): write_chapter calls streaming writer service"
```

---

### Task 3: main-agent — 只分类意图,不写正文

**Files:**
- Modify: `packages/server/src/ai/orchestrator/main-agent.ts`
- Modify: `packages/server/tests/unit/ai/orchestrator/main-agent.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
it("write_chapter 意图不返回 draft(由 executor 负责生成)", async () => {
  const deps = { generateText: async () => ({ text: JSON.stringify({ intent: "write_chapter", reply: "好的,写第5章。" }) }) } as any;
  const out = await analyzeIntent(deps, { message: "写第5章", source: "chat" });
  expect(out.taskContract.intent).toBe("write_chapter");
  expect(out.draft).toBeUndefined();   // 关键:不再要 draft
});
```

- [ ] **Step 2: 跑测确认失败** → FAIL(当前会尝试产出/透传 draft)。

- [ ] **Step 3: 实现**
- system prompt 删掉 "If you write prose, put the full hidden draft in draft"
- `parseDecision` 后丢弃 `decision.draft`
- `buildIntentMessages` 注入按意图裁剪:意图分类只给 title/premise/最近 3 章 oneLiner,不注入全文

- [ ] **Step 4: 跑测确认通过** → PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/ai/orchestrator/main-agent.ts packages/server/tests/unit/ai/orchestrator/main-agent.test.ts
git commit -m "refactor(main-agent): classify intent only, no prose generation"
```

---

### Task 4: staging atomic commit — 全失败回滚

**Files:**
- Modify: `packages/server/src/ai/orchestrator/workflow-staging.ts`
- Modify: `packages/server/tests/unit/ai/orchestrator/workflow-staging.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
it("commit 单条失败时回滚已提交变更,committed 为空", () => {
  const runId = randomUUID();
  staging.begin(runId, { bookId: "b1", source: "chat" });
  staging.add(runId, { id: "c1", type: "character_upsert", payload: { name: "林尘" } });
  staging.add(runId, { id: "c2", type: "INVALID_TYPE", payload: {} });   // 失败
  const result = staging.commit(runId, mockHandle as any);
  expect(result.committed).toHaveLength(0);            // 关键:不再半提交
  expect(result.failed).toHaveLength(1);
  // c1 不应留在库
  expect(handle.charactersRepo.list()).not.toContainEqual(expect.objectContaining({ name: "林尘" }));
});
```

- [ ] **Step 2: 跑测确认失败** → FAIL(当前 c1 会留在库里)。

- [ ] **Step 3: 实现**

`commit` 改两阶段:
1. **预演**:逐条 applyChange 到内存标记,任一失败 → 进入回滚
2. **回滚**:对已 apply 的变更按 type 调对应 `rollback*`(character_upsert 删新建的、chapter_version deleteVersion 等)
3. 全成功才批量 markChangeCommitted

简化版(若 rollback 复杂):整个 commit 包在 better-sqlite3 `db.transaction` 里,失败抛错由 transaction 回滚。但 chapter_version 写的是文件系统(chapterFiles.save),DB 事务管不到文件 —— 所以 chapter_version 仍需 try/deleteVersion(已有)。

最小可行:对 DB 类 change(character/outline/worldbook/record/foreshadowing/timeline)用 `db.transaction`;chapter_version/chapter_summary 保持单条 try/rollback;任一失败 → 已提交的全部回滚或反操作。

- [ ] **Step 4: 跑测确认通过** → PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/ai/orchestrator/workflow-staging.ts packages/server/tests/unit/ai/orchestrator/workflow-staging.test.ts
git commit -m "fix(staging): atomic commit with rollback on partial failure"
```

---

### Task 5: agent-runner — 接线 writer 流式 + record-state 异步 + 空 plan 报错

**Files:**
- Modify: `packages/server/src/ai/orchestrator/agent-runner.ts`
- Modify: `packages/server/tests/unit/ai/orchestrator/agent-runner.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
it("write_chapter:流式 text_delta 事件 + 完成后 committed=true", async () => {
  const events = [];
  for await (const ev of runAgentWorkflow(mockDeps(), { message: "写第 5 章", source: "editor" })) events.push(ev);
  expect(events.some(e => e.type === "text_delta")).toBe(true);   // 流式
  expect(events.some(e => e.type === "done" && e.committed)).toBe(true);
});

it("write_chapter 但 draft 生成失败 → 发 error 不静默", async () => {
  const deps = mockDeps({ writeDraft: async () => { throw new Error("draft_too_short"); } });
  const events = [];
  for await (const ev of runAgentWorkflow(deps, { message: "写第 5 章", source: "editor" })) events.push(ev);
  expect(events.some(e => e.type === "error")).toBe(true);
  expect(events.some(e => e.type === "done" && e.committed)).toBe(false);
});

it("commit 后触发 record-state(异步,不阻断 done)", async () => {
  const deps = mockDeps();
  const events = [];
  for await (const ev of runAgentWorkflow(deps, { message: "写第 5 章", source: "editor" })) events.push(ev);
  // done 在 record-state 完成前发出
  expect(events.filter(e => e.type === "done")[0]).toBeTruthy();
  // 但 record-state 最终被调用(可能稍后)
  expect(deps.recordStateCalled).resolves.toBe(true);
});
```

- [ ] **Step 2: 跑测确认失败** → FAIL。

- [ ] **Step 3: 实现**
- `AgentRunnerDeps` 加 `writeDraft: (chapterNo, intent) => AsyncIterable<{type, delta?}>` 流式注入器 + `recordState?: (chapterNo, content) => Promise<void>`
- `runAgentWorkflow` 的 executing 阶段:write_chapter 时边 stream 边 `yield {type:"text_delta", delta}`,全部 delta 拼成 text 注入 chapter_version staged change
- executor 改传流式注入器而非返回 text(或 executor 内部消费流并返回 final text)
- commit 成功后:`void deps.recordState?.(chapterNo, content)`(不 await,失败写 reader_issue)
- 空 plan + write_chapter 意图 → `yield {type:"error", errorClass:"draft_missing"}`

- [ ] **Step 4: 跑测确认通过** → PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/ai/orchestrator/agent-runner.ts packages/server/tests/unit/ai/orchestrator/agent-runner.test.ts
git commit -m "feat(agent-runner): stream prose, async record-state, fail on empty draft"
```

---

### Task 6: validator — chapter_version 接回 audit-chapter

**Files:**
- Modify: `packages/server/src/ai/orchestrator/validator-agent.ts`
- Modify: `packages/server/tests/unit/ai/orchestrator/validator-agent.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
it("chapter_version 调 auditChapterMock,verdict 跟随 audit 结果", async () => {
  const deps = {
    handle: { bookId: "b1" } as any, model: {} as any,
    auditChapter: async () => ({ verdict: "warning", issues: [{ severity: "warning", message: "POV 漂移", area: "chapter", suggestedAction: "repair" }] }),
  } as any;
  const report = await validateStagedChanges(deps, [
    { id: "c1", type: "chapter_version", payload: { chapterNo: 5, content: "我推开门。".repeat(60) } },
  ], "写第 5 章");
  expect(report.verdict).toBe("repairable");
  expect(report.issues.some(i => i.message.includes("POV"))).toBe(true);
});

it("其它 change 类型仍走 lint 正则,不调 audit", async () => {
  let called = false;
  const deps = { handle: { bookId: "b1" } as any, model: {} as any, auditChapter: async () => { called = true; return { verdict: "ok", issues: [] }; } } as any;
  await validateStagedChanges(deps, [
    { id: "c1", type: "character_upsert", payload: { name: "林尘" } },
  ], "");
  expect(called).toBe(false);
});
```

- [ ] **Step 2: 跑测确认失败** → FAIL(auditChapter 不存在)。

- [ ] **Step 3: 实现**
- `ValidatorDeps` 加 `auditChapter?: (change) => Promise<{verdict, issues}>`
- `validateChapterVersion` 先跑现有 lint,再 `await deps.auditChapter?.(change)` 合并 issues
- audit verdict: ok→无 issue, warning/critical→对应 severity
- 其它 change 类型不调 auditChapter

- [ ] **Step 4: 跑测确认通过** → PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/ai/orchestrator/validator-agent.ts packages/server/tests/unit/ai/orchestrator/validator-agent.test.ts
git commit -m "feat(validator): route chapter_version through LLM audit"
```

---

### Task 7: repair — reroll 真正重生成

**Files:**
- Modify: `packages/server/src/ai/orchestrator/repair-agent.ts`
- Modify: `packages/server/tests/unit/ai/orchestrator/repair-agent.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
it("对 reroll issue 调 rewriteDraft 重生成对应章", async () => {
  const rewriteDraft = vi.fn(async () => "我推开门,冷风扑面。".repeat(60));
  const report = { verdict: "repairable" as const, commitAllowed: false, issues: [
    { severity: "critical" as const, area: "chapter" as const, message: "POV 漂移", suggestedAction: "reroll" as const },
  ] };
  const plan = { steps: [{ id: "c1", type: "chapter_version", payload: { chapterNo: 5, content: "他推开门。" } }], summary: "x" };
  const result = await runRepair(report, plan, ["0"], { rewriteDraft });
  expect(rewriteDraft).toHaveBeenCalledWith(5, expect.anything());
  expect((result.repairedPlan.steps[0].payload as any).content).not.toBe("他推开门。");
});
```

- [ ] **Step 2: 跑测确认失败** → FAIL(当前不改 draft)。

- [ ] **Step 3: 实现**
- `runRepair` 加第 4 参 `opts?: { rewriteDraft?: (chapterNo, feedback) => Promise<string> }`
- 遍历 approvedIssues:`suggestedAction === "reroll"` 且对应 chapter_version change → `const fresh = await opts.rewriteDraft(chapterNo, issue.message)`,替换 payload.content
- `suggestedAction === "repair"` → 同样 rewrite 但 feedback 带"修复:..."前缀
- summary 反映真实重生成

- [ ] **Step 4: 跑测确认通过** → PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/ai/orchestrator/repair-agent.ts packages/server/tests/unit/ai/orchestrator/repair-agent.test.ts
git commit -m "fix(repair): reroll issues actually regenerate draft"
```

---

### Task 8: 接线 + 集成验证

**Files:**
- Modify: `packages/server/src/http/routes/agent.ts`
- Create: `packages/server/tests/integration/agent-write-pipeline.test.ts`

- [ ] **Step 1: 写集成测试**

```ts
it("source:editor 写第 1 章 → 流式 text_delta + committed + record-state 被调", async () => {
  const app = createTestApp({ model: mockStreamModel(), auditModel: mockAuditModel() });
  const res = await app.request("/api/books/b1/agent/run", {
    method: "POST", headers: { "Content-Type": "application/json", "X-Scribe-Session": TOKEN },
    body: JSON.stringify({ message: "写第 1 章,第一人称", source: "editor" }),
  });
  const text = await res.text();
  expect(text).toContain("text_delta");
  expect(text).toContain('"committed":true');
});
```

- [ ] **Step 2: agent.ts 路由注入 writer(包 streamLlm)、recordState(包 recordChapterState)、auditChapter(包 auditChapter)、rewriteDraft(包 writer-service)**

```ts
const inner = runAgentWorkflow({
  handle, model, auditModel, staging,
  writeDraft: async function* (chapterNo, intent) {
    const stream = streamChapterDraft({ handle, model, abortSignal }, { chapterNo, userIntent: intent });
    for await (const ev of stream) if (ev.type === "text_delta") yield ev.delta;
  },
  recordState: (chapterNo, content) => recordChapterState(recordStateDeps(handle), { chapterNo, chapterContent: content, archiveSummary }).next(),  // fire-and-forget
  auditChapter: (change) => auditChapter(auditDeps(handle), { chapterNo: change.payload.chapterNo, content: change.payload.content }),
  rewriteDraft: (chapterNo, feedback) => generateChapterDraft(...).then(r => r.text),
  abortSignal: c.req.raw.signal,
}, { message, source, executionMode, target });
```

- [ ] **Step 3: 跑集成测试 + 全套** → PASS。

```bash
pnpm --filter @scribe/server exec vitest run
```

- [ ] **Step 4: 手动 e2e — 跑 3 章验证流式 + record-state + 不截断**

```bash
# 启动 dev,用 opencodego deepseek-v4-pro 写 3 章
# 确认:每章 text_delta 流式、committed=true、角色/伏笔落库
```

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/http/routes/agent.ts packages/server/tests/integration/agent-write-pipeline.test.ts
git commit -m "feat(agent): wire streaming writer + record-state + audit into pipeline"
```

---

### Task 9: 全套 typecheck + test + send-pack

- [ ] **Step 1**

```bash
pnpm --filter @scribe/shared run typecheck
pnpm --filter @scribe/server run typecheck
pnpm --filter @scribe/client run typecheck
pnpm --filter @scribe/shared exec vitest run
pnpm --filter @scribe/server run test
pnpm --filter @scribe/client run test
```

- [ ] **Step 2: 自检孤儿复活**

```bash
# 以下应都有调用方(streamLlm/recordChapterState/auditChapter/buildWriteContext)
grep -rln "streamLlm" packages/server/src --include="*.ts" | grep -v test
grep -rln "recordChapterState" packages/server/src --include="*.ts" | grep -v test
grep -rln "auditChapter" packages/server/src --include="*.ts" | grep -v test
grep -rln "buildWriteContext" packages/server/src --include="*.ts" | grep -v test
```

- [ ] **Step 3: 推送**

```bash
git send-pack git@github.com:DECADE0502/Scribe.git codex/generic-record-architecture
```

---

## Self-Review

**Spec 覆盖**:
- P0-1(流式 writer)→ T1+T2+T5+T8
- P0-2(record-state)→ T5+T8
- P0-3(atomic commit)→ T4
- P1-1(validator LLM)→ T6
- P1-2(repair 假实现)→ T7
- P1-3(空 plan 静默)→ T5
- P2-1(上下文裁剪)→ T3
- P2-2(conversation 持久化丢原文)→ 未单列 task,留 T8 附带或下一档
- P2-3(planAssetAudit 错配)→ 未单列,asset_audit 意图暂不在 T2 保留但不接 audit

**依赖顺序**:T1→T2→T5;T3 独立;T4 独立;T6 独立;T7 依赖 T2 的 writeDraft 概念;T8 最后接线;T9 收尾。

**不在本档**:
- 弧/卷总结(compress-arc)接回 — 依赖 record-state 先就位,留下一档
- conversation 持久化保留原文(P2-2)— 小改,留下一档
- asset_audit 意图的正确 staged type(P2-3)— 留下一档
- 删除确认是孤儿的旧文件(record-state.ts/audit-chapter.ts 等在 T8 后反而复活,不删)
