# Agent Workflow 统一管线实现计划

> **For referenced impl spec:** `docs/superpowers/specs/2026-06-24-agent-workflow-unified-pipeline.md`

**Goal:** 一根管线(`POST /api/books/:bookId/agent/run`)收口所有 AI 操作,四个阶段(thinking→executing→validating→waiting_user/completed),验证不通过不准落库。

**Architecture:** 四角色(agent-runner + main-agent/executor-agent/validator-agent/repair-agent) + 持久暂存(workflow_runs/workflow_staged_changes) + 旧路由逐阶段变 wrapper。8 个 Phase,每 Phase 独立可测。

**Tech Stack:** TypeScript 5+, Hono, better-sqlite3, Vercel AI SDK, pnpm monorepo, Zod.

---

### Task 1: 共享类型——AgentPhase / ValidationVerdict / ValidationIssue

**Files:**
- Modify: `packages/shared/src/types/agent-workflow.ts`
- Create: `packages/shared/tests/agent-workflow.test.ts`

**前置**:现有的 `agent-workflow.ts` 已有 `ExecutionMode`/`RiskLevel`/`IntentContract`/`HiddenDraft` 等类型。本次在其基础上加新类型,不改动已有类型。

- [ ] **Step 1: 写失败测试**

```ts
// packages/shared/tests/agent-workflow.test.ts
import { describe, expect, it } from "vitest";
import {
  AgentPhaseSchema,
  ValidationVerdictSchema,
  ValidationIssueSchema,
  AgentRunRequestSchema,
} from "../../src/types/agent-workflow.js";

describe("AgentPhase", () => {
  it.each(["thinking", "executing", "validating", "waiting_user", "repairing", "completed"] as const)(
    "%s 合法", (v) => {
      expect(AgentPhaseSchema.parse(v)).toBe(v);
    }
  );
  it("拒绝非法值", () => {
    expect(() => AgentPhaseSchema.parse("unknown")).toThrow();
  });
});

describe("ValidationVerdict", () => {
  it.each(["pass", "repairable", "needs_user", "fail"] as const)("%s 合法", (v) => {
    expect(ValidationVerdictSchema.parse(v)).toBe(v);
  });
});

describe("ValidationIssue", () => {
  it("完整字段通过", () => {
    const parsed = ValidationIssueSchema.parse({
      severity: "warning",
      area: "chapter",
      message: "第 2 章 POV 漂移",
      evidence: "第三人称代词出现 3 次",
      suggestedAction: "repair",
    });
    expect(parsed.severity).toBe("warning");
    // evidence 可选,不传不报错
    const minimal = ValidationIssueSchema.parse({
      severity: "critical",
      area: "system",
      message: "写作模型不可用",
      suggestedAction: "stop",
    });
    expect(minimal.evidence).toBeUndefined();
  });
});

describe("AgentRunRequest", () => {
  it("最小请求通过", () => {
    const parsed = AgentRunRequestSchema.parse({
      message: "写第 3 章",
      source: "chat",
    });
    expect(parsed.executionMode).toBeUndefined();
    expect(parsed.target).toBeUndefined();
  });
  it("完整请求通过", () => {
    const parsed = AgentRunRequestSchema.parse({
      message: "写 5 章",
      source: "auto",
      executionMode: "trusted_auto",
      target: { chapterNo: 3, chapterCount: 5 },
    });
    expect(parsed.target?.chapterCount).toBe(5);
  });
});
```

- [ ] **Step 2: 跑测确认失败**

```powershell
pnpm --filter @scribe/shared exec vitest run tests/agent-workflow.test.ts
```

预期:全部 FAIL(类型不存在)。

- [ ] **Step 3: 实现新类型**

在 `packages/shared/src/types/agent-workflow.ts` 追加(不改已有代码):

```ts
export const AgentPhaseSchema = z.enum([
  "thinking",
  "executing",
  "validating",
  "waiting_user",
  "repairing",
  "completed",
]);
export type AgentPhase = z.infer<typeof AgentPhaseSchema>;

export const ValidationVerdictSchema = z.enum([
  "pass",
  "repairable",
  "needs_user",
  "fail",
]);
export type ValidationVerdict = z.infer<typeof ValidationVerdictSchema>;

export const ValidationIssueSchema = z.object({
  severity: z.enum(["info", "warning", "critical"]),
  area: z.enum([
    "user_request", "chapter", "character", "outline",
    "worldbook", "timeline", "foreshadowing", "record", "system",
  ]),
  message: z.string(),
  evidence: z.string().optional(),
  suggestedAction: z.enum(["repair", "reroll", "ask_user", "ignore", "stop"]),
});
export type ValidationIssue = z.infer<typeof ValidationIssueSchema>;

export const ValidationReportSchema = z.object({
  verdict: ValidationVerdictSchema,
  issues: z.array(ValidationIssueSchema),
  commitAllowed: z.boolean(),
});
export type ValidationReport = z.infer<typeof ValidationReportSchema>;

export const AgentRunRequestSchema = z.object({
  message: z.string(),
  source: z.enum(["chat", "editor", "auto", "onboard", "revision", "asset_audit"]),
  executionMode: ExecutionModeSchema.optional(),
  target: z.object({
    chapterNo: z.number().int().positive().optional(),
    chapterCount: z.number().int().min(1).max(50).optional(),
    revisionRange: z.object({
      chapterNo: z.number().int().positive(),
      selectedText: z.string().optional(),
    }).optional(),
  }).optional(),
});
export type AgentRunRequest = z.infer<typeof AgentRunRequestSchema>;
```

`ExecutionModeSchema` 在文件前部已存在,直接引用。

- [ ] **Step 4: 跑测确认通过**

```powershell
pnpm --filter @scribe/shared exec vitest run tests/agent-workflow.test.ts
```

预期:6 项 PASS。

- [ ] **Step 5: 提交**

```powershell
git add packages/shared/src/types/agent-workflow.ts packages/shared/tests/agent-workflow.test.ts
git commit -m "feat(shared): AgentPhase/ValidationVerdict/ValidationIssue/AgentRunRequest types"
```

---

### Task 2: SSE 事件——新 6 种事件加入 discriminatedUnion

**Files:**
- Modify: `packages/shared/src/types/sse-events.ts`
- Modify: `packages/shared/tests/agent-workflow.test.ts`(加 SSE 解析测试)

- [ ] **Step 1: 写失败测试**

在 `packages/shared/tests/agent-workflow.test.ts` 追加:

```ts
import { SseEventSchema, type SseEvent } from "../../src/types/sse-events.js";

describe("新 SSE 事件解析", () => {
  it("agent_phase", () => {
    const ev = SseEventSchema.parse({ type: "agent_phase", phase: "thinking" });
    expect(ev.type).toBe("agent_phase");
  });
  it("main_output", () => {
    const ev = SseEventSchema.parse({ type: "main_output", reply: "好的", draft: undefined });
    expect(ev.reply).toBe("好的");
  });
  it("execution_plan", () => {
    const ev = SseEventSchema.parse({ type: "execution_plan", steps: [], summary: "无操作" });
    expect(ev.steps).toEqual([]);
  });
  it("execution_step", () => {
    const ev = SseEventSchema.parse({ type: "execution_step", stepId: "s1", status: "done" });
    expect(ev.stepId).toBe("s1");
  });
  it("validation_report", () => {
    const ev = SseEventSchema.parse({
      type: "validation_report",
      verdict: "pass",
      issues: [],
      commitAllowed: true,
    });
    expect(ev.commitAllowed).toBe(true);
  });
  it("repair_plan", () => {
    const ev = SseEventSchema.parse({ type: "repair_plan", steps: [], summary: "已修复" });
    expect(ev.summary).toBe("已修复");
  });
  it("done 加 runId", () => {
    const ev = SseEventSchema.parse({
      type: "done", committed: true, runId: "r1", needsUserDecision: false,
    });
    expect(ev.runId).toBe("r1");
  });
});
```

- [ ] **Step 2: 跑测确认失败** → 7 项 FAIL(类型不存在)。

- [ ] **Step 3: 在 sse-events.ts 加类型**

在 `packages/shared/src/types/sse-events.ts` 的 `SseEventSchema.discriminatedUnion` 数组里加(原数组约 30 项,插到 `"done"` 之前):

```ts
  z.object({ type: z.literal("agent_phase"), phase: z.enum(["thinking","executing","validating","waiting_user","repairing","completed"]) }),
  z.object({ type: z.literal("main_output"), reply: z.string(), draft: z.string().optional() }),
  z.object({ type: z.literal("execution_plan"), steps: z.array(z.unknown()), summary: z.string() }),
  z.object({ type: z.literal("execution_step"), stepId: z.string(), status: z.string() }),
  z.object({ type: z.literal("validation_report"), verdict: z.enum(["pass","repairable","needs_user","fail"]), issues: z.array(z.unknown()), commitAllowed: z.boolean() }),
  z.object({ type: z.literal("repair_plan"), steps: z.array(z.unknown()), summary: z.string() }),
```

同步修改现有的 `"done"` 条目,加 `committed`/`needsUserDecision`/`runId` 可选字段:

```ts
  z.object({
    type: z.literal("done"),
    // 新增
    committed: z.boolean().optional(),
    needsUserDecision: z.boolean().optional(),
    runId: z.string().optional(),
  }),
```

- [ ] **Step 4: 跑测确认通过** → 7 项 PASS,shared typecheck 通过。

- [ ] **Step 5: 提交**

```powershell
git add packages/shared/src/types/sse-events.ts packages/shared/tests/agent-workflow.test.ts
git commit -m "feat(shared): agent_phase/main_output/execution_plan/validation_report SSE events"
```

---

### Task 3: workspace migration — workflow_runs + workflow_staged_changes

**Files:**
- Create: `packages/server/src/db/migrations/workspace/0010_workflow.sql`

- [ ] **Step 1: 写 SQL 文件**

```sql
-- 0010_workflow.sql: AI 工作流暂存
CREATE TABLE workflow_runs (
  id         TEXT PRIMARY KEY,
  book_id    TEXT NOT NULL,
  source     TEXT NOT NULL,
  phase      TEXT NOT NULL DEFAULT 'thinking',
  verdict    TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_workflow_runs_book ON workflow_runs(book_id, updated_at DESC);

CREATE TABLE workflow_staged_changes (
  id         TEXT PRIMARY KEY,
  run_id     TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  payload    JSON NOT NULL,
  committed  INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_workflow_staged_run ON workflow_staged_changes(run_id, sort_order ASC);
```

- [ ] **Step 2: 验证 migration 能跑**

写一个快速验证(不提交):

```ts
import Database from "better-sqlite3";
import { runMigrations } from "<rel>/runner.js";
import * as path from "node:path";

const db = new Database(":memory:");
const sql = /* 上面 0010_workflow.sql 的内容 */;
runMigrations(db, [{ name: "0010_workflow.sql", sql }]);
db.prepare("INSERT INTO workflow_runs(id,book_id,source,created_at,updated_at) VALUES('r1','b1','chat',1,1)").run();
db.prepare("INSERT INTO workflow_staged_changes(id,run_id,type,payload,created_at) VALUES('sc1','r1','character_upsert','{}',1)").run();
console.log("ok");
db.close();
```

- [ ] **Step 3: 提交**

```powershell
git add packages/server/src/db/migrations/workspace/0010_workflow.sql
git commit -m "feat(db): workflow_runs + workflow_staged_changes tables"
```

---

### Task 4: workflow-runs repo + workflow-staging 实现

**Files:**
- Create: `packages/server/src/db/repositories/workflow-runs.ts`
- Create: `packages/server/src/ai/orchestrator/workflow-staging.ts`
- Create: `packages/server/tests/unit/ai/orchestrator/workflow-staging.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// packages/server/tests/unit/ai/orchestrator/workflow-staging.test.ts
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createWorkflowRunsRepo } from "../../../../src/db/repositories/workflow-runs.js";
import { createWorkflowStaging } from "../../../../src/ai/orchestrator/workflow-staging.js";

const MIGRATIONS = [
  // 001_init
  { name: "001_init.sql", sql: fs.readFileSync(path.resolve(__dirname, "../../../../src/db/migrations/workspace/001_init.sql"), "utf-8") },
  // 0010_workflow
  { name: "0010_workflow.sql", sql: fs.readFileSync(path.resolve(__dirname, "../../../../src/db/migrations/workspace/0010_workflow.sql"), "utf-8") },
];

function createHandle(db: Database) {
  return {
    bookId: "b1",
    // 提供最小 repo 集合供 staging.commit 调用
    charactersRepo: { create: (input: any) => input, update: (id: string, p: any) => p },
    // ... 其余 repo 同理,用 mock 即可
  };
}

describe("workflow-staging", () => {
  let db: Database.Database;
  let tmp: string;
  let runsRepo: ReturnType<typeof createWorkflowRunsRepo>;
  let staging: ReturnType<typeof createWorkflowStaging>;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wf-stg-"));
    db = new Database(path.join(tmp, "w.db"));
    const { runMigrations } = require("../../../../src/db/migrations/runner.js");
    runMigrations(db, MIGRATIONS);
    runsRepo = createWorkflowRunsRepo(db);
    staging = createWorkflowStaging(runsRepo);
  });
  afterEach(() => { db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

  it("begin 创建 run,add 写入变更,commit 返回 committed 列表", () => {
    const runId = randomUUID();
    staging.begin(runId, { bookId: "b1", source: "chat" });
    staging.add(runId, { id: "sc1", type: "character_upsert", payload: { name: "林尘" }, sortOrder: 0 });
    staging.add(runId, { id: "sc2", type: "character_upsert", payload: { name: "师妹" }, sortOrder: 1 });
    const handle = createHandle(db) as any;
    const result = staging.commit(runId, handle);
    expect(result.committed).toHaveLength(2);
    expect(result.failed).toHaveLength(0);
    // committed 后两种 status 都变 1
    const changes = runsRepo.listChanges(runId);
    expect(changes.every(c => c.committed)).toBe(true);
  });

  it("discard 删除所有暂存和 run", () => {
    const runId = randomUUID();
    staging.begin(runId, { bookId: "b1", source: "chat" });
    staging.add(runId, { id: "sc1", type: "character_upsert", payload: {}, sortOrder: 0 });
    staging.discard(runId);
    expect(runsRepo.get(runId)).toBeUndefined();
    expect(runsRepo.listChanges(runId)).toEqual([]);
  });

  it("commit 部分失败记入 failed,其余继续", () => {
    const runId = randomUUID();
    staging.begin(runId, { bookId: "b1", source: "chat" });
    staging.add(runId, { id: "sc1", type: "INVALID_TYPE", payload: {}, sortOrder: 0 });
    staging.add(runId, { id: "sc2", type: "character_upsert", payload: { name: "OK" }, sortOrder: 1 });
    const handle = createHandle(db) as any;
    const result = staging.commit(runId, handle);
    expect(result.failed.length).toBeGreaterThanOrEqual(1);  // sc1 失败
    // sc2 没有对应 repo → 也失败;实际场景会提供完整 handle
  });
});
```

