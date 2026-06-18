import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations/runner.js";
import { createChaptersRepo } from "../../src/db/repositories/chapters.js";
import { createChapterFiles } from "../../src/fs/chapter-files.js";
import { writeWithAudit } from "../../src/ai/orchestrator/write-with-audit.js";
import { makeStubLanguageModel } from "../fixtures/mock-llm.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const okAudit = {
  verdict: "ok",
  issues: Array.from({ length: 7 }, (_, i) => ({
    dimension: [
      "setting_consistency",
      "character_behavior",
      "pacing",
      "narrative_coherence",
      "foreshadowing",
      "hook_strength",
      "aesthetic_quality",
    ][i],
    severity: "ok",
    score: 8,
    note: "ok",
  })),
  summary: {
    oneLiner: "测试章节",
    paragraph: "测试段落".repeat(20),
    keyEvents: [
      { event: "事件A", characters: ["主角"], foreshadowingRefs: [] },
    ],
  },
};

const criticalAudit = {
  ...okAudit,
  verdict: "critical",
  issues: [
    {
      dimension: "character_behavior",
      severity: "critical",
      score: 3,
      note: "OOC",
      excerpt: "突然爆发",
    },
    ...okAudit.issues.slice(1),
  ],
};

function makeAuditModel(text: string): any {
  return {
    specificationVersion: "v1",
    provider: "stub",
    modelId: "stub-audit",
    async doGenerate() {
      return {
        text,
        finishReason: "stop",
        usage: { promptTokens: 100, completionTokens: 200 },
        rawCall: { rawPrompt: null, rawSettings: {} },
      };
    },
    async doStream() {
      throw new Error("not used");
    },
  };
}

function makeSequencedAuditModel(texts: string[]): any {
  let i = 0;
  return {
    specificationVersion: "v1",
    provider: "stub",
    modelId: "stub-audit",
    async doGenerate() {
      const t = texts[Math.min(i, texts.length - 1)];
      i++;
      return {
        text: t,
        finishReason: "stop",
        usage: { promptTokens: 100, completionTokens: 200 },
        rawCall: { rawPrompt: null, rawSettings: {} },
      };
    },
    async doStream() {
      throw new Error("not used");
    },
  };
}

function makeCapturingAuditModel(text: string): any {
  const prompts: string[] = [];
  return {
    prompts,
    specificationVersion: "v1",
    provider: "stub",
    modelId: "stub-audit",
    async doGenerate(options: { prompt?: string; messages?: Array<{ content: unknown }> }) {
      prompts.push(
        options.prompt ??
        options.messages?.map((message) => String(message.content)).join("\n") ??
        "",
      );
      return {
        text,
        finishReason: "stop",
        usage: { promptTokens: 100, completionTokens: 200 },
        rawCall: { rawPrompt: null, rawSettings: {} },
      };
    },
    async doStream() {
      throw new Error("not used");
    },
  };
}

function makeSequencedStreamModel(chunksByCall: string[][]): any {
  let callCount = 0;
  return {
    specificationVersion: "v1",
    provider: "stub",
    modelId: "stub-sequenced-stream",
    async doGenerate() {
      throw new Error("not used");
    },
    async doStream() {
      const chunks = chunksByCall[Math.min(callCount, chunksByCall.length - 1)] ?? [];
      callCount += 1;
      return {
        stream: new ReadableStream({
          start(ctrl) {
            for (const ch of chunks) {
              ctrl.enqueue({ type: "text-delta", textDelta: ch });
            }
            ctrl.enqueue({
              type: "finish",
              finishReason: "stop",
              usage: { promptTokens: 5, completionTokens: chunks.length },
            });
            ctrl.close();
          },
        }),
        rawCall: { rawPrompt: null, rawSettings: {} },
      };
    },
  };
}

let tmp: string;
let db: any;
let chaptersRepo: any;
let chapterFiles: any;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scribe-wta-"));
  db = new Database(":memory:");
  const initSql = fs.readFileSync(
    path.join(__dirname, "../../src/db/migrations/workspace/001_init.sql"),
    "utf-8",
  );
  runMigrations(db, [{ name: "001_init.sql", sql: initSql }]);
  chaptersRepo = createChaptersRepo(db);
  chapterFiles = createChapterFiles(path.join(tmp, "chapters"));
});

