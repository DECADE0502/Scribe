import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import type { ChapterSummary } from "@scribe/shared";
import { runMigrations } from "../../../../src/db/migrations/runner.js";
import { createBookMetaRepo } from "../../../../src/db/repositories/book-meta.js";
import { createCharactersRepo } from "../../../../src/db/repositories/characters.js";
import { createOutlineRepo } from "../../../../src/db/repositories/outline.js";
import { createForeshadowingRepo } from "../../../../src/db/repositories/foreshadowing.js";
import { createTimelineRepo } from "../../../../src/db/repositories/timeline.js";
import { createGenreSectionsRepo } from "../../../../src/db/repositories/genre-sections.js";
import { createChaptersRepo } from "../../../../src/db/repositories/chapters.js";
import { createConversationsRepo } from "../../../../src/db/repositories/conversations.js";
import { runConversation } from "../../../../src/ai/orchestrator/conversation-orchestrator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let db: any, handle: any, deps: any;

function summary(n: number, oneLiner: string, chars: string[]): ChapterSummary {
  return { chapterNo: n, oneLiner, paragraph: `第${n}章`, keyEvents: [{ event: oneLiner, characters: chars, foreshadowingRefs: [] }], generatedAt: 1, reasoningContent: null };
}

async function collect(it: AsyncIterable<any>): Promise<any[]> {
  const out: any[] = [];
  for await (const ev of it) out.push(ev);
  return out;
}
const textOf = (evs: any[]) => evs.filter(e => e.type === "text_delta").map(e => e.delta).join("");

const okAudit = JSON.stringify({
  verdict: "ok",
  issues: [
    "setting_consistency",
    "character_behavior",
    "pacing",
    "narrative_coherence",
    "foreshadowing",
    "hook_strength",
    "aesthetic_quality",
  ].map((dimension) => ({ dimension, severity: "ok", score: 8, note: "无明显问题" })),
  summary: {
    oneLiner: "第一章重写完成",
    paragraph: "第一章重写后承接原有设定,保留主角出场与基础冲突,叙事更加清楚,场景推进更稳定,后续章节可以继续沿用这一版内容作为上下文。",
    keyEvents: [{ event: "第一章被重写", characters: ["林尘"], foreshadowingRefs: [] }],
  },
  hardFacts: [],
});

function makeWritingModel(text: string): any {
  return {
    specificationVersion: "v1",
    provider: "stub",
    modelId: "stub-write",
    async doGenerate() {
      return {
        text,
        finishReason: "stop",
        usage: { promptTokens: 10, completionTokens: 10 },
        rawCall: { rawPrompt: null, rawSettings: {} },
      };
    },
    async doStream() {
      throw new Error("write model should not stream prose");
    },
  };
}

function intentAnalysisForGenerateOptions(options: any): string | undefined {
  const prompt = (options?.prompt ?? options?.messages ?? []) as Array<{ role?: string; content?: unknown }>;
  const allText = JSON.stringify(prompt);
  const userContent = [...prompt].reverse().find((item) => item.role === "user")?.content;
  const promptText = typeof userContent === "string" ? userContent : JSON.stringify(userContent ?? "");
  if (!allText.includes("chapterCount") || !allText.includes("targetChapter")) return undefined;
  if (promptText.includes("重写") || promptText.includes("改写")) {
    return JSON.stringify({ category: "revise_intent", targetChapter: 1 });
  }
  if (promptText.includes("delete") || promptText.includes("删除")) {
    return JSON.stringify({ category: "delete_intent", targetChapter: 1 });
  }
  if (promptText.includes("审查") || promptText.includes("检查") || promptText.includes("评价")) {
    return JSON.stringify({ category: "query", targetChapter: 1 });
  }
  if (promptText.includes("前三章") || promptText.includes("write 3 chapters")) {
    return JSON.stringify({ category: "writing_intent", chapterCount: 3 });
  }
  if (promptText.includes("write next chapter") || promptText.includes("直接把")) {
    return JSON.stringify({ category: "writing_intent" });
  }
  return JSON.stringify({ category: "chitchat" });
}