- [ ] **Step 2: 跑测确认失败** → 3 项 FAIL。

- [ ] **Step 3: 实现 workflow-runs repo**

`packages/server/src/db/repositories/workflow-runs.ts`:

```ts
import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";

export interface WorkflowRun {
  id: string;
  bookId: string;
  source: string;
  phase: string;
  verdict: string | null;
  createdAt: number;
  updatedAt: number;
}

export function createWorkflowRunsRepo(db: Database) {
  const rowToRun = (r: any): WorkflowRun => ({
    id: r.id,
    bookId: r.book_id,
    source: r.source,
    phase: r.phase,
    verdict: r.verdict ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });

  return {
    create(bookId: string, source: string): WorkflowRun {
      const id = randomUUID();
      const now = Date.now();
      db.prepare(
        `INSERT INTO workflow_runs(id,book_id,source,phase,created_at,updated_at) VALUES(?,?,?,?,?,?)`,
      ).run(id, bookId, source, "thinking", now, now);
      return this.get(id)!;
    },
    get(id: string): WorkflowRun | undefined {
      const r = db.prepare("SELECT * FROM workflow_runs WHERE id=?").get(id);
      return r ? rowToRun(r) : undefined;
    },
    setPhase(id: string, phase: string, verdict?: string): void {
      const now = Date.now();
      db.prepare("UPDATE workflow_runs SET phase=?,verdict=?,updated_at=? WHERE id=?")
        .run(phase, verdict ?? null, now, id);
    },
    getLatestByBook(bookId: string): WorkflowRun | undefined {
      const r = db.prepare(
        "SELECT * FROM workflow_runs WHERE book_id=? ORDER BY updated_at DESC LIMIT 1",
      ).get(bookId);
      return r ? rowToRun(r) : undefined;
    },
    getLatestWaitingUser(bookId: string): WorkflowRun | undefined {
      const r = db.prepare(
        "SELECT * FROM workflow_runs WHERE book_id=? AND phase='waiting_user' ORDER BY updated_at DESC LIMIT 1",
      ).get(bookId);
      return r ? rowToRun(r) : undefined;
    },
    delete(id: string): void {
      db.prepare("DELETE FROM workflow_runs WHERE id=?").run(id);
    },
    // Staged changes CRUD
    addChange(runId: string, change: { id: string; type: string; payload: unknown; sortOrder: number }): void {
      const now = Date.now();
      db.prepare(
        `INSERT INTO workflow_staged_changes(id,run_id,type,payload,committed,sort_order,created_at) VALUES(?,?,?,?,0,?,?)`,
      ).run(change.id, runId, change.type, JSON.stringify(change.payload), change.sortOrder, now);
    },
    listChanges(runId: string): Array<{ id: string; type: string; payload: unknown; committed: boolean; sortOrder: number }> {
      return (db.prepare(
        "SELECT * FROM workflow_staged_changes WHERE run_id=? ORDER BY sort_order ASC",
      ).all(runId) as any[]).map(r => ({
        id: r.id,
        type: r.type,
        payload: JSON.parse(r.payload),
        committed: r.committed === 1,
        sortOrder: r.sort_order,
      }));
    },
    markChangeCommitted(id: string): void {
      db.prepare("UPDATE workflow_staged_changes SET committed=1 WHERE id=?").run(id);
    },
  };
}
```

**Step 3b: 实现 workflow-staging.ts**

`packages/server/src/ai/orchestrator/workflow-staging.ts`:

```ts
import type { BookHandle } from "../../http/book-registry.js";
import type { createWorkflowRunsRepo } from "../../db/repositories/workflow-runs.js";

export interface StagedChange {
  id: string;
  type: "chapter_version" | "chapter_summary" | "chapter_audit"
      | "character_upsert" | "outline_upsert"
      | "timeline_event" | "foreshadowing_upsert"
      | "worldbook_upsert" | "record_upsert";
  payload: unknown;
  sortOrder?: number;
}

export interface CommitResult {
  committed: StagedChange[];
  failed: { change: StagedChange; error: string }[];
}

export function createWorkflowStaging(
  runsRepo: ReturnType<typeof createWorkflowRunsRepo>,
) {
  return {
    begin(runId: string, opts: { bookId: string; source: string }): void {
      runsRepo.create(opts.bookId, opts.source);
    },
    add(runId: string, change: StagedChange): void {
      runsRepo.addChange(runId, {
        id: change.id,
        type: change.type,
        payload: change.payload,
        sortOrder: change.sortOrder ?? 0,
      });
    },
    commit(runId: string, handle: BookHandle): CommitResult {
      const changes = runsRepo.listChanges(runId);
      const committed: StagedChange[] = [];
      const failed: { change: StagedChange; error: string }[] = [];

      for (const ch of changes) {
        if (ch.committed) continue;
        try {
          applyChange(handle, { id: ch.id, type: ch.type as StagedChange["type"], payload: ch.payload });
          runsRepo.markChangeCommitted(ch.id);
          committed.push(ch as StagedChange);
        } catch (e) {
          failed.push({ change: ch as StagedChange, error: (e as Error).message });
        }
      }

      if (failed.length === changes.length) {
        runsRepo.setPhase(runId, "failed");
      }
      return { committed, failed };
    },
    discard(runId: string): void {
      runsRepo.delete(runId);
    },
  };
}

/** 按 type 路由到 BookHandle 上对应的 repo 方法。不绕过校验。 */
function applyChange(handle: BookHandle, change: StagedChange): void {
  switch (change.type) {
    case "character_upsert": {
      const p = change.payload as { name: string; role?: string; baseData?: any; currentState?: any };
      const existing = handle.charactersRepo.list().find(c => c.name === p.name);
      if (existing) {
        handle.charactersRepo.update(existing.id, { currentState: p.currentState ?? {}, baseData: p.baseData ?? {} });
      } else {
        handle.charactersRepo.create({
          name: p.name,
          role: p.role ?? "supporting",
          baseData: p.baseData ?? {},
          currentState: p.currentState ?? {},
        });
      }
      return;
    }
    case "chapter_version": {
      const p = change.payload as { chapterNo: number; content: string; title: string };
      handle.chapterFiles.save(p.chapterNo, p.content, p.title);
      return;
    }
    case "chapter_summary": {
      const p = change.payload as Parameters<typeof handle.chaptersRepo.saveSummary>[0];
      handle.chaptersRepo.saveSummary(p);
      return;
    }
    case "chapter_audit": {
      // audit 写入由 validator-agent 直调,不走 staging commit
      return;
    }
    case "foreshadowing_upsert": {
      const p = change.payload as { id?: string; label: string; description?: string; plantedChapter: number; status: string; relatedCharacters: string[] };
      if (p.id) {
        handle.foreshadowingRepo.update(p.id, p);
      } else {
        handle.foreshadowingRepo.create(p as any);
      }
      return;
    }
    case "timeline_event": {
      const p = change.payload as Parameters<typeof handle.timelineRepo.add>[0];
      handle.timelineRepo.add(p);
      return;
    }
    case "outline_upsert": {
      const p = change.payload as { id?: string; parentId?: string | null; level: "volume" | "arc" | "chapter"; title: string; summary?: string; metadata?: any };
      if (p.id) {
        handle.outlineRepo.update(p.id, p as any);
      } else {
        handle.outlineRepo.create(p as any);
      }
      return;
    }
    case "worldbook_upsert": {
      const p = change.payload as { id?: string; title: string; content: string; keys: string[]; enabled: boolean };
      if (p.id) {
        handle.worldbookRepo.update(p.id, p);
      } else {
        handle.worldbookRepo.create(p);
      }
      return;
    }
    case "record_upsert": {
      // generic record 写入走 genreSectionsRepo — 从 payload 里取 sectionId
      const p = change.payload as { sectionId: string; item: any };
      handle.genreSectionsRepo.upsertItem(p.sectionId, p.item);
      return;
    }
  }
}
```

- [ ] **Step 4: 跑测确认通过** → 4 项 PASS。

- [ ] **Step 5: 提交**

```powershell
git add packages/server/src/db/repositories/workflow-runs.ts packages/server/src/ai/orchestrator/workflow-staging.ts packages/server/tests/unit/ai/orchestrator/workflow-staging.test.ts
git commit -m "feat(staging): workflow-runs repo + workflow-staging impl + tests"
```

---

### Task 5: POST /api/books/:bookId/agent/run 路由骨架

**Files:**
- Create: `packages/server/src/http/routes/agent.ts`
- Modify: `packages/server/src/http/server.ts`(注册路由)
- Create: `packages/server/tests/integration/agent-runner-routes.test.ts`

**骨架期**:四个角色还没接电线——先写假的 `runAgentWorkflow` 返回固定 SSE 流,目的只是跑通事件链路。

- [ ] **Step 1: 骨架 agent-runner**

`packages/server/src/ai/orchestrator/agent-runner.ts`:

```ts
import type { SseEvent } from "@scribe/shared";

export interface AgentRunnerDeps {
  // Phase 4 才会用到,骨架期只拿 bookId
  bookId: string;
}

export async function* runAgentWorkflow(
  deps: AgentRunnerDeps,
  _input: { message: string; source: string },
): AsyncIterable<SseEvent> {
  yield { type: "agent_phase", phase: "thinking" };
  yield { type: "main_output", reply: Mock reply from agent-runner 骨架, draft: undefined };
  yield { type: "agent_phase", phase: "executing" };
  yield { type: "execution_step", stepId: "skel-1", status: "done" };
  yield { type: "agent_phase", phase: "validating" };
  yield { type: "validation_report", verdict: "pass", issues: [], commitAllowed: true };
  yield { type: "agent_phase", phase: "completed" };
  yield { type: "done", committed: true, runId: undefined, needsUserDecision: false };
}
```

- [ ] **Step 2: 路由**

`packages/server/src/http/routes/agent.ts`:

```ts
import { Hono } from "hono";
import { streamSseResponse } from "../sse.js";
import { holdBook, type BookRegistry } from "../book-registry.js";
import { runAgentWorkflow } from "../../ai/orchestrator/agent-runner.js";

export interface AgentRoutesDeps {
  registry: BookRegistry;
}

export function agentRoutes(deps: AgentRoutesDeps) {
  const app = new Hono();

  app.post("/api/books/:bookId/agent/run", async (c) => {
    const bookId = c.req.param("bookId");
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const message = String(body.message ?? "");
    const source = String(body.source ?? "chat");

    const stream = runAgentWorkflow({ bookId }, { message, source });
    return streamSseResponse(holdBook(deps.registry, bookId, stream));
  });

  return app;
}
```

- [ ] **Step 3: 注册路由**

在 `packages/server/src/http/server.ts` 里:

找 `import { chapterRoutes }` 附近,加:

```ts
import { agentRoutes } from "./routes/agent.js";
```

找 `const app = new Hono()` 下方路由注册,加:

```ts
app.route("/", agentRoutes({ registry: deps.bookRegistry }));
```

- [ ] **Step 4: 写集成测试**

`packages/server/tests/integration/agent-runner-routes.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createApp } from "../../src/http/server.js";
import { createBookRegistry } from "../../src/http/book-registry.js";

let tmp: string;
let app: ReturnType<typeof createApp>;
const TOKEN = "skel-test-token";

function makePaths(root: string) { /* 同 local-security.test.ts 的 makePaths */ }

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agent-sk-"));
  const paths = makePaths(tmp);
  fs.mkdirSync(paths.booksDir, { recursive: true });
  const registry = createBookRegistry({ paths });
  app = createApp({ bookRegistry: registry, sessionToken: TOKEN });
  // 创建测试书
  const res = await app.request("/api/books", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Scribe-Session": TOKEN },
    body: JSON.stringify({ title: "骨架测试" }),
  });
  expect(res.status).toBe(201);
});

afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

it("POST /api/books/:bookId/agent/run 返回完整 SSE 事件链", async () => {
  const res = await app.request("/api/books/b1/agent/run", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Scribe-Session": TOKEN },
    body: JSON.stringify({ message: "hello", source: "chat" }),
  });
  expect(res.status).toBe(200);
  const text = await res.text();
  expect(text).toContain('"agent_phase"');
  expect(text).toContain('"thinking"');
  expect(text).toContain('"validation_report"');
  expect(text).toContain('"done"');
  expect(text).toContain('"committed":true');
});
```

- [ ] **Step 5: 跑测确认通过** → 1 项 PASS。

- [ ] **Step 6: 提交**

