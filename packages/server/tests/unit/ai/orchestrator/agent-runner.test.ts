import { describe, expect, it } from "vitest";
import { runAgentWorkflow } from "../../../../src/ai/orchestrator/agent-runner.js";
import type { StagedChange, WorkflowStaging } from "../../../../src/ai/orchestrator/workflow-staging.js";

async function collect(iterable: AsyncIterable<unknown>) {
  const events: unknown[] = [];
  for await (const event of iterable) events.push(event);
  return events as Array<Record<string, unknown>>;
}

function makeHandle() {
  return {
    bookId: "book-1",
    charactersRepo: { list: () => [] },
    outlineRepo: { listAll: () => [], findChapterNode: () => undefined, get: () => undefined },
    foreshadowingRepo: { list: () => [] },
    chaptersRepo: { listSummaries: () => [] },
    chapterFiles: { read: () => undefined, list: () => [] },
    genreSectionsRepo: { listSections: () => [], listItems: () => [] },
    bookMetaRepo: { get: () => undefined },
    rulesMdPath: "Z:/missing-rules.md",
  } as any;
}

function makeStaging(overrides: Partial<WorkflowStaging> = {}): WorkflowStaging {
  return {
    begin: () => undefined,
    add: () => undefined,
    replace: () => undefined,
    commit: () => ({ committed: [], failed: [] }),
    discard: () => undefined,
    ...overrides,
  };
}

const longDraft = "This is a sufficiently long hidden chapter draft. ".repeat(6);