function makeAuditAndRecordModel(): any {
  return {
    specificationVersion: "v1",
    provider: "stub",
    modelId: "stub-audit",
    async doGenerate(options: any) {
      const analysis = intentAnalysisForGenerateOptions(options);
      if (analysis) {
        return {
          text: analysis,
          finishReason: "stop",
          usage: { promptTokens: 10, completionTokens: 10 },
          rawCall: { rawPrompt: null, rawSettings: {} },
        };
      }
      return {
        text: okAudit,
        finishReason: "stop",
        usage: { promptTokens: 10, completionTokens: 10 },
        rawCall: { rawPrompt: null, rawSettings: {} },
      };
    },
    async doStream() {
      return {
        stream: new ReadableStream({
          start(ctrl) {
            ctrl.enqueue({
              type: "finish",
              finishReason: "stop",
              usage: { promptTokens: 1, completionTokens: 0 },
            });
            ctrl.close();
          },
        }),
        rawCall: { rawPrompt: null, rawSettings: {} },
      };
    },
  };
}

function makeFailingAuditModel(): any {
  return {
    specificationVersion: "v1",
    provider: "stub",
    modelId: "stub-audit-fail",
    async doGenerate(options: any) {
      const analysis = intentAnalysisForGenerateOptions(options);
      if (analysis) {
        return {
          text: analysis,
          finishReason: "stop",
          usage: { promptTokens: 10, completionTokens: 10 },
          rawCall: { rawPrompt: null, rawSettings: {} },
        };
      }
      throw new Error("audit unavailable after write");
    },
    async doStream() {
      throw new Error("record model should not be reached");
    },
  };
}

beforeEach(() => {
  db = new Database(":memory:");
  const initSql = fs.readFileSync(path.join(__dirname, "../../../../src/db/migrations/workspace/001_init.sql"), "utf-8");
  runMigrations(db, [{ name: "001_init.sql", sql: initSql }]);
  const chaptersRepo = createChaptersRepo(db);
  const charactersRepo = createCharactersRepo(db);
  charactersRepo.create({ name: "林尘", role: "protagonist", baseData: {}, currentState: {} });
  for (let n = 1; n <= 5; n++) {
    chaptersRepo.saveVersion({ chapterNo: n, source: "ai_write", contentMd: `第${n}章正文` });
  }
  chaptersRepo.saveSummary(summary(1, "林尘觉醒", ["林尘"]));
  chaptersRepo.saveSummary(summary(2, "青玄登场", ["林尘"]));
  chaptersRepo.saveSummary(summary(3, "矿洞", ["林尘"]));
  chaptersRepo.saveSummary(summary(4, "夜查", ["林尘"]));
  chaptersRepo.saveSummary(summary(5, "出逃", ["林尘"]));
  handle = {
    bookId: "b1",
    bookMetaRepo: createBookMetaRepo(db),
    charactersRepo,
    outlineRepo: createOutlineRepo(db),
    foreshadowingRepo: createForeshadowingRepo(db),
    timelineRepo: createTimelineRepo(db),
    genreSectionsRepo: createGenreSectionsRepo(db),
    chaptersRepo,
    conversationsRepo: createConversationsRepo(db),
    chapterFiles: {
      files: new Map<number, any>(),
      save(input: any) {
        this.files.set(input.chapterNo, {
          chapterNo: input.chapterNo,
          title: input.title,
          content: input.content,
          versionNo: input.versionNo,
          wordCount: input.content.length,
          updatedAt: Date.now(),
        });
      },
      read(no: number) {
        return this.files.get(no);
      },
      list() {
        return [...this.files.values()].sort((a, b) => a.chapterNo - b.chapterNo);
      },
    },
    rulesMdPath: "__none__.md",
  };
  for (let n = 1; n <= 5; n++) {
    handle.chapterFiles.save({ chapterNo: n, title: `第${n}章`, content: `第${n}章正文`, versionNo: 1 });
  }
  deps = { handle, model: {} as any, auditModel: {} as any, auditModelId: "stub" };
});

afterEach(() => { try { db.close(); } catch {} });

