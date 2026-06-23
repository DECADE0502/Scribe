# Write-Context Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让写作 AI 在生成第 N 章时看到正确层级的历史(最近 1-3 章全文 + 4-20 章小总结 + 更远的弧/卷总结),修复 POV 漂移与 1M 模型预算未用尽,且不引入新机制。

**Architecture:** 沿用 outline 树作天然压缩边界——`record_chapter_state` 在 arc/volume 末章时同趟产出大总结写进 `outline_nodes.summary`;`buildWriteContext` 按层级算法选择粒度并去重;`buildChapterWriteMessages` 新增预算入参,4 个调用点从 `modelManager` 取 `contextWindow` 后传入;`local-model-table.ts` 加 `[1m]` 后缀识别。

**Tech Stack:** TypeScript 5+, Node 20+, Hono, better-sqlite3, Vercel AI SDK, Vitest, pnpm monorepo.

**Spec reference:** `docs/superpowers/specs/2026-06-23-write-context-memory-design.md`

**Working tree:** `C:\Users\Administrator\Desktop\Scribe-gh`(non-Scribe-suffixed 是原 clone 残留,不动)。所有命令默认从 `Scribe-gh` 根执行。

---

### Task 1: `[1m]` 后缀识别 + 单测

**Files:**
- Modify: `packages/server/src/ai/providers/local-model-table.ts`
- Test: `packages/server/tests/unit/ai/providers/local-model-table.test.ts`(新建)

- [ ] **Step 1: 写失败测试**

```ts
// packages/server/tests/unit/ai/providers/local-model-table.test.ts
import { describe, expect, it } from "vitest";
import { lookupLocal } from "../../../../src/ai/providers/local-model-table.js";

describe("lookupLocal [1m] 后缀", () => {
  it("普通 id 返回基础条目", () => {
    expect(lookupLocal("claude-opus-4-7")?.contextWindow).toBe(200_000);
  });
  it("[1m] 后缀强制 contextWindow=1_000_000", () => {
    const info = lookupLocal("claude-opus-4-7[1m]");
    expect(info?.contextWindow).toBe(1_000_000);
    expect(info?.supportsTools).toBe(true); // 继承基础条目
  });
  it("基础条目不存在的 [1m] id 也返回 contextWindow=1_000_000", () => {
    const info = lookupLocal("unknown-model[1m]");
    expect(info?.contextWindow).toBe(1_000_000);
  });
  it("未知 id 返回 undefined", () => {
    expect(lookupLocal("totally-unknown")).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测确认失败**

```bash
pnpm --filter @scribe/server exec vitest run tests/unit/ai/providers/local-model-table.test.ts
```

预期:第 2-3 项 FAIL("contextWindow Expected 1_000_000")。

- [ ] **Step 3: 实现 [1m] 识别**

替换 `packages/server/src/ai/providers/local-model-table.ts` 的 `lookupLocal`:

```ts
export function lookupLocal(id: string): Partial<ModelInfo> | undefined {
  if (id.endsWith("[1m]")) {
    const base = LOCAL_MODEL_TABLE[id.slice(0, -4)] ?? {};
    return { ...base, contextWindow: 1_000_000 };
  }
  return LOCAL_MODEL_TABLE[id];
}
```

- [ ] **Step 4: 跑测确认通过**

```bash
pnpm --filter @scribe/server exec vitest run tests/unit/ai/providers/local-model-table.test.ts
```

预期:全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/ai/providers/local-model-table.ts packages/server/tests/unit/ai/providers/local-model-table.test.ts
git commit -m "feat(model-table): [1m] 后缀强制 contextWindow=1M"
```

---

### Task 2: outline 仓库加 updateSummary + findChapterNode + clearAncestorSummaries

**Files:**
- Modify: `packages/server/src/db/repositories/outline.ts`
- Test: `packages/server/tests/unit/db/repositories/outline.test.ts`(新建)

**前置约定**:章节节点的 `metadata.chapterNo` 是 number,由 outline 创建/导入流程负责写入。没有 chapterNo 的章节节点视为"未关联",`findChapterNode` 返回 undefined。

- [ ] **Step 1: 写失败测试**

```ts
// packages/server/tests/unit/db/repositories/outline.test.ts
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { runMigrations } from "../../../../src/db/migrations/runner.js";
import { createOutlineRepo } from "../../../../src/db/repositories/outline.js";

const MIGRATION_DIR = path.resolve(__dirname, "../../../../src/db/migrations/workspace");

describe("outline repo 新方法", () => {
  let db: Database.Database;
  let tmp: string;
  let repo: ReturnType<typeof createOutlineRepo>;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "outline-"));
    db = new Database(path.join(tmp, "w.db"));
    runMigrations(db, MIGRATION_DIR);
    repo = createOutlineRepo(db);
  });
  afterEach(() => { db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

  it("updateSummary 写入并允许清空", () => {
    const node = repo.create({
      parentId: null, level: "arc", title: "弧 1", summary: null,
      status: "planned", sortOrder: 0, metadata: null,
    });
    repo.updateSummary(node.id, "弧 1 的总结");
    expect(repo.get(node.id)?.summary).toBe("弧 1 的总结");
    repo.updateSummary(node.id, null);
    expect(repo.get(node.id)?.summary).toBeNull();
  });

  it("findChapterNode 按 metadata.chapterNo 命中", () => {
    const ch = repo.create({
      parentId: null, level: "chapter", title: "第 3 章",
      summary: null, status: "done", sortOrder: 0,
      metadata: { chapterNo: 3 },
    });
    expect(repo.findChapterNode(3)?.id).toBe(ch.id);
    expect(repo.findChapterNode(99)).toBeUndefined();
  });

  it("clearAncestorSummaries 沿父链清空,不动其它节点", () => {
    const vol = repo.create({ parentId: null, level: "volume", title: "卷 1", summary: "卷总结", status: "done", sortOrder: 0, metadata: null });
    const arc = repo.create({ parentId: vol.id, level: "arc", title: "弧 1", summary: "弧总结", status: "done", sortOrder: 0, metadata: null });
    const sibling = repo.create({ parentId: vol.id, level: "arc", title: "弧 2", summary: "弧 2 总结", status: "done", sortOrder: 1, metadata: null });
    const ch = repo.create({ parentId: arc.id, level: "chapter", title: "章 1", summary: null, status: "done", sortOrder: 0, metadata: { chapterNo: 1 } });
    repo.clearAncestorSummaries(ch.id);
    expect(repo.get(arc.id)?.summary).toBeNull();
    expect(repo.get(vol.id)?.summary).toBeNull();
    expect(repo.get(sibling.id)?.summary).toBe("弧 2 总结");
  });
});
```

- [ ] **Step 2: 跑测确认失败**

```bash
pnpm --filter @scribe/server exec vitest run tests/unit/db/repositories/outline.test.ts
```

预期:三项均 FAIL("repo.updateSummary is not a function" 等)。

- [ ] **Step 3: 实现新方法**

在 `packages/server/src/db/repositories/outline.ts` 的 `return { ... }` 对象内加(放在 `reorder` 之后):