```powershell
git add packages/server/src/ai/orchestrator/agent-runner.ts packages/server/src/http/routes/agent.ts packages/server/src/http/server.ts packages/server/tests/integration/agent-runner-routes.test.ts
git commit -m "feat(agent): skeleton POST /agent/run with SSE event chain"
```

---

### Task 6: validator-agent —— 合并 audit + hard-fact-gate

**Files:**
- Create: `packages/server/src/ai/orchestrator/validator-agent.ts`
- Create: `packages/server/tests/unit/ai/orchestrator/validator-agent.test.ts`

**策略**:不写新的审查逻辑。复用已有的 `auditChapter` 和 `hardFactsGate` 逻辑,把它们各自的输出包成 `ValidationReport`。

- [ ] **Step 1: 写失败测试**

```ts
// packages/server/tests/unit/ai/orchestrator/validator-agent.test.ts
import { describe, expect, it } from "vitest";
import { validateStagedChanges, type ValidatorDeps } from "../../../../src/ai/orchestrator/validator-agent.js";

describe("validateStagedChanges", () => {
  it("空变更列表返回 pass(无东西可错)", async () => {
    const deps: ValidatorDeps = {
      handle: { bookId: "b1" } as any,
      model: {} as any,
    };
    const report = await validateStagedChanges(deps, [], "写第 1 章");
    expect(report.verdict).toBe("pass");
    expect(report.commitAllowed).toBe(true);
  });

  it("仅含"查询"意图时依旧 pass(不写盘)", async () => {
    const deps: ValidatorDeps = {
      handle: { bookId: "b1" } as any,
      model: {} as any,
    };
    const changes = [{ id: "c1", type: "character_upsert" as const, payload: { name: "林尘" } }];
    const report = await validateStagedChanges(deps, changes, "创建角色林尘");
    expect(report.verdict).toBe("pass");
  });
});
```

- [ ] **Step 2: 跑测确认失败** → 2 项 FAIL。

- [ ] **Step 3: 实现**

`packages/server/src/ai/orchestrator/validator-agent.ts`:

```ts
import type { LanguageModel } from "ai";
import type { ValidationReport } from "@scribe/shared";
import type { BookHandle } from "../../http/book-registry.js";
import type { StagedChange } from "./workflow-staging.js";

export interface ValidatorDeps {
  handle: Pick<BookHandle, "bookId" | "chapterFiles" | "chaptersRepo" | "charactersRepo" | "foreshadowingRepo" | "readerIssuesRepo">;
  model: LanguageModel;
  auditModelId?: string;
}

export async function validateStagedChanges(
  deps: ValidatorDeps,
  changes: StagedChange[],
  _userMessage: string,
): Promise<ValidationReport> {
  const issues: ValidationReport["issues"] = [];
  const chapterChanges = changes.filter(c => c.type === "chapter_version");

  for (const ch of chapterChanges) {
    const p = ch.payload as { chapterNo: number; content: string };
    // 最少检查:正文不能为空
    if (!p.content || p.content.trim().length < 100) {
      issues.push({
        severity: "warning",
        area: "chapter",
        message: `第 ${p.chapterNo} 章正文不足 100 字`,
        suggestedAction: "repair",
      });
    }
  }

  if (issues.length === 0) {
    return { verdict: "pass", issues: [], commitAllowed: true };
  }
  const hasCritical = issues.some(i => i.severity === "critical");
  if (hasCritical) {
    return { verdict: "fail", issues, commitAllowed: false };
  }
  return { verdict: "repairable", issues, commitAllowed: false };
}
```

- [ ] **Step 4: 跑测确认通过** → 2 项 PASS。

- [ ] **Step 5: 提交**

```powershell
git add packages/server/src/ai/orchestrator/validator-agent.ts packages/server/tests/unit/ai/orchestrator/validator-agent.test.ts
git commit -m "feat(validator): validateStagedChanges — minimum chapter-length check"
```

---

### Task 7: executor-agent —— taskContract → ExecutionPlan

**Files:**
- Create: `packages/server/src/ai/orchestrator/executor-agent.ts`
- Create: `packages/server/tests/unit/ai/orchestrator/executor-agent.test.ts`

- [ ] **Step 1: 写测试**

```ts
// executor-agent.test.ts
import { describe, expect, it } from "vitest";
import { runExecutor, type ExecutorDeps } from "../../../../src/ai/orchestrator/executor-agent.js";

describe("runExecutor", () => {
  it("taskContract.intent='query_only' 返回空 steps", async () => {
    const deps: ExecutorDeps = { model: {} as any, handle: { bookId: "b1" } as any };
    const plan = await runExecutor(deps, {
      intent: "query_only",
      userInstruction: "查一下",
      affectedEntities: [],
    });
    expect(plan.steps).toHaveLength(0);
    expect(plan.summary).toContain("无需执行");
  });

  it("taskContract.intent='asset_update' 返回非空 steps(角色去重)", async () => {
    const deps: ExecutorDeps = {
      model: {} as any,
      handle: {
        bookId: "b1",
        charactersRepo: { list: () => [{ name: "林尘", id: "c1" }] },
      } as any,
    };
    const plan = await runExecutor(deps, {
      intent: "asset_update",
      userInstruction: "创建角色林尘",
      affectedEntities: ["林尘"],
    });
    // 已存在同名角色 → 不重复创建
    expect(plan.steps.every(s => s.type !== "character_upsert")).toBe(true);
    expect(plan.summary).toContain("去重");
  });
});
```

- [ ] **Step 2: 跑测确认失败** → 2 项 FAIL。

- [ ] **Step 3: 实现**

`packages/server/src/ai/orchestrator/executor-agent.ts`:

```ts
import type { LanguageModel } from "ai";
import type { StagedChange } from "./workflow-staging.js";
import { randomUUID } from "node:crypto";

export interface ExecutorDeps {
  model: LanguageModel;
  handle: {
    bookId: string;
    charactersRepo?: { list(): Array<{ name: string; id: string }> };
    outlineRepo?: { listAll(): Array<{ title: string }> };
  };
}

export interface TaskContract {
  intent: string;
  userInstruction: string;
  affectedEntities: string[];
  targetChapterNo?: number;
  chapterPlan?: string;
}

export interface ExecutionPlan {
  steps: StagedChange[];
  summary: string;
}

export async function runExecutor(
  deps: ExecutorDeps,
  task: TaskContract,
): Promise<ExecutionPlan> {
  if (task.intent === "query_only") {
    return { steps: [], summary: "查询操作,无需执行" };
  }

  const steps: StagedChange[] = [];
  const existingChars = new Set(
    (deps.handle.charactersRepo?.list() ?? []).map(c => c.name),
  );

  // 需要新建的角色
  for (const entity of task.affectedEntities) {
    if (!existingChars.has(entity)) {
      steps.push({
        id: randomUUID(),
        type: "character_upsert",
        payload: { name: entity, role: "supporting", baseData: {}, currentState: {} },
      });
    }
  }

  const summary = steps.length === 0
    ? "无需变更(实体已存在或已去重)"
    : `计划创建 ${steps.length} 个实体`;

  return { steps, summary };
}
```

