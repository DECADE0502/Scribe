import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { ConversationPane, type StreamFn } from "../../src/components/conversation/conversation-pane.js";
import { useConversationStore } from "../../src/stores/conversation.js";

type EventSink = (ev: { type: string; [key: string]: unknown }) => void;

function makeManualStream() {
  let sink: EventSink | null = null;
  let body: unknown = null;
  const streamFn: StreamFn = (opts) => {
    sink = opts.onEvent;
    body = opts.body;
    return { cancel: vi.fn(), done: Promise.resolve() };
  };
  return {
    streamFn,
    push(ev: { type: string; [key: string]: unknown }) {
      act(() => sink?.(ev));
    },
    lastBody: () => body,
  };
}

beforeEach(() => {
  useConversationStore.getState().reset();
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({
    ok: true,
    json: async () => ({ messages: [] }),
  } as Response)));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function sendMessage(text: string) {
  fireEvent.change(screen.getByTestId("composer-input"), { target: { value: text } });
  fireEvent.click(screen.getByTestId("btn-send"));
}

async function waitForInitialHydration() {
  await waitFor(() => expect(fetch).toHaveBeenCalled());
}

describe("ConversationPane writing intent", () => {
  it("stores execution workflow mode", () => {
    expect(useConversationStore.getState().executionMode).toBe("low_risk_auto");

    act(() => useConversationStore.getState().setExecutionMode("plan_only"));

    expect(useConversationStore.getState().executionMode).toBe("plan_only");
  });

  it("sends execution mode with conversation requests", async () => {
    const m = makeManualStream();
    render(<ConversationPane bookId="b1" streamFn={m.streamFn} />);
    await waitForInitialHydration();

    act(() => useConversationStore.getState().setExecutionMode("plan_only"));
    sendMessage("直接把前三章都写了");

    await waitFor(() => expect(m.lastBody()).toMatchObject({ executionMode: "plan_only" }));
  });

  it("enters non-prose writing state on writing_intent before chapter_write starts", async () => {
    const m = makeManualStream();
    render(<ConversationPane bookId="b1" streamFn={m.streamFn} />);
    await waitForInitialHydration();
    sendMessage("直接把前三章都写了");

    m.push({ type: "intent", category: "writing_intent" });
    expect(screen.getByTestId("workflow-progress")).toHaveTextContent("写正文");
    expect(screen.getByTestId("streaming-message")).toHaveTextContent("正文生成中");

    m.push({ type: "text_delta", delta: "正文不应该出现在聊天框" });
    expect(screen.queryByText("正文不应该出现在聊天框")).not.toBeInTheDocument();
    expect(screen.getByTestId("streaming-message")).toBeInTheDocument();

    m.push({ type: "tool_call_start", toolName: "chapter_write", args: { chapterNo: 1 } });
    expect(screen.getByTestId("tool-running")).toHaveTextContent("正在写正文");
    m.push({ type: "tool_call_end", toolName: "chapter_write", result: { success: true } });
    m.push({ type: "done" });

    await waitFor(() => expect(screen.queryByTestId("streaming-message")).not.toBeInTheDocument());
    expect(screen.queryByText("正文不应该出现在聊天框")).not.toBeInTheDocument();
  });

  it("shows execution trace and acceptance report while streaming", async () => {
    const m = makeManualStream();
    render(<ConversationPane bookId="b1" streamFn={m.streamFn} />);
    await waitForInitialHydration();
    sendMessage("write next chapter");

    await waitFor(() => expect(m.lastBody()).toMatchObject({ message: "write next chapter" }));

    m.push({ type: "intent", category: "writing_intent" });
    m.push({
      type: "execution_step",
      taskId: "task-1",
      step: {
        id: "step-1",
        actionType: "chapter_write",
        riskLevel: "write",
        status: "succeeded",
        toolName: "chapter_write",
        verification: { method: "read_back", passed: true, detail: "chapter 1 read back" },
      },
    });

    expect(screen.getByText(/chapter 1 read back/)).toBeInTheDocument();

    m.push({
      type: "acceptance_report",
      report: {
        taskId: "task-1",
        verdict: "pass",
        userCriteria: [{ criterion: "write", status: "pass", evidence: "verified" }],
        processCriteria: [],
        domainCriteria: [],
        recommendedActions: [],
      },
    });

    expect(screen.getByText(/验收/)).toBeInTheDocument();
    expect(screen.getByText(/pass/)).toBeInTheDocument();
  });
});