```ts
    updateSummary(id: string, summary: string | null): void {
      db.prepare("UPDATE outline_nodes SET summary=? WHERE id=?").run(summary, id);
    },
    findChapterNode(chapterNo: number): OutlineNode | undefined {
      // metadata 是 JSON;按 json_extract 命中
      const r = db.prepare(
        `SELECT * FROM outline_nodes
          WHERE level='chapter'
            AND CAST(json_extract(metadata,'$.chapterNo') AS INTEGER) = ?`
      ).get(chapterNo);
      return r ? rowToNode(r) : undefined;
    },
    clearAncestorSummaries(nodeId: string): void {
      // 沿父链(不含自身)清空 summary
      const tx = db.transaction(() => {
        let cur = this.get(nodeId);
        while (cur && cur.parentId) {
          const parent = this.get(cur.parentId);
          if (!parent) break;
          db.prepare("UPDATE outline_nodes SET summary=NULL WHERE id=?").run(parent.id);
          cur = parent;
        }
      });
      tx();
    },
    /** 给删除场景用:直接从 parentId 开始向上清空(被删节点已不存在时也可用)。*/
    clearAncestorSummariesByParentId(parentId: string | null): void {
      if (!parentId) return;
      const tx = db.transaction(() => {
        let curId: string | null = parentId;
        while (curId) {
          db.prepare("UPDATE outline_nodes SET summary=NULL WHERE id=?").run(curId);
          const r = db.prepare("SELECT parent_id FROM outline_nodes WHERE id=?").get(curId) as { parent_id?: string } | undefined;
          curId = r?.parent_id ?? null;
        }
      });
      tx();
    },
```

- [ ] **Step 4: 跑测确认通过**

```bash
pnpm --filter @scribe/server exec vitest run tests/unit/db/repositories/outline.test.ts
```

预期:三项 PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/db/repositories/outline.ts packages/server/tests/unit/db/repositories/outline.test.ts
git commit -m "feat(outline): updateSummary/findChapterNode/clearAncestorSummaries"
```

---

### Task 3: snapshot.ts 暴露 outline 路径(章 → 弧 → 卷)+ 大总结

**Files:**
- Modify: `packages/server/src/ai/context-builder/snapshot.ts`
- Test: `packages/server/tests/unit/ai/context-builder/snapshot.test.ts`(已存在,加 case)

`SnapshotRepos.outlineRepo` 当前只声明了 `listAll()`,需要可调用 `findChapterNode`/`get`。增加 snapshot 字段 `chapterOutlinePaths` 与 `arcVolumeSummaries`。

- [ ] **Step 1: 写失败测试**

打开 `packages/server/tests/unit/ai/context-builder/snapshot.test.ts`,在最后一个 `describe` 里追加:

```ts
  it("载入 outline 章→弧→卷 路径与弧/卷总结", () => {
    // 准备:卷 1 > 弧 A(章 1,2) > 弧 B(章 3); 弧 A.summary="弧 A 总结"; 卷 1.summary=null
    // ... 测试 fixture 设置参考已有用例 ...
    const snap = loadBookSnapshot("b1", repos, paths);
    expect(snap.chapterOutlinePaths.find(p => p.chapterNo === 1)).toMatchObject({
      arcSummary: "弧 A 总结",
      volumeSummary: null,
    });
    expect(snap.chapterOutlinePaths.find(p => p.chapterNo === 3)?.arcSummary).toBeNull();
    expect(snap.arcVolumeSummaries.some(s => s.nodeId && s.text === "弧 A 总结")).toBe(true);
  });
```

具体 fixture 设置参考该文件已有的 `beforeEach` 模式(创建 outline 节点 + chapter summary)。

- [ ] **Step 2: 跑测确认失败**

```bash
pnpm --filter @scribe/server exec vitest run tests/unit/ai/context-builder/snapshot.test.ts
```

预期:新 case FAIL("chapterOutlinePaths is undefined")。

- [ ] **Step 3: 实现**

在 `packages/server/src/ai/context-builder/snapshot.ts`:

3a. 加类型(放 `ChapterFullContent` 旁):

```ts
export interface ChapterOutlinePath {
  chapterNo: number;
  chapterNodeId: string | null;
  arcNodeId: string | null;
  arcSummary: string | null;
  volumeNodeId: string | null;
  volumeSummary: string | null;
}

export interface OutlineLevelSummary {
  nodeId: string;
  level: "arc" | "volume";
  text: string;
}
```

3b. `BookSnapshot` 加两个字段:

```ts
  chapterOutlinePaths: ChapterOutlinePath[];
  arcVolumeSummaries: OutlineLevelSummary[];
```

3c. `SnapshotRepos.outlineRepo` 类型扩到:

```ts
  outlineRepo: {
    listAll(): OutlineNode[];
    findChapterNode(chapterNo: number): OutlineNode | undefined;
    get(id: string): OutlineNode | undefined;
  };
```

3d. `loadBookSnapshot` 内,在 `return` 之前加:

```ts
  // 章号 → outline 路径 + 弧/卷总结(节点找不到则字段全 null)
  const chapterOutlinePaths: ChapterOutlinePath[] = allSummaries.map((s) => {
    const ch = repos.outlineRepo.findChapterNode(s.chapterNo);
    if (!ch) return { chapterNo: s.chapterNo, chapterNodeId: null, arcNodeId: null, arcSummary: null, volumeNodeId: null, volumeSummary: null };
    const arc = ch.parentId ? repos.outlineRepo.get(ch.parentId) : undefined;
    const volume = arc?.parentId ? repos.outlineRepo.get(arc.parentId) : undefined;
    return {
      chapterNo: s.chapterNo,
      chapterNodeId: ch.id,
      arcNodeId: arc?.level === "arc" ? arc.id : null,
      arcSummary: arc?.level === "arc" ? (arc.summary ?? null) : null,
      volumeNodeId: volume?.level === "volume" ? volume.id : null,
      volumeSummary: volume?.level === "volume" ? (volume.summary ?? null) : null,
    };
  });
  const seen = new Set<string>();
  const arcVolumeSummaries: OutlineLevelSummary[] = [];
  for (const node of repos.outlineRepo.listAll()) {
    if ((node.level === "arc" || node.level === "volume") && node.summary && !seen.has(node.id)) {
      arcVolumeSummaries.push({ nodeId: node.id, level: node.level, text: node.summary });
      seen.add(node.id);
    }
  }
```

3e. 在 `return` 对象里加 `chapterOutlinePaths, arcVolumeSummaries,`。

- [ ] **Step 4: 跑测确认通过**

```bash
pnpm --filter @scribe/server exec vitest run tests/unit/ai/context-builder/snapshot.test.ts
```

预期:新 case PASS,旧 case 仍 PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/ai/context-builder/snapshot.ts packages/server/tests/unit/ai/context-builder/snapshot.test.ts
git commit -m "feat(snapshot): expose chapter→arc→volume paths and arc/volume summaries"
```

---

### Task 4: builder.ts 接入 recentFullChapters + midRangeSummaries,且与 recentSummaries 去重

**Files:**
- Modify: `packages/server/src/ai/context-builder/builder.ts`
- Test: `packages/server/tests/integration/context-builder.test.ts`

- [ ] **Step 1: 写失败测试**

在 `tests/integration/context-builder.test.ts` 现有 `describe("buildWriteContext 集成")` 内追加:

```ts
  it("snapshot.recentFullChapters 必出现在 messages 里,且不被对应章号的小总结重复", () => {
    // fixture 里第 18-20 章已写,有 chapterFiles 注入正文
    const snap = loadBookSnapshot("b1", repos, paths);
    const r = buildWriteContext({
      snapshot: snap,
      currentChapterNo: 21,
      intent: { characters: [], foreshadowing: [], userMessage: "" },
      budgetTokens: 500_000,
    });
    const all = r.messages.slice(1).map(m => m.content as string).join("\n");
    // 必含第 20 章原文(fixture 的章正文应有一段已知字符串)
    expect(all).toContain("第 20 章");
    // 不应该再以"小总结"形式重复第 18/19/20 章的 paragraph
    // (假设 fixture 第 20 章 paragraph 含 "总结-20" 串)
    expect((all.match(/总结-20/g) ?? []).length).toBe(0);
  });

  it("midRangeSummaries(11-20 章前)注入 messages", () => {
    // fixture 已写满 25 章,currentChapterNo=26
    const snap = loadBookSnapshot("b1", repos, paths);
    const r = buildWriteContext({
      snapshot: snap, currentChapterNo: 26,
      intent: { characters: [], foreshadowing: [], userMessage: "" },
      budgetTokens: 500_000,
    });
    const all = r.messages.slice(1).map(m => m.content as string).join("\n");
    // 第 6-15 章 应作为 midRange 出现(以 oneLiner 标记)
    expect(all).toContain("第 15 章");
    expect(all).toContain("第 6 章");
  });
```

测试 fixture 不足时,扩展该文件顶部的 `beforeEach`(或新增专门用的 fixture)——参考已有的 "loadBookSnapshot 集成" 部分的 fixture 构造。

- [ ] **Step 2: 跑测确认失败**

```bash
pnpm --filter @scribe/server exec vitest run tests/integration/context-builder.test.ts
```

预期:新两项 FAIL。

- [ ] **Step 3: 实现**

打开 `packages/server/src/ai/context-builder/builder.ts`,在 `buildWriteContext` 内,先把 recent/recalled 取值改为基于"覆盖章号"去重:

```ts
  const fullChapterNos = new Set(opts.snapshot.recentFullChapters.map(c => c.chapterNo));
  // recent 用作"第 4-10 章"的小总结(全文已覆盖的跳过);maxFullCovered 是已覆盖的最大章号
  const recentChapterSummaries = opts.snapshot.recentSummaries
    .filter(s => !fullChapterNos.has(s.chapterNo))
    .slice(0, 7); // 已经被全文覆盖时还能再补到第 N-10 附近
  const midRange = opts.snapshot.midRangeSummaries; // 已是 11-20 章窗
```

然后渲染 3 个新块并**整体替换**现有的 `sections` 数组(arc/volume 总结块在 Task 5 加上;此 Task 先按时间倒序定好骨架):

```ts
  const recentFullBlock = renderRecentFullChaptersBlock(opts.snapshot.recentFullChapters);
  const midRangeBlock = renderMidRangeBlock(midRange);
  const recentSummariesBlock = renderRecentBlock(recentChapterSummaries);

  const sections: Section[] = [
    ...maybe("setting", 100, settingBlock),
    // arc-summary / volume-summary 由 Task 5 在这两行之间插入
    ...maybe("mid-range", 90, midRangeBlock),
    ...maybe("recent-summary", 82, recentSummariesBlock),
    ...maybe("worldbook", 88, worldbookBlock),
    ...maybe("reader-issues", 85, readerIssuesBlock),
    ...maybe("foreshadowing", 95, foreshadowingBlock),
    ...maybe("records", 40, recordsBlock),         // 噪声税:压低(Task 6 还会改内容)
    ...maybe("characters", 40, charactersBlock),   // 同上
    ...maybe("recalled", 70, recalledBlock),
    ...maybe("recent-full", 97, recentFullBlock),  // 1-3 章原文,紧贴 instruction
    ...maybe("instruction", 99, instructionBlock),
  ];
```

- [ ] **Step 4: 跑测确认通过**

```bash
pnpm --filter @scribe/server exec vitest run tests/integration/context-builder.test.ts
```

预期:新两项 PASS,其它仍 PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/ai/context-builder/builder.ts packages/server/tests/integration/context-builder.test.ts
git commit -m "feat(builder): wire recentFullChapters/midRange and dedup with recentSummaries"
```

---

### Task 5: builder.ts 加 arc/volume 总结块 + 层级选择算法

**Files:**
- Modify: `packages/server/src/ai/context-builder/builder.ts`
- Test: `packages/server/tests/integration/context-builder.test.ts`

- [ ] **Step 1: 写失败测试**

在 context-builder.test.ts 加:

```ts
  it("arc 全脱出 20 章窗时,只塞 ArcSummary,不塞该弧的零散小总结", () => {
    // fixture:卷 1 > 弧 A(章 1-5,summary="弧 A 总结") > 弧 B(章 6-25)
    // currentChapterNo=26,弧 A 的 5 章 (1-5) 已脱出 20 章窗(N-20=6)
    const snap = loadBookSnapshot("b1", repos, paths);
    const r = buildWriteContext({
      snapshot: snap, currentChapterNo: 26,
      intent: { characters: [], foreshadowing: [], userMessage: "" },
      budgetTokens: 500_000,
    });
    const all = r.messages.slice(1).map(m => m.content as string).join("\n");
    expect(all).toContain("弧 A 总结");
    // 第 1-5 章的小总结不应出现
    expect(all).not.toContain("第 1 章 — ");
    expect(all).not.toContain("第 5 章 — ");
  });

  it("arc 部分脱出窗时,窗内章节用小总结,窗外章节不用任何粒度(避免语义不准的 arc 半截)", () => {
    // 弧 A:章 6-15;currentChapterNo=21;窗 [1,20];弧 A 全在窗内
    // 改为:弧 A:章 1-15;currentChapterNo=21,弧 A 部分脱出(1-5 脱出,6-15 在窗内)
    const snap = loadBookSnapshot("b1", repos, paths);
    const r = buildWriteContext({
      snapshot: snap, currentChapterNo: 21,
      intent: { characters: [], foreshadowing: [], userMessage: "" },
      budgetTokens: 500_000,
    });
    const all = r.messages.slice(1).map(m => m.content as string).join("\n");
    // 弧 A 半截不出 ArcSummary
    expect(all).not.toContain("弧 A 总结");
    // 6-15 章用小总结(midRange 或 recent-summary 取决于距离)
    expect(all).toContain("第 6 章");
  });
```

- [ ] **Step 2: 跑测确认失败**

```bash
pnpm --filter @scribe/server exec vitest run tests/integration/context-builder.test.ts
```

预期:两项 FAIL("弧 A 总结" not found 或语义错误)。

- [ ] **Step 3: 实现**

在 `builder.ts` 加一个层级选择函数:

```ts
/**
 * 决定:
 *  - 哪些 arc 节点应该用 ArcSummary 整条压;
 *  - 哪些 chapter 号应该用小总结;
 *  - 哪些章号应该被屏蔽(arc 半截脱出窗的"窗外"章)。
 *
 * 输入:已写章号、当前章号、snapshot.chapterOutlinePaths/arcVolumeSummaries。
 * 输出:{ arcsToUse:Set<nodeId>, volumesToUse:Set<nodeId>, summariesToShow:Set<chapterNo> }
 */