describe("runConversation 斜杠命令路由(§7.4)", () => {
  it("/help 列出所有命令,先发 command_explicit 意图", async () => {
    const evs = await collect(runConversation(deps, { message: "/help" }));
    const intent = evs.find(e => e.type === "intent");
    expect(intent.category).toBe("command_explicit");
    expect(intent.command).toBe("help");
    expect(textOf(evs)).toContain("/write");
    expect(evs.at(-1).type).toBe("done");
  });

  it("/note 落库为便签", async () => {
    const evs = await collect(runConversation(deps, { message: "/note 记得给主角加个师父" }));
    expect(textOf(evs)).toContain("已记下便签");
    const notes = handle.conversationsRepo.listLatest(10).filter((m: any) => m.metadata?.kind === "note");
    expect(notes).toHaveLength(1);
    expect(notes[0].content).toContain("师父");
  });

  it("/recall 按关键词检索历史章节", async () => {
    const evs = await collect(runConversation(deps, { message: "/recall 林尘" }));
    const text = textOf(evs);
    expect(text).toContain("相关章节");
    expect(text).toMatch(/第1章|第2章/);
  });

  it("/recall 检索全书(含最近 3 章,短篇也能搜到)", async () => {
    // 5 章里 林尘 贯穿全书;修复前 -3 cutoff 会漏掉最近的第3/4/5章
    const evs = await collect(runConversation(deps, { message: "/recall 林尘" }));
    const text = textOf(evs);
    expect(text).toContain("第5章"); // 最近章不再被排除
    expect(text).toContain("第3章");
    expect(text).toContain("找到 5 个相关章节");
  });

  it("/revise 引导去编辑器选段", async () => {
    const evs = await collect(runConversation(deps, { message: "/revise" }));
    expect(textOf(evs)).toContain("编辑器");
  });

  // 以下测试测的是旧意图分类路径（自然语言→analyzeIntent→写章）。
  // 新架构下自然语言全走 agenticChat（AI 自己调 trigger 工具），
  // 斜杠命令仍走快路径。这些测试需要用 mock 模拟 AI 调 trigger 工具来重写。
  it.skip("自然语言重写第一章时落到第 1 章,不会误写最新章 (旧意图分类路径，待重写)", async () => {
    deps.model = makeWritingModel("第一章重写正文");
    deps.auditModel = makeAuditAndRecordModel();

    const evs = await collect(runConversation(deps, {
      message: "重写第一章,加强开场",
      executionMode: "trusted_auto",
    }));

    expect(evs.some(e => e.type === "error")).toBe(false);
    expect(evs.some(e => e.type === "text_delta")).toBe(false);
    const chapter1Versions = handle.chaptersRepo.listVersions(1);
    expect(chapter1Versions[0].source).toBe("ai_rewrite");
    expect(chapter1Versions[0].contentMd).toBe("第一章重写正文");
    expect(handle.chaptersRepo.listVersions(5)[0].source).toBe("ai_write");
  });

  it.skip("routes natural language multi-chapter writing through the write flow without chat prose (旧意图分类路径，待重写)", async () => {
    deps.model = makeWritingModel("new chapter body");
    deps.auditModel = makeAuditAndRecordModel();

    const evs = await collect(runConversation(deps, {
      message: "可以啊，现在直接把前三章都写了",
      executionMode: "trusted_auto",
    }));

    expect(evs.find(e => e.type === "intent")?.category).toBe("writing_intent");
    expect(evs.some(e => e.type === "text_delta")).toBe(false);
    const writes = evs.filter(e => e.type === "tool_call_start" && e.toolName === "chapter_write");
    expect(writes.map(e => e.args.chapterNo)).toEqual([6, 7, 8]);
    expect(handle.chaptersRepo.listVersions(6)[0].contentMd).toBe("new chapter body");
    expect(handle.chaptersRepo.listVersions(7)[0].contentMd).toBe("new chapter body");
    expect(handle.chaptersRepo.listVersions(8)[0].contentMd).toBe("new chapter body");
  });

  it.skip("plans natural language writing in plan_only mode without writing chapters (旧意图分类路径，待重写)", async () => {
    deps.model = makeWritingModel("planned body should not write");
    deps.auditModel = makeAuditAndRecordModel();
    const beforeMax = handle.chaptersRepo.maxChapterNo();

    const evs = await collect(runConversation(deps, {
      message: "write next chapter",
      executionMode: "plan_only",
    }));

    expect(evs.find(e => e.type === "intent")?.category).toBe("writing_intent");
    const plan = evs.find(e => e.type === "execution_plan");
    expect(plan?.steps.map((step: any) => [step.actionType, step.argsSummary])).toEqual([
      ["chapter_write", `chapterNo=${beforeMax + 1}`],
      ["record_chapter_state", `chapterNo=${beforeMax + 1}`],
    ]);
    const confirmation = evs.find(e => e.type === "confirmation_required");
    expect(confirmation?.taskId).toBe(plan?.taskId);
    expect(evs.some(e => e.type === "tool_call_start" && e.toolName === "chapter_write")).toBe(false);
    expect(handle.chaptersRepo.maxChapterNo()).toBe(beforeMax);
    expect(evs.at(-1).type).toBe("done");
  });

  it.skip("traces trusted_auto natural language writing and emits a passing acceptance report (旧意图分类路径，待重写)", async () => {
    deps.model = makeWritingModel("trusted auto chapter body");
    deps.auditModel = makeAuditAndRecordModel();

    const evs = await collect(runConversation(deps, {
      message: "write next chapter",
      executionMode: "trusted_auto",
    }));

    const plan = evs.find(e => e.type === "execution_plan");
    expect(plan?.policy.effectiveMode).toBe("auto");
    const succeededWrite = evs.find(
      e => e.type === "execution_step"
        && e.step.toolName === "chapter_write"
        && e.step.status === "succeeded",
    );
    expect(succeededWrite?.step.resultSummary).toContain("Chapter 6");
    expect(succeededWrite?.step.verification).toEqual({
      method: "read_back",
      passed: true,
      detail: "Chapter 6 read back after write.",
    });
    const succeededRecord = evs.find(
      e => e.type === "execution_step"
        && e.step.toolName === "record_chapter_state"
        && e.step.status === "succeeded",
    );
    expect(succeededRecord?.step.resultSummary).toContain("Chapter 6 state recorded");
    expect(succeededRecord?.step.verification).toEqual({
      method: "state_compare",
      passed: true,
      detail: "Chapter 6 state recording completed.",
    });
    const report = evs.find(e => e.type === "acceptance_report")?.report;
    expect(report?.verdict).toBe("pass");
    expect(handle.chaptersRepo.listVersions(6)[0].contentMd).toBe("trusted auto chapter body");
    expect(evs.at(-1).type).toBe("done");
  });

  it.skip("finishes with repairable acceptance when post-write audit fails after read-back succeeds (旧意图分类路径，待重写)", async () => {
    deps.model = makeWritingModel("durably persisted body");
    deps.auditModel = makeFailingAuditModel();

    const evs = await collect(runConversation(deps, {
      message: "write next chapter",
      executionMode: "trusted_auto",
    }));

    expect(handle.chaptersRepo.listVersions(6)[0].contentMd).toBe("durably persisted body");
    expect(evs.some(e => e.type === "text_delta")).toBe(false);
    expect(evs.some(e => e.type === "error")).toBe(false);
    const succeededWrite = evs.find(
      e => e.type === "execution_step"
        && e.step.toolName === "chapter_write"
        && e.step.status === "succeeded",
    );
    expect(succeededWrite?.step.verification).toEqual({
      method: "read_back",
      passed: true,
      detail: "Chapter 6 read back after write.",
    });
    const failedRecord = evs.find(
      e => e.type === "execution_step"
        && e.step.toolName === "record_chapter_state"
        && e.step.status === "failed",
    );
    expect(failedRecord?.step.verification?.passed).toBe(false);
    const report = evs.find(e => e.type === "acceptance_report")?.report;
    expect(report?.verdict).toBe("repairable");
    expect(evs.at(-1).type).toBe("done");
  });

  it.skip("stops trusted_auto multi-chapter writing after a chapter write verification failure (旧意图分类路径，待重写)", async () => {
    deps.model = makeWritingModel("");
    deps.auditModel = makeAuditAndRecordModel();

    const evs = await collect(runConversation(deps, {
      message: "write 3 chapters",
      executionMode: "trusted_auto",
    }));

    const writeStarts = evs.filter(e => e.type === "tool_call_start" && e.toolName === "chapter_write");
    expect(writeStarts.map(e => e.args.chapterNo)).toEqual([6]);
    expect(handle.chaptersRepo.listVersions(6)).toHaveLength(0);
    expect(handle.chaptersRepo.listVersions(7)).toHaveLength(0);
    expect(handle.chaptersRepo.listVersions(8)).toHaveLength(0);
    const failedWrite = evs.find(
      e => e.type === "execution_step"
        && e.step.toolName === "chapter_write"
        && e.step.status === "failed",
    );
    expect(failedWrite?.step.verification).toEqual({
      method: "read_back",
      passed: false,
      detail: "Chapter 6 was not readable after write.",
    });
    const report = evs.find(e => e.type === "acceptance_report")?.report;
    expect(report?.verdict).toBe("fail");
    expect(evs.at(-1).type).toBe("done");
  });
});
