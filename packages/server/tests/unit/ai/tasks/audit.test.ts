import { describe, expect, it } from "vitest";
import { auditTask } from "../../../../src/ai/tasks/audit.js";

// 真实 readerIssuesRepo (packages/server/src/db/repositories/reader-issues.ts) 的方法叫 `create()`,
// 接收 NewReaderIssueInput = { chapterNo, type, severity, note, evidence?, suggestedAction?, status? }。
// 计划草稿用的是 `add({area, message, source, createdAt})` —— 字段名与实际不符,
// 这里按真实签名重写 rig 和断言,与其他 task 测试(chapters/onboard)保持同套路。
function rig() {
  const issues: any[] = [];
  return {
    issues,
    handle: {
      workspaceDb: { transaction: (fn: () => void) => () => fn() },
      charactersRepo: {
        list: () => [
          { name: "林尘", role: "protagonist", currentState: { location: "山顶" } },
        ],
      },
      outlineRepo: { listAll: () => [{ title: "第一卷", level: "volume" }] },
      worldbookRepo: { list: () => [{ title: "废土", content: "..." }] },
      chaptersRepo: {
        listSummaries: () => [
          { chapterNo: 1, oneLiner: "开局", paragraph: "第一章总结" },
        ],
      },
      chapterFiles: { read: () => ({ content: "第 1 章内容" }) },
      readerIssuesRepo: { create: (i: any) => { issues.push(i); return { ...i, id: `r${issues.length}` }; } },
    } as any,
  };
}

describe("auditTask", () => {
  it("parse 拿到 issues 列表,apply 全部落 reader_issues", async () => {
    const r = rig();
    const ctx = {
      handle: r.handle, writeModel: {} as any, auditModel: {} as any,
      request: {
        message: "全量审查", source: "asset_audit" as const,
        target: { auditScope: { assets: ["all"], mode: "report_only" } },
      },
    } as any;
    const task = auditTask.withDeps?.({
      runAudit: async () => ({
        issues: [
          {
            chapterNo: 1,
            type: "character_behavior" as const,
            severity: "warning" as const,
            note: "林尘状态与第 1 章不一致",
            evidence: "...",
          },
          {
            chapterNo: 1,
            type: "setting_consistency" as const,
            severity: "warning" as const,
            note: "废土条目未在正文出现",
          },
        ],
        summary: "发现 2 处",
      }),
    }) ?? auditTask;

    const deltas: string[] = [];
    for await (const ev of task.stream(ctx)) if (ev.type === "text_delta") deltas.push(ev.delta);
    expect(deltas.join("")).toContain("2 处");
    const parsed = await task.parse(ctx, deltas.join(""));
    task.apply(ctx, parsed);
    expect(r.issues).toHaveLength(2);
    expect(r.issues[0]).toMatchObject({ type: "character_behavior", severity: "warning", note: "林尘状态与第 1 章不一致" });
  });

  it("空 issue 列表 → apply 不落任何 reader_issue", () => {
    const r = rig();
    const ctx = { handle: r.handle, request: { source: "asset_audit", target: { auditScope: { assets: ["all"] } } } } as any;
    auditTask.apply(ctx, { issues: [], summary: "无异常" } as any);
    expect(r.issues).toEqual([]);
  });

  it("stream 完成后 parse 消费掉 state,再次 parse 抛 audit_result_missing", async () => {
    const r = rig();
    const ctx = {
      handle: r.handle, writeModel: {} as any, auditModel: {} as any,
      request: { message: "x", source: "asset_audit" as const, target: { auditScope: { assets: ["all"] } } },
    } as any;
    // state 用闭包封装在 makeTask 里,每个 withDeps() 产生的 task 实例互相独立
    // → 这里必须用 withDeps() 派生的实例,不能共用 export 的 auditTask 单例
    // (单例 state 已在其他测试里被消费/污染)。
    const task = auditTask.withDeps?.({
      runAudit: async () => ({ issues: [], summary: "无异常" }),
    }) ?? auditTask;
    for await (const _ of task.stream(ctx)) { /* drain */ }
    await task.parse(ctx, ""); // 第一次 ok
    await expect(task.parse(ctx, "")).rejects.toThrow(/audit_result_missing/);
  });

  it("apply:issues 都在事务内落库", () => {
    const r = rig();
    const txCalls: any[] = [];
    r.handle.workspaceDb.transaction = (fn: () => void) => () => { txCalls.push("start"); fn(); txCalls.push("end"); };
    const ctx = { handle: r.handle, request: { source: "asset_audit", target: { auditScope: { assets: ["all"] } } } } as any;
    auditTask.apply(ctx, {
      issues: [
        { chapterNo: 1, type: "character_behavior", severity: "warning", note: "x", evidence: "y" },
        { chapterNo: 1, type: "setting_consistency", severity: "warning", note: "z" },
      ],
      summary: "s",
    } as any);
    expect(txCalls).toEqual(["start", "end"]);
    expect(r.issues).toHaveLength(2);
  });
});