function pickLayers(
  paths: BookSnapshot["chapterOutlinePaths"],
  currentChapterNo: number,
): {
  arcsToUse: Set<string>;
  volumesToUse: Set<string>;
  summariesToShow: Set<number>;
} {
  const windowFloor = currentChapterNo - 20; // <windowFloor 即"脱出窗"
  const fullFloor = currentChapterNo - 3;    // <=fullFloor 的全文已塞
  const arcsToUse = new Set<string>();
  const volumesToUse = new Set<string>();
  const summariesToShow = new Set<number>();

  // group chapters by arcNode
  const byArc = new Map<string | null, BookSnapshot["chapterOutlinePaths"]>();
  for (const p of paths) {
    if (p.chapterNo >= currentChapterNo) continue;
    const key = p.arcNodeId ?? null;
    const list = byArc.get(key) ?? [];
    list.push(p);
    byArc.set(key, list);
  }

  for (const [arcId, chapters] of byArc) {
    if (arcId === null) {
      // 扁平 outline:走小总结/auto_digest 兜底,这里就让小总结显
      for (const p of chapters) if (p.chapterNo < currentChapterNo) summariesToShow.add(p.chapterNo);
      continue;
    }
    const arcSummary = chapters[0]!.arcSummary;
    const allOutOfWindow = chapters.every(c => c.chapterNo < windowFloor);
    const someInWindow = chapters.some(c => c.chapterNo >= windowFloor);

    if (allOutOfWindow && arcSummary) {
      // 整 arc 全脱出 + 有 summary → 用 ArcSummary
      arcsToUse.add(arcId);
    } else if (someInWindow) {
      // 窗内章用小总结,窗外章屏蔽
      for (const c of chapters) {
        if (c.chapterNo >= windowFloor) summariesToShow.add(c.chapterNo);
        // else:屏蔽(走召回兜底)
      }
    }
    // else (全脱出且无 summary):屏蔽,走召回
  }

  // 卷总结:类似——所有该卷的 arc 都已经"全脱出 + 有 summary"使用 ArcSummary 时,
  // 进一步合并成 VolumeSummary(若 volume 有 summary 且 arc 都已脱出)
  // 简化:如果 volume 节点的 summary 存在,且该 volume 下所有 arc 都已 allOutOfWindow,
  // 改用 VolumeSummary,从 arcsToUse 中移除对应 arc。
  const volumeByArc = new Map<string, string>(); // arcId → volumeId
  for (const p of paths) if (p.arcNodeId && p.volumeNodeId) volumeByArc.set(p.arcNodeId, p.volumeNodeId);
  const volumeArcGroups = new Map<string, string[]>(); // volumeId → arcIds
  for (const [arcId, volId] of volumeByArc) {
    const list = volumeArcGroups.get(volId) ?? [];
    list.push(arcId);
    volumeArcGroups.set(volId, list);
  }
  for (const [volId, arcIds] of volumeArcGroups) {
    const path = paths.find(p => p.volumeNodeId === volId);
    if (!path?.volumeSummary) continue;
    const allArcsUsed = arcIds.every(a => arcsToUse.has(a));
    if (allArcsUsed) {
      volumesToUse.add(volId);
      for (const a of arcIds) arcsToUse.delete(a);
    }
  }

  return { arcsToUse, volumesToUse, summariesToShow };
}
```

5b. 在 `buildWriteContext` 内调用 `pickLayers`,把它的结果用于过滤 `midRange/recentChapterSummaries/recalled`,并组装新的 arc/volume sections:

```ts
  const layers = pickLayers(opts.snapshot.chapterOutlinePaths, opts.currentChapterNo);

  const arcSummaryBlock = (() => {
    const arcs = opts.snapshot.arcVolumeSummaries
      .filter(s => s.level === "arc" && layers.arcsToUse.has(s.nodeId));
    if (!arcs.length) return "";
    return ["## 已完成弧总结"].concat(arcs.map(a => `### 弧节点 ${a.nodeId}\n${a.text}`)).join("\n");
  })();
  const volumeSummaryBlock = (() => {
    const vols = opts.snapshot.arcVolumeSummaries
      .filter(s => s.level === "volume" && layers.volumesToUse.has(s.nodeId));
    if (!vols.length) return "";
    return ["## 已完成卷总结"].concat(vols.map(v => `### 卷节点 ${v.nodeId}\n${v.text}`)).join("\n");
  })();

  // 过滤 midRange / recentChapterSummaries:只保留 summariesToShow 包含的章号
  const filteredMid = midRange.filter(s => layers.summariesToShow.has(s.chapterNo));
  const filteredRecent = recentChapterSummaries.filter(s => layers.summariesToShow.has(s.chapterNo));
  const midRangeBlock = renderMidRangeBlock(filteredMid);
  const recentSummariesBlock = renderRecentBlock(filteredRecent);
```

5c. `sections` 数组按时间倒序更新(volume → arc → midRange → recent-summary → … → recent-full → instruction):

```ts
  const sections: Section[] = [
    ...maybe("setting", 100, settingBlock),
    ...maybe("volume-summary", 80, volumeSummaryBlock),
    ...maybe("arc-summary", 92, arcSummaryBlock),
    ...maybe("mid-range", 90, midRangeBlock),
    ...maybe("recent-summary", 82, recentSummariesBlock),
    ...maybe("worldbook", 88, worldbookBlock),
    ...maybe("reader-issues", 85, readerIssuesBlock),
    ...maybe("foreshadowing", 95, foreshadowingBlock),
    ...maybe("records", 40, recordsBlock),
    ...maybe("characters", 40, charactersBlock),
    ...maybe("recalled", 70, recalledBlock),
    ...maybe("recent-full", 97, recentFullBlock),
    ...maybe("instruction", 99, instructionBlock),
  ];
```

- [ ] **Step 4: 跑测确认通过**

```bash
pnpm --filter @scribe/server exec vitest run tests/integration/context-builder.test.ts
```

预期:两项 PASS,Task 4 的两项继续 PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/ai/context-builder/builder.ts packages/server/tests/integration/context-builder.test.ts
git commit -m "feat(builder): pick arc/volume summaries by window; suppress half-out arcs"
```

---

### Task 6: 噪声税清理 — records 块去 schema,character 块只留 currentState

**Files:**
- Modify: `packages/server/src/ai/context-builder/builder.ts`
- Test: `packages/server/tests/integration/context-builder.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
  it("写作 prompt 不含 records schema 字样(identity:/display:/searchFields)", () => {
    const snap = loadBookSnapshot("b1", repos, paths);
    const r = buildWriteContext({
      snapshot: snap, currentChapterNo: 5,
      intent: { characters: [], foreshadowing: [], userMessage: "" },
      budgetTokens: 500_000,
    });
    const all = r.messages.slice(1).map(m => m.content as string).join("\n");
    expect(all).not.toMatch(/identity:/);
    expect(all).not.toMatch(/display:/);
    expect(all).not.toMatch(/searchFields/);
  });

  it("character 块只露 currentState 摘要,不露 background/motivation/languageHabits", () => {
    const snap = loadBookSnapshot("b1", repos, paths);
    const r = buildWriteContext({
      snapshot: snap, currentChapterNo: 5,
      intent: { characters: [], foreshadowing: [], userMessage: "" },
      budgetTokens: 500_000,
    });
    const all = r.messages.slice(1).map(m => m.content as string).join("\n");
    // 假设 fixture 角色 baseData.background="测试背景串"
    expect(all).not.toContain("测试背景串");
  });
```

- [ ] **Step 2: 跑测确认失败**

```bash
pnpm --filter @scribe/server exec vitest run tests/integration/context-builder.test.ts
```

预期:两项 FAIL。

- [ ] **Step 3: 实现**

3a. 替换 `renderRecordsBlock`:

```ts
export function renderRecordsBlock(snapshot: BookSnapshot): string {
  if (!snapshot.genreSections.length) return "";
  const parts: string[] = [`## 通用记录条目(当前已存)`];
  for (const { section, items } of snapshot.genreSections) {
    if (!items.length) continue;
    parts.push(`### ${section.name}`);
    for (const item of items) {
      const label = resolveItemLabel(section, item.data, "?");
      const summary = resolveItemSearchText(section, item.data);
      parts.push(`- ${label}${summary ? `:${summary}` : ""}`);
    }
  }
  return parts.length > 1 ? parts.join("\n") : "";
}
```

3b. 替换 `renderCharactersBlock`(写作侧只露当下状态):

```ts
export function renderCharactersBlock(snapshot: BookSnapshot): string {
  if (!snapshot.characters.length) return "";
  const parts: string[] = [`## 当下角色状态`];
  for (const c of snapshot.characters) {
    const state = c.currentState as Record<string, unknown> | undefined;
    if (!state || Object.keys(state).length === 0) continue;
    const summary = Object.entries(state)
      .filter(([_, v]) => v != null && v !== "")
      .map(([k, v]) => `${k}:${typeof v === "string" ? v : JSON.stringify(v)}`)
      .join("; ");
    if (summary) parts.push(`### ${c.name}${c.role ? `(${c.role})` : ""}\n${summary}`);
  }
  return parts.length > 1 ? parts.join("\n") : "";
}
```

注意:`resolveItemSearchText` 已从 `@scribe/shared` 导入。

- [ ] **Step 4: 跑测确认通过**

```bash
pnpm --filter @scribe/server exec vitest run tests/integration/context-builder.test.ts
```

预期:两项 PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/ai/context-builder/builder.ts packages/server/tests/integration/context-builder.test.ts
git commit -m "fix(builder): drop schema chatter and baseData from write prompt"
```

---

### Task 7: write 路径接入 outline 节点 → intent.chapterPlan

**Files:**
- Modify: `packages/server/src/ai/context-builder/book-context.ts`
- Test: `packages/server/tests/integration/context-builder.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
  it("write 路径自动把本章 outline 节点拼到 chapterPlan", () => {
    // fixture:章 5 的 outline 节点 title="第 5 章 决战" metadata.chapterNo=5
    // 不调用 outline 节点时 chapterPlan 应空;现在应拼上
    const ctx = buildChapterWriteMessages(handle, 5, "写一下");
    const all = ctx.messages.map(m => typeof m.content === "string" ? m.content : "").join("\n");
    expect(all).toContain("第 5 章 决战"); // 节点标题应进 prompt
  });
```

(此测试要在 `tests/integration` 里准备一个完整 `BookHandle` fixture——参考已有 `chapters` 路由的集成测试。如果该测试目录不便构造 handle,放到现有 `chapter-write-context.test.ts` 类的位置。)

- [ ] **Step 2: 跑测确认失败**

```bash
pnpm --filter @scribe/server exec vitest run tests/integration
```

预期:新 case FAIL。

- [ ] **Step 3: 实现**

3a. 在 `book-context.ts` 顶部加新纯函数:

```ts
function renderOutlineNodeForWriting(node: OutlineNode): string {
  const parts = [`## 本章 outline 节点(目标)`, `### ${node.title}`];
  if (node.summary) parts.push(node.summary);
  const meta = node.metadata as Record<string, unknown> | null;
  if (meta?.keyEvents && Array.isArray(meta.keyEvents)) {
    parts.push("关键事件:");
    for (const e of meta.keyEvents) parts.push(`- ${String(e)}`);
  }
  return parts.join("\n");
}
```

3b. 在 `buildChapterWriteMessages` 内 `loadBookSnapshot` 之后、`buildWriteContext` 之前:

```ts
  const chapterNode = handle.outlineRepo.findChapterNode(chapterNo);
  const chapterPlanText = chapterNode ? renderOutlineNodeForWriting(chapterNode) : undefined;
```

3c. `buildWriteContext` 的 `intent` 加 `chapterPlan: chapterPlanText`。

3d. `BookHandle` 类型若没暴露 `outlineRepo.findChapterNode`,扩 `book-registry.ts` 让 handle.outlineRepo 直接是 `ReturnType<typeof createOutlineRepo>`(查现状,通常已是)。

- [ ] **Step 4: 跑测确认通过**

```bash
pnpm --filter @scribe/server exec vitest run tests/integration
```

预期:新 case PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/ai/context-builder/book-context.ts packages/server/tests/integration
git commit -m "fix(book-context): wire outline node into write path chapterPlan"
```

---

### Task 8: 预算 profile — `buildChapterWriteMessages` 接预算入参 + pickWriteBudget 辅助

**Files:**
- Modify: `packages/server/src/ai/context-builder/book-context.ts`
- Create: `packages/server/src/ai/context-builder/budget-profile.ts`
- Test: `packages/server/tests/unit/ai/context-builder/budget-profile.test.ts`(新建)

- [ ] **Step 1: 写失败测试**

```ts
// budget-profile.test.ts
import { describe, expect, it } from "vitest";
import { pickWriteBudget } from "../../../../src/ai/context-builder/budget-profile.js";

describe("pickWriteBudget", () => {
  it.each([
    [1_000_000, 400_000],
    [500_000, 400_000],
    [200_000, 80_000],
    [100_000, 32_000],
    [64_000, 32_000],
    [32_000, 16_000],
    [undefined, 32_000],
  ])("contextWindow=%s → %s", (ctx, expected) => {
    expect(pickWriteBudget(ctx)).toBe(expected);
  });
});
```

- [ ] **Step 2: 跑测确认失败**

```bash
pnpm --filter @scribe/server exec vitest run tests/unit/ai/context-builder/budget-profile.test.ts
```

预期:整个文件 FAIL(import 不存在)。

- [ ] **Step 3: 实现**

新建 `packages/server/src/ai/context-builder/budget-profile.ts`:

```ts
export function pickWriteBudget(contextWindow: number | undefined): number {
  if (!contextWindow) return 32_000;
  if (contextWindow >= 500_000) return 400_000;
  if (contextWindow >= 200_000) return 80_000;
  if (contextWindow >= 100_000) return 32_000;
  if (contextWindow >= 64_000) return 32_000;
  return Math.max(8_000, Math.floor(contextWindow * 0.5));
}
```

`book-context.ts` 的 `buildChapterWriteMessages` 签名加 `writeBudgetTokens?: number`,把它传给 `buildWriteContext({ budgetTokens: opts.writeBudgetTokens, ... })`。同样 `buildChapterAuditContext` 加 `auditBudgetTokens?: number`(预算可与 write 不同,简单复用 pickWriteBudget)。

- [ ] **Step 4: 跑测确认通过**

```bash
pnpm --filter @scribe/server exec vitest run tests/unit/ai/context-builder/budget-profile.test.ts
```