describe("runAgentWorkflow", () => {
  it("emits canonical progress events instead of legacy execution_plan events", async () => {
    const events = await collect(runAgentWorkflow(
      {
        handle: makeHandle(),
        model: {},
        auditModel: {},
        staging: makeStaging(),
        generateText: async () => ({ text: JSON.stringify({ intent: "query_only", reply: "ack" }) }),
      },
      { message: "hello", source: "chat" },
    ));

    expect(events).toContainEqual(expect.objectContaining({
      type: "agent_progress",
      phase: "executing",
      status: "done",
    }));
    expect(events).not.toContainEqual(expect.objectContaining({ type: "execution_plan" }));
  });

  it("emits usage for the main agent model decision", async () => {
    const events = await collect(runAgentWorkflow(
      {
        handle: makeHandle(),
        model: {},
        auditModel: {},
        staging: makeStaging(),
        generateText: async () => ({
          text: JSON.stringify({ intent: "query_only", reply: "ok" }),
          usage: { promptTokens: 12, completionTokens: 3, cachedTokens: 2, reasoningTokens: 1 },
        }),
      },
      { message: "hello", source: "chat" },
    ));

    expect(events).toContainEqual(expect.objectContaining({
      type: "usage",
      taskType: "intent",
      modelRole: "write",
      promptTokens: 12,
      completionTokens: 3,
      cachedTokens: 2,
      reasoningTokens: 1,
    }));
  });

  it("does not commit or report mutations for query-only conversations", async () => {
    let commitCalls = 0;
    const events = await collect(runAgentWorkflow(
      {
        handle: makeHandle(),
        model: {},
        auditModel: {},
        staging: makeStaging({
          commit: () => {
            commitCalls += 1;
            return { committed: [], failed: [] };
          },
        }),
        generateText: async () => ({ text: JSON.stringify({ intent: "query_only", reply: "discuss only" }) }),
      },
      { message: "talk about first person", source: "chat" },
    ));

    expect(commitCalls).toBe(0);
    expect(events.at(-1)).toMatchObject({
      type: "done",
      committed: false,
      needsUserDecision: false,
    });
  });

  it("keeps write steps staged in low risk mode instead of committing immediately", async () => {
    const staged: StagedChange[] = [];
    let commitCalls = 0;
    const events = await collect(runAgentWorkflow(
      {
        handle: makeHandle(),
        model: {},
        auditModel: {},
        staging: makeStaging({
          add: (_runId, change) => staged.push(change),
          commit: () => {
            commitCalls += 1;
            return { committed: staged, failed: [] };
          },
        }),
        generateText: async () => ({
          text: JSON.stringify({
            intent: "write_chapter",
            reply: "prepared",
            draft: longDraft,
            targetChapterNo: 1,
          }),
        }),
      },
      { message: "write chapter 1", source: "chat", executionMode: "low_risk_auto", target: { chapterNo: 1 } },
    ));

    expect(staged).toHaveLength(1);
    expect(commitCalls).toBe(0);
    expect(events.at(-1)).toMatchObject({
      type: "done",
      committed: false,
      needsUserDecision: true,
    });
  });

  it("commits write steps in trusted auto mode and reports commit failures", async () => {
    const events = await collect(runAgentWorkflow(
      {
        handle: makeHandle(),
        model: {},
        auditModel: {},
        staging: makeStaging({
          commit: () => ({
            committed: [],
            failed: [{ change: { id: "c1", type: "chapter_version", payload: {} }, error: "file write failed" }],
          }),
        }),
        generateText: async () => ({
          text: JSON.stringify({
            intent: "write_chapter",
            reply: "prepared",
            draft: longDraft,
            targetChapterNo: 1,
          }),
        }),
      },
      { message: "write chapter 1", source: "chat", executionMode: "trusted_auto", target: { chapterNo: 1 } },
    ));

    expect(events).toContainEqual(expect.objectContaining({
      type: "error",
      errorClass: "commit_failed",
    }));
    expect(events.at(-1)).toMatchObject({
      type: "done",
      committed: false,
      needsUserDecision: true,
    });
  });

  it("does not expose chapter draft text in visible main_output", async () => {
    const events = await collect(runAgentWorkflow(
      {
        handle: makeHandle(),
        model: {},
        auditModel: {},
        staging: makeStaging(),
        generateText: async () => ({
          text: JSON.stringify({
            intent: "write_chapter",
            reply: "prepared",
            draft: longDraft,
            targetChapterNo: 1,
          }),
        }),
      },
      { message: "write chapter 1", source: "chat", executionMode: "low_risk_auto", target: { chapterNo: 1 } },
    ));

    expect(events).toContainEqual(expect.objectContaining({ type: "main_output", reply: "prepared" }));
    expect(events).not.toContainEqual(expect.objectContaining({
      type: "main_output",
      draft: expect.stringContaining("hidden chapter draft"),
    }));
  });

  it("replaces staged changes before committing a repaired plan", async () => {
    let replaced: StagedChange[] = [];
    const events = await collect(runAgentWorkflow(
      {
        handle: makeHandle(),
        model: {},
        auditModel: {},
        staging: makeStaging({
          replace: (_runId, changes) => { replaced = changes; },
          commit: () => ({ committed: replaced, failed: [] }),
        }),
        generateText: async () => ({
          text: JSON.stringify({
            intent: "write_chapter",
            reply: "prepared",
            draft: "short",
            targetChapterNo: 1,
          }),
        }),
      },
      { message: "write chapter 1", source: "chat", executionMode: "trusted_auto", target: { chapterNo: 1 } },
    ));

    expect(replaced).toHaveLength(1);
    expect(events).toContainEqual(expect.objectContaining({ type: "repair_plan" }));
  });

  it("does not auto-repair or commit critical validation failures", async () => {
    let replaceCalls = 0;
    let commitCalls = 0;
    const events = await collect(runAgentWorkflow(
      {
        handle: makeHandle(),
        model: {},
        auditModel: {},
        staging: makeStaging({
          replace: () => { replaceCalls += 1; },
          commit: () => {
            commitCalls += 1;
            return { committed: [], failed: [] };
          },
        }),
        generateText: async () => ({
          text: JSON.stringify({
            intent: "write_chapter",
            reply: "prepared",
            draft: longDraft,
            targetChapterNo: 2,
          }),
        }),
      },
      { message: "write chapter 1", source: "chat", executionMode: "trusted_auto", target: { chapterNo: 1 } },
    ));

    expect(replaceCalls).toBe(0);
    expect(commitCalls).toBe(0);
    expect(events).not.toContainEqual(expect.objectContaining({ type: "repair_plan" }));
    expect(events.at(-1)).toMatchObject({
      type: "done",
      committed: false,
      needsUserDecision: true,
    });
  });
});
