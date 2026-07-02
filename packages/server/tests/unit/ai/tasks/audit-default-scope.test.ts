import { describe, expect, it, vi } from "vitest";

/**
 * defaultRunAudit 的资产范围拼装:前端"元素/设定/伏笔"审查会传
 * foreshadowing / timeline 资产,漏掉这两个分支等于给 LLM 送空内容。
 * mock 掉 llm-call 捕获真实发出的消息来断言。
 */
vi.mock("../../../../src/ai/llm-call.js", () => {
  const calls: Array<{ messages: Array<{ role: string; content: string }> }> = [];
  return {
    __calls: calls,
    streamLlm: vi.fn(),
    generateTextWithRetry: vi.fn(),
    generateLlmText: vi.fn(async (input: { messages: Array<{ role: string; content: string }> }) => {
      calls.push({ messages: input.messages });
      return {
        text: JSON.stringify({ issues: [], summary: "无异常" }),
        usage: { promptTokens: 10, completionTokens: 5 },
      };
    }),
  };
});

import { auditTask } from "../../../../src/ai/tasks/audit.js";
import * as llmCall from "../../../../src/ai/llm-call.js";

function makeCtx(assets: string[]) {
  return {
    handle: {
      workspaceDb: { transaction: (fn: () => void) => () => fn() },
      charactersRepo: { list: () => [{ name: "林尘" }] },
      outlineRepo: { listAll: () => [{ title: "第一卷" }] },
      worldbookRepo: { list: () => [{ title: "废土" }] },
      foreshadowingRepo: { list: () => [{ label: "黑剑", status: "active" }] },
      timelineRepo: { listAll: () => [{ chapterNo: 1, event: "登山" }] },
      chaptersRepo: { listSummaries: () => [{ chapterNo: 1, oneLiner: "开局" }] },
      readerIssuesRepo: { create: () => {} },
    } as any,
    writeModel: {} as any,
    auditModel: {} as any,
    request: {
      message: "审查",
      source: "asset_audit" as const,
      target: { auditScope: { assets, mode: "report_only" } },
    },
  } as any;
}

async function runScope(assets: string[]): Promise<string> {
  const before = (llmCall as any).__calls.length;
  // withDeps({}) 走默认 runAudit;drain stream(内部完成 LLM 调用)
  const task = auditTask.withDeps?.({}) ?? auditTask;
  for await (const _ of task.stream(makeCtx(assets))) { /* drain */ }
  const call = (llmCall as any).__calls[before];
  return call ? call.messages.map((m: any) => m.content).join("\n") : "";
}

describe("auditTask defaultRunAudit scope assembly", () => {
  it("scope=foreshadowing → 消息里有伏笔内容,没有角色/大纲", async () => {
    const sent = await runScope(["foreshadowing"]);
    expect(sent).toContain("# Foreshadowing");
    expect(sent).toContain("黑剑");
    expect(sent).not.toContain("# Characters");
    expect(sent).not.toContain("# Outline");
  });

  it("scope=timeline → 消息里有时间线内容", async () => {
    const sent = await runScope(["timeline"]);
    expect(sent).toContain("# Timeline");
    expect(sent).toContain("登山");
  });

  it("scope=all → 全部六类资产都在", async () => {
    const sent = await runScope(["all"]);
    for (const section of ["# Characters", "# Outline", "# Worldbook", "# Foreshadowing", "# Timeline", "# Recent chapters"]) {
      expect(sent).toContain(section);
    }
  });

  it("scope 全是未知值 → 不调 LLM,返回空审查结果", async () => {
    const before = (llmCall as any).__calls.length;
    const task = auditTask.withDeps?.({}) ?? auditTask;
    const ctx = makeCtx(["nonsense"]);
    const deltas: string[] = [];
    for await (const ev of task.stream(ctx)) if (ev.type === "text_delta") deltas.push(ev.delta);
    expect((llmCall as any).__calls.length).toBe(before);   // 没有发起调用
    const parsed = await task.parse(ctx, deltas.join(""));
    expect(parsed.issues).toEqual([]);
  });
});