预期:全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/ai/context-builder/budget-profile.ts packages/server/src/ai/context-builder/book-context.ts packages/server/tests/unit/ai/context-builder/budget-profile.test.ts
git commit -m "feat(budget): pickWriteBudget by model contextWindow"
```

---

### Task 9: 4 个调用点传入预算

**Files:**
- Modify: `packages/server/src/http/routes/chapters.ts` (2 处)
- Modify: `packages/server/src/http/routes/auto.ts` (1 处)
- Modify: `packages/server/src/ai/orchestrator/conversation-orchestrator.ts` (1 处)

- [ ] **Step 1: 写失败测试**

新增集成测试,模拟"writeModelInfo.contextWindow=1_000_000 时预算应被传到 buildWriteContext",通过 spy 验证。或者直接断言"`droppedSectionIds` 为空当 contextWindow=1M 时"。简单写法:

```ts
// 复用 tests/integration/context-builder.test.ts(或新增 chapter-budget.test.ts)
import { pickWriteBudget } from "../../src/ai/context-builder/budget-profile.js";
it("调用方应通过 modelManager.contextWindow 算出预算,而不是用默认 32k", () => {
  // 直接断言 helper
  expect(pickWriteBudget(1_000_000)).toBe(400_000);
  expect(pickWriteBudget(undefined)).toBe(32_000);
});
```

(调用点的 wiring 主要通过运行整套现有 chapters 集成测试不回归即可视为完成。)

- [ ] **Step 2: 跑现有集成测试 baseline**

```bash
pnpm --filter @scribe/server exec vitest run tests/integration
```

记录通过基线(应全绿)。

- [ ] **Step 3: 实现** —— 4 处都同模式:

```ts
import { pickWriteBudget } from "<rel>/ai/context-builder/budget-profile.js";

// 在拿到 modelManager 的位置:
const writeInfo = modelManager.getWriteModelInfo();
const budget = pickWriteBudget(writeInfo.contextWindow);

// 然后调用:
buildChapterWriteMessages(handle, no, userIntent, undefined, styleReferences, budget);
buildChapterAuditContext(handle, no, userIntent, /*chapterPlan*/ undefined, /*budget*/ budget);
```

注意 chapters.ts 的两个调用点要分别改;auto.ts 与 conversation-orchestrator.ts 各一处。

- [ ] **Step 4: 跑整套集成测试**

```bash
pnpm --filter @scribe/server run test
```

预期:全绿。

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/http/routes/chapters.ts packages/server/src/http/routes/auto.ts packages/server/src/ai/orchestrator/conversation-orchestrator.ts
git commit -m "wire(callers): pass model-aware write budget to buildChapterWriteMessages"
```

---

### Task 10: record_chapter_state 末尾接 arc 边界检测 + arc 压缩

**Files:**
- Modify: `packages/server/src/ai/orchestrator/record-state.ts`
- Create: `packages/server/src/ai/orchestrator/compress-arc.ts`
- Test: `packages/server/tests/integration/record-state-arc-summary.test.ts`(新建)

- [ ] **Step 1: 写失败测试**

```ts
// record-state-arc-summary.test.ts
// 模拟一个 arc 含 3 章子节点;前 2 章 record_chapter_state 后,outline_nodes.summary 仍为 null;
// 第 3 章 record_chapter_state 后,该 arc 节点 summary 必非空(压缩产物)。
// 用 mock model:返回固定文本"弧总结自动测试"。
```

具体 fixture 模式参考已有 `record-state.test.ts` 系列;mock model 可 reuse 现有 helper。

- [ ] **Step 2: 跑测确认失败**

```bash
pnpm --filter @scribe/server exec vitest run tests/integration/record-state-arc-summary.test.ts
```

预期:summary 为 null,FAIL。

- [ ] **Step 3: 实现**

3a. 新建 `compress-arc.ts`:

```ts
import type { LanguageModel } from "ai";
import { generateLlmText } from "../llm-call.js";
import { prependDeepestPrompt } from "../prompts/deepest-prompt.js";

export const COMPRESS_ARC_PROMPT = `你是 Scribe 的弧总结编辑。把以下若干章的小总结揉成 1-2 段(中文,~200-400 字)的弧总结,覆盖:
- 本弧主线推进
- 关键事件与转折
- 留给后续的悬念/伏笔(必须明示哪些活跃)
- 主要角色弧内变化
- 视角与文风延续要点(若与全书契约不一致,标出)
直接输出弧总结,不要前言。`;

export const COMPRESS_VOLUME_PROMPT = `你是 Scribe 的卷总结编辑。把以下若干弧的弧总结揉成 3-5 段(中文,~600-1200 字)的卷总结。覆盖整卷主线、核心人物变化、本卷未结尾的伏笔承接、视角文风延续。直接输出卷总结,不要前言。`;

export async function compressArc(opts: {
  model: LanguageModel;
  abortSignal?: AbortSignal;
  deepestPrompt?: string;
  chapterSummaries: Array<{ chapterNo: number; oneLiner: string; paragraph: string }>;
}): Promise<string> {
  const userMsg = [
    "## 本弧章节小总结",
    ...opts.chapterSummaries.map(s => `### 第 ${s.chapterNo} 章 — ${s.oneLiner}\n${s.paragraph}`),
  ].join("\n");
  return generateLlmText({
    model: opts.model,
    messages: prependDeepestPrompt(
      [{ role: "system", content: COMPRESS_ARC_PROMPT }, { role: "user", content: userMsg }],
      opts.deepestPrompt
    ),
    abortSignal: opts.abortSignal,
    providerOptions: { deepseek: { thinking: { type: "disabled" } } },
  });
}

export async function compressVolume(opts: {
  model: LanguageModel;
  abortSignal?: AbortSignal;
  deepestPrompt?: string;
  arcSummaries: Array<{ nodeTitle: string; text: string }>;
}): Promise<string> {
  const userMsg = ["## 本卷各弧总结",
    ...opts.arcSummaries.map(a => `### ${a.nodeTitle}\n${a.text}`)].join("\n");
  return generateLlmText({
    model: opts.model,
    messages: prependDeepestPrompt(
      [{ role: "system", content: COMPRESS_VOLUME_PROMPT }, { role: "user", content: userMsg }],
      opts.deepestPrompt
    ),
    abortSignal: opts.abortSignal,
    providerOptions: { deepseek: { thinking: { type: "disabled" } } },
  });
}
```

(如果 `generateLlmText` 不存在,用 `streamLlm` 收尾 text。可参考其他 audit 调用样式。)

3b. `record-state.ts` 内 `RecordStateDeps` 加可选字段:

```ts
  outlineRepo?: ReturnType<typeof createOutlineRepo>; // 供边界检测/写 summary
  chaptersRepo?: { listSummaries(): ChapterSummary[] }; // 供取该 arc 的小总结
```

3c. `recordChapterState` 末尾(`yield ev` 的循环结束后)追加:

```ts
  // 弧边界检测:若本章是其所在 arc 的最大章号且 arc 所有 chapter 都已 record 过(都有 summary),
  // 则做一趟 arc 压缩并写入 outline_nodes.summary。
  if (deps.outlineRepo && deps.chaptersRepo) {
    const chapterNode = deps.outlineRepo.findChapterNode(input.chapterNo);
    if (chapterNode?.parentId) {
      const arc = deps.outlineRepo.get(chapterNode.parentId);
      if (arc?.level === "arc") {
        const siblings = deps.outlineRepo.listChildren(arc.id)
          .filter(n => n.level === "chapter");
        const allChapterNos = siblings
          .map(n => (n.metadata as Record<string, unknown> | null)?.chapterNo)
          .filter((no): no is number => typeof no === "number");
        const maxNo = Math.max(...allChapterNos);
        const allSummariesMap = new Map(deps.chaptersRepo.listSummaries().map(s => [s.chapterNo, s]));
        const allDone = allChapterNos.every(no => allSummariesMap.has(no));
        if (input.chapterNo === maxNo && allDone) {
          try {
            const arcSummary = await compressArc({
              model: deps.model,
              abortSignal: deps.abortSignal,
              deepestPrompt: deps.deepestPrompt,
              chapterSummaries: allChapterNos
                .sort((a, b) => a - b)
                .map(no => {
                  const s = allSummariesMap.get(no)!;
                  return { chapterNo: no, oneLiner: s.oneLiner, paragraph: s.paragraph };
                }),
            });
            deps.outlineRepo.updateSummary(arc.id, arcSummary);
          } catch (e) {
            deps.readerIssuesRepo?.create({
              chapterNo: input.chapterNo,
              type: "continuity",
              severity: "warning",
              note: `弧总结压缩失败:${(e as Error).message};弧 ${arc.title} 暂无 summary。`,
            });
          }
        }
      }
    }
  }