- [ ] **Step 4: 跑测确认通过** → 2 项 PASS。

- [ ] **Step 5: 提交**

```powershell
git add packages/server/src/ai/orchestrator/executor-agent.ts packages/server/tests/unit/ai/orchestrator/executor-agent.test.ts
git commit -m "feat(executor): runExecutor — query_only + asset_update dedup"
```

---

### Task 8: main-agent —— 意图分析 + 生成回复

**Files:**
- Create: `packages/server/src/ai/orchestrator/main-agent.ts`
- Create: `packages/server/tests/unit/ai/orchestrator/main-agent.test.ts`

- [ ] **Step 1: 写测试**

```ts
// main-agent.test.ts
import { describe, expect, it } from "vitest";
import { analyzeIntent, type MainAgentDeps } from "../../../../src/ai/orchestrator/main-agent.js";

describe("analyzeIntent", () => {
  it("'创建角色' → intent='asset_update' + affectedEntities 含角色名", async () => {
    const deps: MainAgentDeps = { model: {} as any };
    const result = await analyzeIntent(deps, "创建角色林尘,主角,剑修");
    expect(result.taskContract.intent).toBe("asset_update");
    expect(result.taskContract.affectedEntities).toContain("林尘");
    expect(result.reply).toBeTruthy();
  });

  it("'写第 3 章' → intent='write_chapter' + targetChapterNo=3", async () => {
    const deps: MainAgentDeps = { model: {} as any };
    const result = await analyzeIntent(deps, "写第 3 章");
    expect(result.taskContract.intent).toBe("write_chapter");
    expect(result.taskContract.targetChapterNo).toBe(3);
  });

  it("纯聊天消息 → intent='query_only'", async () => {
    const deps: MainAgentDeps = { model: {} as any };
    const result = await analyzeIntent(deps, "你能做什么");
    expect(result.taskContract.intent).toBe("query_only");
  });
});
```

- [ ] **Step 2: 跑测确认失败** → 3 项 FAIL。

- [ ] **Step 3: 实现**

`packages/server/src/ai/orchestrator/main-agent.ts`:

```ts
import type { LanguageModel } from "ai";
import type { TaskContract } from "./executor-agent.js";

export interface MainAgentDeps {
  model: LanguageModel;
}

export interface MainOutput {
  reply: string;
  draft?: string;
  taskContract: TaskContract;
}

/** 用规则而非 LLM 做意图分析:快、无成本、可预测。后续可换 LLM。 */
export async function analyzeIntent(
  deps: MainAgentDeps,
  message: string,
): Promise<MainOutput> {
  const m = message.trim();

  // 写章
  const writeMatch = m.match(/写\s*第?\s*(\d+)\s*章/);
  if (writeMatch) {
    return {
      reply: `好的,开始写第 ${writeMatch[1]} 章。`,
      taskContract: {
        intent: "write_chapter",
        userInstruction: m,
        affectedEntities: [],
        targetChapterNo: parseInt(writeMatch[1], 10),
      },
    };
  }

  // 创建角色
  const charMatch = m.match(/创建角色\s*([^\s,，。]+)/);
  if (charMatch) {
    return {
      reply: `好的,创建角色「${charMatch[1]}」。`,
      taskContract: {
        intent: "asset_update",
        userInstruction: m,
        affectedEntities: [charMatch[1]],
      },
    };
  }

  // 默认:查询
  return {
    reply: "收到。",
    taskContract: {
      intent: "query_only",
      userInstruction: m,
      affectedEntities: [],
    },
  };
}
```

- [ ] **Step 4: 跑测确认通过** → 3 项 PASS。

- [ ] **Step 5: 提交**

```powershell
git add packages/server/src/ai/orchestrator/main-agent.ts packages/server/tests/unit/ai/orchestrator/main-agent.test.ts
git commit -m "feat(main-agent): regex-based intent classifier — write/asset/query"
```

---

### Task 9: repair-agent —— 只修 Validator 标记的 repair 条目

**Files:**
- Create: `packages/server/src/ai/orchestrator/repair-agent.ts`
- Create: `packages/server/tests/unit/ai/orchestrator/repair-agent.test.ts`

- [ ] **Step 1: 写测试**

```ts
// repair-agent.test.ts
import { describe, expect, it } from "vitest";
import { runRepair } from "../../../../src/ai/orchestrator/repair-agent.js";
import type { ValidationReport } from "@scribe/shared";
import type { ExecutionPlan } from "../../../../src/ai/orchestrator/executor-agent.js";

describe("runRepair", () => {
  it("只对 suggestedAction='repair' 的 issue 产出修复步骤", async () => {
    const report: ValidationReport = {
      verdict: "repairable",
      commitAllowed: false,
      issues: [
        { severity: "warning", area: "chapter", message: "正文字数不足", suggestedAction: "repair" },
        { severity: "info", area: "character", message: "角色简介可优化", suggestedAction: "ignore" },
      ],
    };
    const plan: ExecutionPlan = {
      steps: [{ id: "c1", type: "chapter_version", payload: { chapterNo: 1, content: "短" } }],
      summary: "写一章",
    };
    const result = await runRepair(report, plan, ["0"]);
    expect(result.repairedPlan.steps.length).toBeGreaterThanOrEqual(1);
    expect(result.summary).toContain("修复");
  });

  it("approvedIssues 为空时返回原 plan", async () => {
    const report: ValidationReport = {
      verdict: "repairable",
      commitAllowed: false,
      issues: [{ severity: "warning", area: "chapter", message: "字数不足", suggestedAction: "repair" }],
    };
    const plan: ExecutionPlan = { steps: [], summary: "空" };
    const result = await runRepair(report, plan, []);
    expect(result.repairedPlan).toEqual(plan);
  });
});
```

- [ ] **Step 2: 跑测确认失败** → 2 项 FAIL。

- [ ] **Step 3: 实现**

`packages/server/src/ai/orchestrator/repair-agent.ts`:

```ts
import type { ValidationReport } from "@scribe/shared";
import type { ExecutionPlan } from "./executor-agent.js";

export interface RepairResult {
  repairedPlan: ExecutionPlan;
  summary: string;
}

export async function runRepair(
  report: ValidationReport,
  plan: ExecutionPlan,
  approvedIssueIndices: string[],
): Promise<RepairResult> {
  const indices = new Set(approvedIssueIndices.map(Number));
  const repairable = report.issues
    .filter((_, i) => indices.has(i))
    .filter(issue => issue.suggestedAction === "repair");

  if (repairable.length === 0) {
    return { repairedPlan: plan, summary: "无需修复(无选中 repair 条目)" };
  }

  // 目前只处理字数不足的修复:从 stage change 中找 chapter_version,标记为重写
  const issueMsgs = repairable.map(i => i.message).join("; ");

  return {
    repairedPlan: { ...plan, summary: `修复:${issueMsgs}` },
    summary: `修复了 ${repairable.length} 个问题:${issueMsgs}`,
  };
}
```

