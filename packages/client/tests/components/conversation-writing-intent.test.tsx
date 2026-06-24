import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { ConversationPane, type StreamFn } from "../../src/components/conversation/conversation-pane.js";
import { useConversationStore } from "../../src/stores/conversation.js";

type EventSink = (ev: { type: string; [key: string]: unknown }) => void;

function makeManualStream() {
  let sink: EventSink | null = null;
  const bodies: unknown[] = [];
  const streamFn: StreamFn = (opts) => {
    sink = opts.onEvent;
    bodies.push(opts.body);
    return { cancel: vi.fn(), done: Promise.resolve() };
  };
  return {
    streamFn,
    push(ev: { type: string; [key: string]: unknown }) {
      act(() => sink?.(ev));
    },
    lastBody: () => bodies.at(-1),
    bodies: () => bodies,
  };
}

beforeEach(() => {
  useConversationStore.getState().reset();
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({
    ok: true,
    json: async () => ({ messages: [], ok: true }),
  } as Response)));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function sendMessage(text: string) {
  fireEvent.change(screen.getByTestId("composer-input"), { target: { value: text } });
  fireEvent.click(screen.getByTestId("btn-send"));
}

async function renderPane(streamFn: StreamFn) {
  render(<ConversationPane bookId="b1" streamFn={streamFn} />);
  await waitFor(() => expect(fetch).toHaveBeenCalled());
}

describe("ConversationPane agent workflow", () => {
  it("stores execution workflow mode", () => {
    expect(useConversationStore.getState().executionMode).toBe("low_risk_auto");

    act(() => useConversationStore.getState().setExecutionMode("plan_only"));

    expect(useConversationStore.getState().executionMode).toBe("plan_only");
  });

  it("sends execution mode with conversation requests", async () => {
    const m = makeManualStream();
    await renderPane(m.streamFn);

    act(() => useConversationStore.getState().setExecutionMode("plan_only"));
    sendMessage("直接把前三章都写了");

    await waitFor(() => expect(m.lastBody()).toMatchObject({ executionMode: "plan_only" }));
  });

  it("uses agent_progress events as visible workflow progress", async () => {
    const m = makeManualStream();
    await renderPane(m.streamFn);
    sendMessage("write next chapter");

    m.push({
      type: "agent_progress",
      runId: "run-1",
      phase: "executing",
      label: "执行变更",
      status: "running",
      detail: "chapterNo=1",
    });

    expect(screen.getByTestId("workflow-progress")).toHaveTextContent("执行变更");
    expect(screen.getByTestId("workflow-progress")).toHaveTextContent("chapterNo=1");
  });
  it("shows validation report while streaming", async () => {
    const m = makeManualStream();
    await renderPane(m.streamFn);
    sendMessage("write next chapter");

    m.push({ type: "agent_progress", phase: "executing", label: "执行变更", status: "running" });
    m.push({ type: "validation_report", verdict: "pass", issues: [], commitAllowed: true });

    expect(screen.getByTestId("validation-report")).toHaveTextContent("pass");
  });

  it("approves a confirmation by committing the paused run instead of rerunning the request", async () => {
    const m = makeManualStream();
    const fetchMock = vi.mocked(fetch);
    await renderPane(m.streamFn);

    sendMessage("write next chapter");
    m.push({
      type: "confirmation_required",
      taskId: "task-1",
      message: "low_risk_auto requires confirmation for write actions",
      policy: {
        taskId: "task-1",
        configuredMode: "low_risk_auto",
        effectiveMode: "confirm",
        highestRisk: "write",
        requiresConfirmation: true,
        reason: "low_risk_auto requires confirmation for write actions",
        userChoices: ["approve", "edit_plan", "reroll", "cancel"],
      },
    });
    m.push({ type: "done", committed: false, needsUserDecision: true, runId: "r1" });

    await waitFor(() => expect(screen.getByTestId("execution-confirmation-card")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("execution-approve"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/books/b1/agent/runs/r1/approve",
      expect.objectContaining({ method: "POST" }),
    ));
    expect(m.bodies()).toHaveLength(1);
  });

  it("starts a full asset audit request from the active audit menu without exposing the raw prompt", async () => {
    const m = makeManualStream();
    await renderPane(m.streamFn);

    fireEvent.click(screen.getByTestId("btn-asset-audit"));
    expect(screen.getByTestId("asset-audit-menu")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("asset-audit-option-all"));

    await waitFor(() => expect(m.lastBody()).toMatchObject({
      source: "asset_audit",
      target: { auditScope: { assets: ["all"], mode: "report_and_fix" } },
    }));
    const body = m.lastBody() as { message?: string };
    expect(body.message).toContain("主动审查全书资产");
    expect(body.message).toContain("不要只审查当前章节");
    expect(screen.getByText("已触发主动审查：全部资产")).toBeInTheDocument();
    expect(screen.queryByText(/必须读取已有相关资产/)).not.toBeInTheDocument();
  });
});