```

3d. 4 个调用点(conversation-orchestrator.ts / auto.ts / chapters.ts ×2)的 `RecordStateDeps` 对象里加 `outlineRepo: handle.outlineRepo, chaptersRepo: handle.chaptersRepo,`。

- [ ] **Step 4: 跑测确认通过**

```bash
pnpm --filter @scribe/server exec vitest run tests/integration/record-state-arc-summary.test.ts
```

预期:PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/ai/orchestrator/compress-arc.ts packages/server/src/ai/orchestrator/record-state.ts packages/server/src/http/routes/chapters.ts packages/server/src/http/routes/auto.ts packages/server/src/ai/orchestrator/conversation-orchestrator.ts packages/server/tests/integration/record-state-arc-summary.test.ts
git commit -m "feat(record-state): compress arc at boundary and write outline_nodes.summary"
```

---

### Task 11: volume 边界检测 + 卷压缩

**Files:**
- Modify: `packages/server/src/ai/orchestrator/record-state.ts`
- Test: `packages/server/tests/integration/record-state-arc-summary.test.ts`(同文件加 volume case)

- [ ] **Step 1: 写失败测试**

加 case:卷 1 含弧 A(3 章) + 弧 B(2 章);跑完全部 5 章后,弧 A.summary 与弧 B.summary 都已写入,卷 1.summary 也应非空。

- [ ] **Step 2: 跑测确认失败** → 预期 FAIL。

- [ ] **Step 3: 实现**

在 Task 10 写 arc summary 成功后,接着检查 volume 边界:

```ts
        // 在 deps.outlineRepo.updateSummary(arc.id, arcSummary) 之后:
        if (arc.parentId) {
          const volume = deps.outlineRepo.get(arc.parentId);
          if (volume?.level === "volume") {
            const arcs = deps.outlineRepo.listChildren(volume.id).filter(n => n.level === "arc");
            const allArcsDone = arcs.every(a => a.id === arc.id || !!a.summary);
            if (allArcsDone) {
              try {
                const updatedArcs = arcs.map(a => a.id === arc.id ? { ...a, summary: arcSummary } : a);
                const volSummary = await compressVolume({
                  model: deps.model,
                  abortSignal: deps.abortSignal,
                  deepestPrompt: deps.deepestPrompt,
                  arcSummaries: updatedArcs.map(a => ({ nodeTitle: a.title, text: a.summary! })),
                });
                deps.outlineRepo.updateSummary(volume.id, volSummary);
              } catch (e) {
                deps.readerIssuesRepo?.create({
                  chapterNo: input.chapterNo,
                  type: "continuity",
                  severity: "warning",
                  note: `卷总结压缩失败:${(e as Error).message};卷 ${volume.title} 暂无 summary。`,
                });
              }
            }
          }
        }
```

- [ ] **Step 4: 跑测确认通过**

```bash
pnpm --filter @scribe/server exec vitest run tests/integration/record-state-arc-summary.test.ts
```

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/ai/orchestrator/record-state.ts packages/server/tests/integration/record-state-arc-summary.test.ts
git commit -m "feat(record-state): compress volume at boundary"
```

---

### Task 12: 扁平 outline 兜底:章数 > 30 时 auto_digest 每 10 章一段

**Files:**
- Modify: `packages/server/src/ai/orchestrator/record-state.ts`
- Modify: `packages/server/src/ai/context-builder/snapshot.ts`(消费 auto_digest)
- Modify: `packages/server/src/ai/context-builder/builder.ts`(注入 auto_digest 块)
- Test: `packages/server/tests/integration/record-state-arc-summary.test.ts`(加 case)

- [ ] **Step 1: 写失败测试**

case:扁平 outline(只有 chapter 节点,没有 arc/volume),写满 32 章。第 30 章 record 时(N % 10 === 0)应触发 auto_digest 写入 `book_meta` 的 `auto_digest_1_10`。第 32 章不再触发(下一个边界要等 40)。

- [ ] **Step 2: 跑测确认失败** → 预期 FAIL。

- [ ] **Step 3: 实现**

3a. `record-state.ts`:Task 10 的 arc 检测前判扁平 outline:

```ts
  if (deps.outlineRepo && deps.chaptersRepo) {
    const chapterNode = deps.outlineRepo.findChapterNode(input.chapterNo);
    if (!chapterNode || !chapterNode.parentId) {
      // 扁平 outline 兜底:每完成 10 章触发一次 auto_digest
      if (input.chapterNo % 10 === 0 && input.chapterNo >= 30) {
        const startNo = input.chapterNo - 29;  // 最近未压缩的 10 章
        const endNo = input.chapterNo - 20;    // 留 11-20 章窗给小总结
        const all = deps.chaptersRepo.listSummaries()
          .filter(s => s.chapterNo >= startNo && s.chapterNo <= endNo);
        if (all.length === 10) {
          try {
            const digest = await compressArc({
              model: deps.model,
              abortSignal: deps.abortSignal,
              deepestPrompt: deps.deepestPrompt,
              chapterSummaries: all.map(s => ({ chapterNo: s.chapterNo, oneLiner: s.oneLiner, paragraph: s.paragraph })),
            });
            deps.bookMetaRepo?.set(`auto_digest_${startNo}_${endNo}`, digest);
          } catch (e) {
            deps.readerIssuesRepo?.create({
              chapterNo: input.chapterNo, type: "continuity", severity: "warning",
              note: `自动 digest 压缩失败:${(e as Error).message}`,
            });
          }
        }
      }
      return; // 扁平 outline 不走 arc/volume
    }
    // 否则:Task 10/11 的 arc/volume 路径
    ...
  }
```

`RecordStateDeps` 加 `bookMetaRepo?: { set(k: string, v: string): void }`。

3b. snapshot.ts 加 `autoDigests: { startNo: number; endNo: number; text: string }[]`,从 `bookMetaRepo` 扫所有 key 以 `auto_digest_` 开头的项。

3c. builder.ts 加 `renderAutoDigestBlock` 渲染,并在层级选择算法里:扁平 outline 章号 < windowFloor 的章,优先用 auto_digest 覆盖区间;没覆盖则屏蔽。`section` 加 `{ id: "auto-digest", priority: 80, text: ... }`,与 volume 同级。

- [ ] **Step 4: 跑测确认通过** → 全绿。

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/ai/orchestrator/record-state.ts packages/server/src/ai/context-builder/snapshot.ts packages/server/src/ai/context-builder/builder.ts packages/server/tests/integration/record-state-arc-summary.test.ts
git commit -m "feat(flat-outline): every-10 auto_digest fallback in book_meta"
```

---

### Task 13: outline 编辑/章节重写时清空祖先 summary