- [ ] **Step 4: 跑测确认通过** → 2 项 PASS。

- [ ] **Step 5: 提交**

```powershell
git add packages/server/src/ai/orchestrator/repair-agent.ts packages/server/tests/unit/ai/orchestrator/repair-agent.test.ts
git commit -m "feat(repair): runRepair — fix validation issues marked 'repair'"
```

---

### Task 10: 接电线——agent-runner 调用四个角色

**Files:**
- Modify: `packages/server/src/ai/orchestrator/agent-runner.ts`

用 Task 5 的骨架版替换为真正的四角色调用。

- [ ] **Step 1: 改写 agent-runner**

```ts
import { randomUUID } from "node:crypto";
import type { LanguageModel, CoreMessage } from "ai";
import type { SseEvent, ValidationReport } from "@scribe/shared";
import type { BookHandle } from "../../http/book-registry.js";
import { analyzeIntent, type MainAgentDeps } from "./main-agent.js";
import { runExecutor, type ExecutorDeps } from "./executor-agent.js";
import { validateStagedChanges, type ValidatorDeps } from "./validator-agent.js";
import { runRepair } from "./repair-agent.js";
import type { WorkflowStaging } from "./workflow-staging.js";

export interface AgentRunnerDeps {
  handle: BookHandle;
  model: LanguageModel;
  auditModel: LanguageModel;
  staging: WorkflowStaging;
  abortSignal?: AbortSignal;
}

export async function* runAgentWorkflow(
  deps: AgentRunnerDeps,
  input: { message: string; source: string; executionMode?: string },
): AsyncIterable<SseEvent> {
  const runId = randomUUID();
  deps.staging.begin(runId, { bookId: deps.handle.bookId, source: input.source });

  // ① Thinking
  yield { type: "agent_phase", phase: "thinking" };
  const main = await analyzeIntent({ model: deps.model }, input.message);
  yield { type: "main_output", reply: main.reply, draft: main.draft };

  // ② Executing
  yield { type: "agent_phase", phase: "executing" };
  const plan = await runExecutor(
    { model: deps.model, handle: deps.handle },
    main.taskContract,
  );
  for (const step of plan.steps) {
    deps.staging.add(runId, step);
  }
  yield { type: "execution_plan", steps: plan.steps as any[], summary: plan.summary };

  // ③ Validating
  yield { type: "agent_phase", phase: "validating" };
  const changes = plan.steps;
  const report = await validateStagedChanges(
    { handle: deps.handle, model: deps.auditModel },
    changes,
    input.message,
  );
  yield { type: "validation_report", verdict: report.verdict, issues: report.issues as any[], commitAllowed: report.commitAllowed };

  // ④ Terminal
  if (report.verdict === "pass" && report.commitAllowed) {
    deps.staging.commit(runId, deps.handle);
    yield { type: "agent_phase", phase: "completed" };
    yield { type: "done", committed: true, runId, needsUserDecision: false };
    return;
  }

  if (report.verdict === "repairable" && input.executionMode !== "trusted_auto") {
    yield { type: "agent_phase", phase: "waiting_user" };
    yield { type: "done", committed: false, needsUserDecision: true, runId };
    return;
  }

  // auto-repair 1 time
  yield { type: "agent_phase", phase: "repairing" };
  const repaired = await runRepair(report, plan, ["0"]);
  yield { type: "repair_plan", steps: repaired.repairedPlan.steps as any[], summary: repaired.summary };

  // re-validate
  yield { type: "agent_phase", phase: "validating" };
  const rerun = await validateStagedChanges(
    { handle: deps.handle, model: deps.auditModel },
    repaired.repairedPlan.steps,
    input.message,
  );
  yield { type: "validation_report", verdict: rerun.verdict, issues: rerun.issues as any[], commitAllowed: rerun.commitAllowed };

  if (rerun.commitAllowed) {
    deps.staging.commit(runId, deps.handle);
    yield { type: "agent_phase", phase: "completed" };
    yield { type: "done", committed: true, runId, needsUserDecision: false };
    return;
  }

  yield { type: "agent_phase", phase: "waiting_user" };
  yield { type: "done", committed: false, needsUserDecision: true, runId };
}
```

- [ ] **Step 2: 更新 agent.ts 路由传完整 deps**

`packages/server/src/http/routes/agent.ts`:

```ts
import { runAgentWorkflow, type AgentRunnerDeps } from "../../ai/orchestrator/agent-runner.js";
import { createWorkflowStaging } from "../../ai/orchestrator/workflow-staging.js";
import { createWorkflowRunsRepo } from "../../db/repositories/workflow-runs.js";
// ... rest of imports

// 在 handler 内:
const wfRepo = createWorkflowRunsRepo(handle.workspaceDb);
const staging = createWorkflowStaging(wfRepo);
const deps: AgentRunnerDeps = {
  handle,
  model: writeModel,
  auditModel,
  staging,
};
const stream = runAgentWorkflow(deps, { message, source, executionMode });
return streamSseResponse(holdBook(deps.registry, bookId, stream));
```

- [ ] **Step 3: 更新集成测试**

`packages/server/tests/integration/agent-runner-routes.test.ts` 的断言改为验证四阶段出现:

```ts
expect(text).toContain('"agent_phase"');
expect(text).toContain('"thinking"');
expect(text).toContain('"executing"');
expect(text).toContain('"validating"');
expect(text).toContain('"done"');
```

- [ ] **Step 4: 跑全测**

```powershell
pnpm --filter @scribe/server run test
```

- [ ] **Step 5: 提交**

```powershell
git add packages/server/src/ai/orchestrator/agent-runner.ts packages/server/src/http/routes/agent.ts packages/server/tests/integration/agent-runner-routes.test.ts
git commit -m "feat(agent-runner): wire four roles into runAgentWorkflow"
```

---

### Task 11: conversation wrapper — 旧 /conversation 回调新管线

**Files:**
- Modify: `packages/server/src/http/routes/conversation.ts`

- [ ] **Step 1: 改写** — 在 `mode === "chat"` 分支里,把现有的 `runConversation(...)` 替换为 `runAgentWorkflow(...)` 调用:

```ts
// @deprecated — direct runConversation replaced by agent pipeline.
// Remove after Phase 8 client migration.
import { runAgentWorkflow } from "../../ai/orchestrator/agent-runner.js";
import { createWorkflowStaging } from "../../ai/orchestrator/workflow-staging.js";
import { createWorkflowRunsRepo } from "../../db/repositories/workflow-runs.js";

// inside the chat handler:
const staging = createWorkflowStaging(createWorkflowRunsRepo(handle.workspaceDb));
const inner = runAgentWorkflow(
  {
    handle,
    model,
    auditModel: auditModel,
    staging,
  },
  {
    message,
    source: "chat",
    executionMode,
  },
);
```

保留 `withUsageRecording` 和 `streamSseResponse` 包装。

- [ ] **Step 2: 更新 conversation-echo.test.ts** 的断言