afterEach(() => {
  try {
    db.close();
  } catch {
    /* ignore */
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function consume<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of iter) out.push(v);
  return out;
}

describe("writeWithAudit", () => {
  it("verdict=ok:写一章 → 审 → 落盘 1 version + audit + summary", async () => {
    const start = performance.now();
    const evs = await consume(
      writeWithAudit(
        {
          model: makeStubLanguageModel({ chunks: ["黎明", "时,雾气"] }),
          chaptersRepo,
          chapterFiles,
          auditModel: makeAuditModel(JSON.stringify(okAudit)),
          auditModelId: "deepseek-v4-flash",
        },
        { chapterNo: 1, userIntent: "测试" },
      ),
    );
    const elapsed = performance.now() - start;
    // 软性能断言:全流程应在 2s 内完成(纯桩 LLM,无网络)
    expect(elapsed).toBeLessThan(2000);

    expect(evs.find((e: any) => e.type === "done")).toBeDefined();
    const audit = evs.find(
      (e: any) => e.type === "tool_call_end" && e.toolName === "chapter_audit",
    );
    expect(audit).toBeDefined();
    expect((audit as any).result.verdict).toBe("ok");

    expect(fs.existsSync(path.join(tmp, "chapters", "0001.md"))).toBe(true);
    expect(chaptersRepo.listVersions(1)).toHaveLength(1);
    const dbAudit = chaptersRepo.getAudit(1);
    expect(dbAudit?.verdict).toBe("ok");
    const dbSummary = chaptersRepo.getSummary(1);
    expect(dbSummary?.oneLiner).toBe("测试章节");
  });

  it("verdict=critical 触发 repair,再审通过 → 2 version,最终 audit=ok", async () => {
    const evs = await consume(
      writeWithAudit(
        {
          model: makeStubLanguageModel({ chunks: ["原文"] }),
          chaptersRepo,
          chapterFiles,
          auditModel: makeSequencedAuditModel([
            JSON.stringify(criticalAudit),
            JSON.stringify(okAudit),
          ]),
          auditModelId: "deepseek-v4-flash",
        },
        { chapterNo: 1, userIntent: "测试" },
      ),
    );
    expect(evs.find((e: any) => e.type === "done")).toBeDefined();
    expect(
      evs.find(
        (e: any) =>
          e.type === "tool_call_start" && e.toolName === "chapter_repair",
      ),
    ).toBeDefined();
    // chapter_repair 的 start/end 必须严格成对
    const repairEnds = evs.filter(
      (e: any) =>
        e.type === "tool_call_end" && e.toolName === "chapter_repair",
    );
    expect(repairEnds).toHaveLength(1);
    expect((repairEnds[0] as any).result.success).toBe(true);
    const reAudit = evs.find(
      (e: any) =>
        e.type === "tool_call_end" && e.toolName === "chapter_repair_audit",
    );
    expect((reAudit as any).result.verdict).toBe("ok");

    const versions = chaptersRepo.listVersions(1);
    expect(versions).toHaveLength(2);
    expect(versions.map((v: any) => v.source).sort()).toEqual([
      "ai_rewrite",
      "ai_write",
    ]);
    expect(chaptersRepo.getAudit(1)?.verdict).toBe("ok");
  });

  it("verdict=ok 但质量门禁失败时触发 repair 并再审", async () => {
    const evs = await consume(
      writeWithAudit(
        {
          model: makeSequencedStreamModel([
            ["状态栏：HP 10/10。正文继续。"],
            ["状态栏：HP 10/10，契约 1。正文继续。"],
          ]),
          chaptersRepo,
          chapterFiles,
          auditModel: makeSequencedAuditModel([
            JSON.stringify(okAudit),
            JSON.stringify(okAudit),
          ]),
          auditModelId: "deepseek-v4-flash",
        },
        {
          chapterNo: 1,
          userIntent: "测试",
          qualityGate: ({ chapterContent }) =>
            chapterContent.includes("契约")
              ? []
              : [{
                dimension: "required_output_section",
                severity: "critical",
                note: "状态栏 missing required terms: 契约",
              }],
        },
      ),
    );

    expect(evs.find((e: any) => e.type === "done")).toBeDefined();
    const repairStart = evs.find(
      (e: any) => e.type === "tool_call_start" && e.toolName === "chapter_repair",
    );
    expect(repairStart).toBeDefined();
    expect((repairStart as any).args.reason).toBe("quality gate failed");
    const reAudit = evs.find(
      (e: any) => e.type === "tool_call_end" && e.toolName === "chapter_repair_audit",
    );
    expect((reAudit as any).result.verdict).toBe("ok");
    expect((reAudit as any).result.stillCritical).toBe(false);

    expect(chaptersRepo.listVersions(1)).toHaveLength(2);
    const md = fs.readFileSync(path.join(tmp, "chapters", "0001.md"), "utf-8");
    expect(md).toContain("契约 1");
    expect(chaptersRepo.getAudit(1)?.verdict).toBe("ok");
  });

  it("repairs when generic quality gate returns hard-fact issues even if audit is ok", async () => {
    const evs = await consume(
      writeWithAudit(
        {
          model: makeSequencedStreamModel([
            ["飞船燃料显示为 72%。"],
            ["飞船燃料仍为 18%，舰桥没有进行任何补给。"],
          ]),
          chaptersRepo,
          chapterFiles,
          auditModel: makeSequencedAuditModel([
            JSON.stringify(okAudit),
            JSON.stringify(okAudit),
          ]),
          auditModelId: "deepseek-v4-flash",
        },
        {
          chapterNo: 12,
          userIntent: "continue",
          ctx: { premise: "sci-fi ship story" },
          auditCtx: { premise: "sci-fi ship story" },
          qualityGate: ({ stage }) => stage === "draft"
            ? [{
              dimension: "continuity",
              severity: "critical",
              note: "ship.fuel changed from 18 percent to 72 percent without an explicit in-chapter cause",
              excerpt: "prior: ship fuel 18%\ncurrent: ship fuel 72%",
            }]
            : [],
        },
      ),
    );

    expect(evs).toContainEqual(expect.objectContaining({
      type: "tool_call_start",
      toolName: "chapter_repair",
    }));
    expect(evs).toContainEqual(expect.objectContaining({
      type: "tool_call_end",
      toolName: "chapter_repair_audit",
    }));
    expect(evs.at(-1)).toEqual({ type: "done" });
    const md = fs.readFileSync(path.join(tmp, "chapters", "0012.md"), "utf-8");
    expect(md).toContain("18%");
  });

  it("verdict=critical,enableRepair=false:保留 critical,只 1 version", async () => {
    const evs = await consume(
      writeWithAudit(
        {
          model: makeStubLanguageModel({ chunks: ["原文"] }),
          chaptersRepo,
          chapterFiles,
          auditModel: makeAuditModel(JSON.stringify(criticalAudit)),
          auditModelId: "deepseek-v4-flash",
        },
        { chapterNo: 1, userIntent: "测试", enableRepair: false },
      ),
    );
    expect(evs.find((e: any) => e.type === "done")).toBeDefined();
    expect(
      evs.find(
        (e: any) =>
          e.type === "tool_call_start" && e.toolName === "chapter_repair",
      ),
    ).toBeUndefined();
    expect(chaptersRepo.listVersions(1)).toHaveLength(1);
    expect(chaptersRepo.getAudit(1)?.verdict).toBe("critical");
  });

  it("persists audit warnings into reader issues when repo is provided", async () => {
    const created: unknown[] = [];
    const warningAudit = {
      ...okAudit,
      verdict: "warning",
      issues: [
        {
          dimension: "setting_consistency",
          severity: "warning",
          score: 5,
          note: "status panel rule drifted",
          excerpt: "status panel",
        },
        ...okAudit.issues.slice(1),
      ],
    };

    await consume(
      writeWithAudit(
        {
          model: makeStubLanguageModel({ chunks: ["chapter text"] }),
          chaptersRepo,
          chapterFiles,
          auditModel: makeAuditModel(JSON.stringify(warningAudit)),
          auditModelId: "deepseek-v4-flash",
          readerIssuesRepo: {
            create(input: unknown) {
              created.push(input);
              return { id: "issue-1" };
            },
          },
        },
        { chapterNo: 1, userIntent: "test", enableRepair: false },
      ),
    );

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      chapterNo: 1,
      type: "setting_consistency",
      severity: "warning",
      note: "status panel rule drifted",
      status: "open",
    });
  });

  it("audits sanitized chapter text after removing non-novel meta blocks", async () => {
    const auditModel = makeCapturingAuditModel(JSON.stringify(okAudit));

    await consume(
      writeWithAudit(
        {
          model: makeStubLanguageModel({
            chunks: [
              "姝ｆ枃绗竴娈点€?",
              "\n<progress>\nPG.1\n</progress>\n",
              "姝ｆ枃绗簩娈点€?",
            ],
          }),
          chaptersRepo,
          chapterFiles,
          auditModel,
          auditModelId: "deepseek-v4-flash",
        },
        { chapterNo: 1, userIntent: "娴嬭瘯" },
      ),
    );

    expect(auditModel.prompts[0]).not.toContain("<progress>");
    expect(auditModel.prompts[0]).not.toContain("PG.1");
    const md = fs.readFileSync(path.join(tmp, "chapters", "0001.md"), "utf-8");
    expect(md).not.toContain("<progress>");
    expect(md).not.toContain("PG.1");
  });

  it("写章节失败时不进 audit,不落盘", async () => {
    const evs = await consume(
      writeWithAudit(
        {
          model: makeStubLanguageModel({
            chunks: ["x"],
            throwOn: "stream",
          }),
          chaptersRepo,
          chapterFiles,
          auditModel: makeAuditModel(JSON.stringify(okAudit)),
          auditModelId: "deepseek-v4-flash",
        },
        { chapterNo: 1, userIntent: "测试" },
      ),
    );
    expect(evs.some((e: any) => e.type === "error")).toBe(true);
    expect(
      evs.find(
        (e: any) =>
          e.type === "tool_call_end" && e.toolName === "chapter_audit",
      ),
    ).toBeUndefined();
    expect(chaptersRepo.listVersions(1)).toHaveLength(0);
    expect(chaptersRepo.getAudit(1)).toBeUndefined();
  });

  it("audit 模型抛错时,write 已落盘但 audit 失败 → SSE 含 error", async () => {
    const evs = await consume(
      writeWithAudit(
        {
          model: makeStubLanguageModel({ chunks: ["写好的正文"] }),
          chaptersRepo,
          chapterFiles,
          auditModel: makeAuditModel("非 JSON,parse 必失败"),
          auditModelId: "deepseek-v4-flash",
        },
        { chapterNo: 1, userIntent: "测试" },
      ),
    );
    expect(
      evs.some(
        (e: any) =>
          e.type === "error" &&
          e.errorClass === "audit_failed" &&
          (e as any).message?.includes("审查失败"),
      ),
    ).toBe(true);
    // 写章节本身已成功落盘
    expect(chaptersRepo.listVersions(1)).toHaveLength(1);
    // audit 失败时不应有 audit 行
    expect(chaptersRepo.getAudit(1)).toBeUndefined();
  });

  it("LLM 返回空内容时:不发 done,而是 yield error empty_response 终结流", async () => {
    const evs = await consume(
      writeWithAudit(
        {
          model: makeStubLanguageModel({ chunks: ["", "  "] }),
          chaptersRepo,
          chapterFiles,
          auditModel: makeAuditModel(JSON.stringify(okAudit)),
          auditModelId: "deepseek-v4-flash",
        },
        { chapterNo: 1, userIntent: "测试" },
      ),
    );
    // 流必须以终结事件收尾(error 或 done),不能静默结束
    expect(evs.find((e: any) => e.type === "done")).toBeUndefined();
    const err = evs.find(
      (e: any) => e.type === "error" && e.errorClass === "empty_response",
    );
    expect(err).toBeDefined();
    // 既不该进入 audit 阶段,也不该有任何落盘
    expect(
      evs.find(
        (e: any) =>
          e.type === "tool_call_end" && e.toolName === "chapter_audit",
      ),
    ).toBeUndefined();
    expect(chaptersRepo.listVersions(1)).toHaveLength(0);
    expect(chaptersRepo.getAudit(1)).toBeUndefined();
    expect(fs.existsSync(path.join(tmp, "chapters", "0001.md"))).toBe(false);
  });

  it("用户在 write 阶段取消(abortSignal):不进入 audit / 不落盘", async () => {
    const ac = new AbortController();
    let auditCalled = false;
    const auditModel: any = {
      specificationVersion: "v1",
      provider: "stub",
      modelId: "stub-audit",
      async doGenerate() {
        auditCalled = true;
        return {
          text: JSON.stringify(okAudit),
          finishReason: "stop",
          usage: { promptTokens: 100, completionTokens: 200 },
          rawCall: { rawPrompt: null, rawSettings: {} },
        };
      },
      async doStream() {
        throw new Error("not used");
      },
    };
    // write 阶段直接抛错(模拟取消)
    ac.abort();
    const evs = await consume(
      writeWithAudit(
        {
          model: makeStubLanguageModel({
            chunks: ["x"],
            throwOn: "stream",
          }),
          chaptersRepo,
          chapterFiles,
          auditModel,
          auditModelId: "deepseek-v4-flash",
        },
        { chapterNo: 1, userIntent: "测试", abortSignal: ac.signal },
      ),
    );
    expect(evs.some((e: any) => e.type === "error")).toBe(true);
    expect(auditCalled).toBe(false);
    expect(chaptersRepo.listVersions(1)).toHaveLength(0);
  });

  it("repair 后再审仍 critical:stillCritical=true,audit 行被覆盖", async () => {
    const evs = await consume(
      writeWithAudit(
        {
          model: makeStubLanguageModel({ chunks: ["原文", "段二"] }),
          chaptersRepo,
          chapterFiles,
          auditModel: makeSequencedAuditModel([
            JSON.stringify(criticalAudit),
            JSON.stringify(criticalAudit),
          ]),
          auditModelId: "deepseek-v4-flash",
        },
        { chapterNo: 1, userIntent: "测试" },
      ),
    );
    // 流仍然以 done 收尾(repair 后再审失败不算流错误)
    expect(evs.find((e: any) => e.type === "done")).toBeDefined();
    const reAudit = evs.find(
      (e: any) =>
        e.type === "tool_call_end" && e.toolName === "chapter_repair_audit",
    );
    expect(reAudit).toBeDefined();
    expect((reAudit as any).result.verdict).toBe("critical");
    expect((reAudit as any).result.stillCritical).toBe(true);
    // chapter_repair 的 start/end 必须严格成对
    const repairEnds = evs.filter(
      (e: any) =>
        e.type === "tool_call_end" && e.toolName === "chapter_repair",
    );
    expect(repairEnds).toHaveLength(1);
    expect((repairEnds[0] as any).result.success).toBe(true);
    // 写 + 修复各 1 行 version,audit 行被再审覆盖,verdict 仍为 critical
    expect(chaptersRepo.listVersions(1)).toHaveLength(2);
    expect(chaptersRepo.getAudit(1)?.verdict).toBe("critical");
  });

  it("repair 阶段 LLM 抛错:初审落盘保留,流以 error 终结", async () => {
    // write 用正常模型,repair 阶段(同一个 model)第二次 doStream 抛错。
    // 用一个分阶段模型:第一次成功输出,第二次抛错。
    let callCount = 0;
    const flakyModel: any = {
      specificationVersion: "v1",
      provider: "stub",
      modelId: "flaky",
      async doGenerate() {
        throw new Error("not used");
      },
      async doStream() {
        callCount++;
        if (callCount === 1) {
          return {
            stream: new ReadableStream({
              start(ctrl) {
                ctrl.enqueue({ type: "text-delta", textDelta: "原文段落" });
                ctrl.enqueue({
                  type: "finish",
                  finishReason: "stop",
                  usage: { promptTokens: 5, completionTokens: 4 },
                });
                ctrl.close();
              },
            }),
            rawCall: { rawPrompt: null, rawSettings: {} },
          };
        }
        return {
          stream: new ReadableStream({
            start(ctrl) {
              ctrl.error(new Error("repair stream boom"));
            },
          }),
          rawCall: { rawPrompt: null, rawSettings: {} },
        };
      },
    };
    const evs = await consume(
      writeWithAudit(
        {
          model: flakyModel,
          chaptersRepo,
          chapterFiles,
          auditModel: makeAuditModel(JSON.stringify(criticalAudit)),
          auditModelId: "deepseek-v4-flash",
        },
        { chapterNo: 1, userIntent: "测试" },
      ),
    );
    // 流以 error 终结(replace done,符合 B-3-002)
    expect(evs.find((e: any) => e.type === "done")).toBeUndefined();
    expect(evs.some((e: any) => e.type === "error")).toBe(true);
    // chapter_repair 的 start/end 必须严格成对(repair 流抛错路径)
    expect(
      evs.filter(
        (e: any) =>
          e.type === "tool_call_start" && e.toolName === "chapter_repair",
      ),
    ).toHaveLength(1);
    const repairEnds = evs.filter(
      (e: any) =>
        e.type === "tool_call_end" && e.toolName === "chapter_repair",
    );
    expect(repairEnds).toHaveLength(1);
    expect((repairEnds[0] as any).result.success).toBe(false);
    expect((repairEnds[0] as any).result.reason).toBe("repair_stream_error");
    // 初审已落盘,且 audit 行保留
    expect(chaptersRepo.listVersions(1)).toHaveLength(1);
    expect(chaptersRepo.listVersions(1)[0].source).toBe("ai_write");
    expect(chaptersRepo.getAudit(1)?.verdict).toBe("critical");
  });

  it("repair 后再审失败 → SSE 含 error,初审 critical 保留在 audits 表", async () => {
    const evs = await consume(
      writeWithAudit(
        {
          model: makeStubLanguageModel({ chunks: ["原文", "段二"] }),
          chaptersRepo,
          chapterFiles,
          auditModel: makeSequencedAuditModel([
            JSON.stringify(criticalAudit), // 初审 critical
            "非 JSON,二次 audit 必失败", // 再审 parse error
          ]),
          auditModelId: "deepseek-v4-flash",
        },
        { chapterNo: 1, userIntent: "测试" },
      ),
    );

    // 流以 error 收尾
    const errs = evs.filter((e: any) => e.type === "error");
    expect(errs).toHaveLength(1);
    expect((errs[0] as any).errorClass).toBe("repair_audit_failed");
    expect((errs[0] as any).message).toContain("修复后再审失败");

    // chapter_repair start/end 必须严格成对
    const repairStarts = evs.filter(
      (e: any) =>
        e.type === "tool_call_start" && e.toolName === "chapter_repair",
    );
    expect(repairStarts).toHaveLength(1);
    const repairEnds = evs.filter(
      (e: any) =>
        e.type === "tool_call_end" && e.toolName === "chapter_repair",
    );
    expect(repairEnds).toHaveLength(1);
    // repair 流本身已成功(只是再审解析失败),success=true
    expect((repairEnds[0] as any).result.success).toBe(true);
    expect((repairEnds[0] as any).result.reason).toBe(
      "repair_done_but_reaudit_failed",
    );

    // chapter_versions 应有 2 条:write + rewrite(后者来自 repair 本身落盘成功)
    expect(chaptersRepo.listVersions(1)).toHaveLength(2);
    expect(
      chaptersRepo.listVersions(1).map((v: any) => v.source).sort(),
    ).toEqual(["ai_rewrite", "ai_write"]);

    // audit 表保留初审的 critical(再审失败前 persistAuditResult 没被调用)
    expect(chaptersRepo.getAudit(1)?.verdict).toBe("critical");

    // 不应有 chapter_repair_audit 的 end(因为再审抛错前没机会发)
    expect(
      evs.find(
        (e: any) =>
          e.type === "tool_call_end" &&
          e.toolName === "chapter_repair_audit",
      ),
    ).toBeUndefined();

    // 流不应 yield done
    expect(evs.find((e: any) => e.type === "done")).toBeUndefined();
  });
});