**Files:**
- Modify: `packages/server/src/http/routes/sidebar.ts`(outline 节点 create/update/delete 都在此文件;搜 `handle.outlineRepo.create` / `.update` / `.delete`,大致在 59/83/91 行附近)
- Modify: `packages/server/src/http/routes/revise.ts`(章节段落改写接受落盘的位置,搜 `newContent = chapter.content.replace`,大致 76-80 行)
- Modify: `packages/server/src/http/routes/chapters.ts`(若有"整章重写"接口,搜 `chapterFiles.write` 或 `chapters.ts` 内的 PUT/POST 写正文路径)
- Test: `packages/server/tests/integration/outline-summary-invalidation.test.ts`(新建)

- [ ] **Step 1: 写失败测试**

```ts
// 准备:卷 1.summary="卷 1 总结"; 弧 A.summary="弧 A 总结"; 章 1 隶属弧 A 隶属卷 1
// 调用重命名弧 A 接口 → 弧 A.summary、卷 1.summary 都应为 null
// 调用 /rewrite 章 1 接口 → 同理
```

- [ ] **Step 2: 跑测确认失败** → 预期 FAIL。

- [ ] **Step 3: 实现**

3a. **sidebar.ts: create**(~第 59 行)创建出新节点后,如果父链上有 summary(volume/arc),清掉父祖先链:

```ts
const node = handle.outlineRepo.create({ ... });
handle.outlineRepo.clearAncestorSummaries(node.id); // 父链清空
```

3b. **sidebar.ts: update**(~第 83 行)节点本身改了 + 若 patch 里改了 parentId(移动),还要清原父链:

```ts
const oldNode = handle.outlineRepo.get(c.req.param("nodeId"));
const node = handle.outlineRepo.update(c.req.param("nodeId"), patch);
handle.outlineRepo.updateSummary(node.id, null); // 自身 summary 失效
handle.outlineRepo.clearAncestorSummaries(node.id); // 新祖先链清空
if (oldNode && oldNode.parentId && oldNode.parentId !== node.parentId) {
  // 移动了:也要清原父祖先链。clearAncestorSummaries 不含自身,所以从原父开始:
  handle.outlineRepo.updateSummary(oldNode.parentId, null);
  handle.outlineRepo.clearAncestorSummaries(oldNode.parentId);
}
```

3c. **sidebar.ts: delete**(~第 91 行)删除前先抓父链清掉:

```ts
const dyingNode = handle.outlineRepo.get(c.req.param("nodeId"));
handle.outlineRepo.delete(c.req.param("nodeId"));
if (dyingNode) handle.outlineRepo.clearAncestorSummaries(dyingNode.id); // 父链失效
// 注:clearAncestorSummaries 在 delete 之后仍能跑,因为它沿 parentId 链查,与节点是否存在无关
// 但安全起见,我们改成在 delete 前抓出 parentId、delete 后用一个新方法:
```

更稳妥写法:在 outline 仓库加 `clearAncestorSummariesByParentId(parentId)` 直接吃 parentId(不依赖被删节点存在);或者在 delete 之前调用 clearAncestorSummaries。**推荐前者**:

```ts
// outline.ts 加一个变体方法:
    clearAncestorSummariesByParentId(parentId: string | null): void {
      if (!parentId) return;
      const tx = db.transaction(() => {
        let curId: string | null = parentId;
        while (curId) {
          db.prepare("UPDATE outline_nodes SET summary=NULL WHERE id=?").run(curId);
          const r = db.prepare("SELECT parent_id FROM outline_nodes WHERE id=?").get(curId) as { parent_id?: string } | undefined;
          curId = r?.parent_id ?? null;
        }
      });
      tx();
    },
```

然后 delete 路径用它:

```ts
const dyingNode = handle.outlineRepo.get(c.req.param("nodeId"));
handle.outlineRepo.delete(c.req.param("nodeId"));
if (dyingNode?.parentId) handle.outlineRepo.clearAncestorSummariesByParentId(dyingNode.parentId);
```

3d. **revise.ts: 段改写落盘**(~第 76 行 `newContent = chapter.content.replace`),在写完后:

```ts
const chapterNode = handle.outlineRepo.findChapterNode(no);
if (chapterNode) handle.outlineRepo.clearAncestorSummaries(chapterNode.id);
```

3e. **chapters.ts: 若有整章重写/覆盖正文的接口**(搜 `chapterFiles.write(` 调用点),同样补一行 `clearAncestorSummaries`。如果没有"整章重写"路径就跳过本步。

- [ ] **Step 4: 跑测确认通过** → 全绿。

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/http/routes/outline.ts packages/server/src/http/routes/chapters.ts packages/server/tests/integration/outline-summary-invalidation.test.ts
git commit -m "fix(outline): invalidate ancestor summaries on edit/rewrite"
```

---

### Task 14: 端到端 — POV 连续性回归测试

**Files:**
- Create: `packages/server/tests/integration/pov-continuity.test.ts`

- [ ] **Step 1: 写测试(可同时为 fail-then-fix demo)**

```ts
import { describe, expect, it } from "vitest";
import { buildChapterWriteMessages } from "../../src/ai/context-builder/book-context.js";
// 模拟书:第 1 章正文"我推开庙门,看见……"(第一人称、过去式)
// 调用 buildChapterWriteMessages(handle, 2, "继续写")
it("第 2 章的 prompt 必含第 1 章原文片段", () => {
  const ctx = buildChapterWriteMessages(handle, 2, "继续写", undefined, [], 400_000);
  const all = ctx.messages.map(m => typeof m.content === "string" ? m.content : "").join("\n");
  expect(all).toContain("我推开庙门");
});
```

- [ ] **Step 2: 跑测**

```bash
pnpm --filter @scribe/server exec vitest run tests/integration/pov-continuity.test.ts
```

预期:此时应已通过(Task 4+8 完成时已生效);如不通过回去查 wiring。

- [ ] **Step 3: 提交**

```bash
git add packages/server/tests/integration/pov-continuity.test.ts
git commit -m "test: pov continuity regression"
```

---

### Task 15: 全套测试 + 类型检查 + 推送

- [ ] **Step 1: 跑 typecheck + 全套测试**

```bash
pnpm --filter @scribe/server run typecheck
pnpm --filter @scribe/server run test
```

预期:全绿。

- [ ] **Step 2: 跑 client 测试(如果 client 有相关测试)**

```bash
pnpm --filter @scribe/client run test 2>&1 | tail -20
```

预期:全绿(无变更则跳过)。

- [ ] **Step 3: 推送(corporate gateway 用 send-pack)**

```bash
git send-pack git@github.com:DECADE0502/Scribe.git codex/generic-record-architecture
```

预期:成功推送。

---

## Self-Review Notes

- **Spec 覆盖**:§3 小/大总结来源去向 → Tasks 3/4/5/10/11/12;§5 顺序 → Task 5;§6 优先级 → Tasks 4/5/6;§7 预算 + §8 [1m] → Tasks 1/8/9;§9 outline 漏接 → Task 7;§10 噪声税 → Task 6;§14 邀请/重写置空 → Task 13;§12 验收 1-10 → 散布在每个 task 的测试。
- **依赖顺序**:Task 1 独立可先做;Task 2 → 3 → 4 → 5 是核心链;Task 7 → 8 → 9 是 wiring 链;Task 10 → 11 → 12 是大总结产线;Task 13 收尾;Task 14 端到端;Task 15 推送。

## Execution Choice

Plan complete and saved to `docs/superpowers/plans/2026-06-23-write-context-memory.md`. Two execution options:

**1. Subagent-Driven (recommended)** — 每个 Task 由新 subagent 跑,我中间审,迭代快,主上下文不爆。

**2. Inline Execution** — 在当前会话里按 task 顺序跑,中途有 checkpoint 你审。

要哪种?