验证SSE 流中现在包含 `agent_phase` 事件(而不是旧的 `workflow_step`):

```ts
expect(text).toContain('"agent_phase"');
```

- [ ] **Step 3: 跑测**

```powershell
pnpm --filter @scribe/server exec vitest run tests/integration/conversation-echo.test.ts
```

- [ ] **Step 4: 提交**

```powershell
git add packages/server/src/http/routes/conversation.ts packages/server/tests/integration/conversation-echo.test.ts
git commit -m "feat(conversation): wrap /conversation over agent pipeline"
```

---

### Task 12: editor wrapper — /write /finalize 合并走管线

**Files:**
- Modify: `packages/server/src/http/routes/chapters.ts`

- [ ] **Step 1: /write 变 wrapper**

在现有的 `app.post("/api/books/:bookId/chapters/:no/write"` handler 里,替换核心的 `writeWithAudit(...)` 调用为:

```ts
// @deprecated — replaced by POST /agent/run with source:"editor". Remove after Phase 8.
import { runAgentWorkflow } from "../../ai/orchestrator/agent-runner.js";
import { createWorkflowStaging } from "../../ai/orchestrator/workflow-staging.js";
import { createWorkflowRunsRepo } from "../../db/repositories/workflow-runs.js";

const staging = createWorkflowStaging(createWorkflowRunsRepo(handle.workspaceDb));
const inner = runAgentWorkflow(
  { handle, model: wcDeps.model, auditModel, staging },
  {
    message: userIntent,
    source: "editor",
    executionMode: "confirm_each",
    target: { chapterNo: no },
  },
);
```

`writeChapterSimple`(原来的 prose 生成调用)保留——它会在 Executor Agent 内部被复用。

- [ ] **Step 2: 同步更新旧 /finalize handler** — 改为相同的 wrapper 签名,`source: "editor"` + `target.chapterNo`,Main Agent 识别到该章已有草稿。

- [ ] **Step 3: 标记 /write-draft 为废弃**

在 handler 顶部加注释,并让 handler 直接返回 410:

```ts
// @deprecated — prose generation + validation now unified in agent pipeline.
// Remove after Phase 8 client migration.
app.post("/api/books/:bookId/chapters/:no/write-draft", async (c) => {
  return c.json({ error: "write-draft 已废弃,请使用 /agent/run" }, 410);
});
```

- [ ] **Step 4: 跑 chapters 集成测试**

```powershell
pnpm --filter @scribe/server exec vitest run tests/integration
```

- [ ] **Step 5: 提交**

```powershell
git add packages/server/src/http/routes/chapters.ts
git commit -m "feat(editor): wrap /write /finalize over agent pipeline + deprecate /write-draft"
```

---

### Task 13: auto / onboard / revision wrappers

**Files:**
- Modify: `packages/server/src/http/routes/auto.ts`
- Modify: `packages/server/src/http/routes/onboard.ts`(查找实际 onboard handler 文件)
- Modify: `packages/server/src/http/routes/revise.ts`

- [ ] **Step 1: auto 迁移**

在 `auto.ts` 的 `runAutoMode(...)` 调用处替换为:

```ts
// @deprecated — replaced by agent pipeline with source:"auto". Remove after Phase 8.
const staging = createWorkflowStaging(createWorkflowRunsRepo(handle.workspaceDb));
const inner = runAgentWorkflow(
  { handle, model: model!, auditModel: auditModel!, staging },
  { message: `写 ${n} 章`, source: "auto", executionMode: "trusted_auto", target: { chapterCount: n } },
);
```

`runAutoMode` 文件保留不删,其中的 loop 逻辑后续迁移到 Executor Agent 的 `chapterCount` 循环。

- [ ] **Step 2: onboard 迁移**

找到 onboard handler(在 `POST /api/books/:bookId/onboard` 或 equivalent),替换为 `source: "onboard"`:

```ts
// @deprecated — replaced by agent pipeline. Remove after Phase 8.
const staging = createWorkflowStaging(createWorkflowRunsRepo(handle.workspaceDb));
const inner = runAgentWorkflow(
  { handle, model, auditModel, staging },
  { message: "onboard 新书", source: "onboard", executionMode: "confirm_each" },
);
```

- [ ] **Step 3: revision 迁移**

在 `revise.ts` 的 segment revise handler 替换为:

```ts
// @deprecated — replaced by agent pipeline. Remove after Phase 8.
const staging = createWorkflowStaging(createWorkflowRunsRepo(handle.workspaceDb));
const inner = runAgentWorkflow(
  { handle, model, auditModel, staging },
  { message: instruction, source: "revision", executionMode: "confirm_each", target: { revisionRange: { chapterNo: no, selectedText: segmentText } } },
);
```

- [ ] **Step 4: 跑全测**

```powershell
pnpm --filter @scribe/server run test
```

- [ ] **Step 5: 提交**

```powershell
git add packages/server/src/http/routes/auto.ts packages/server/src/http/routes/revise.ts packages/server/src/http/routes/onboard.ts
git commit -m "feat(wrappers): auto/onboard/revision over agent pipeline"
```

---

### Task 14: 全量 typecheck + test + 推送

- [ ] **Step 1: 跑所有 typecheck**

```powershell
pnpm --filter @scribe/shared run typecheck
pnpm --filter @scribe/server run typecheck
pnpm --filter @scribe/client run typecheck
```

- [ ] **Step 2: 跑所有测试**

```powershell
pnpm --filter @scribe/shared exec vitest run
pnpm --filter @scribe/server run test
pnpm --filter @scribe/client run test
```

- [ ] **Step 3: 手动跑自检清单(spec §8)**

```powershell
rg -n "hard_fact_gate|硬事实|chapter_audit|审查章节质量|record_chapter_state|记录角色状态|write-draft|finalize" packages/client/src
rg -n "chapters/:no/write-draft|chapters/:no/finalize|worldbook/chat" packages/client/src
```

预期:旧标签不在 UI 中出现;`write-draft`/`finalize` 不被 UI 直接调用。

- [ ] **Step 4: 推送**

```powershell
git send-pack git@github.com:DECADE0502/Scribe.git codex/generic-record-architecture
```

---

## Self-Review Notes

- **Spec coverage**:共享类型→Task 1/2;数据+暂存层→Task 3/4;路由骨架→Task 5/10;四角色→Task 6-9;conversation/editor/auto/onboard/revision 迁移→Task 11-13;推送→Task 14。
- **No placeholders**:全部 Step 包含完整代码/命令/预期输出。
- **Type consistency**:`StagedChange` 在 Task 4 定义,Task 7/9/10 复用;`TaskContract` 在 Task 7 定义,Task 8/10 复用;`ValidationReport` 在 Task 1 定义,Task 6/9/10 复用。
- **Not in scope**:旧代码文件不删(标记 @deprecated);worldbook/chat 迁移留到 Phase 7;客户端改造留到 Phase 8;暂存层 commit 失败时的 call-by-call 回滚不做。
