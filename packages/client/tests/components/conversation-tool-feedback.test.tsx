import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { ConversationPane, type StreamFn } from "../../src/components/conversation/conversation-pane.js";
import { useConversationStore } from "../../src/stores/conversation.js";

type EventSink = (ev: { type: string; [key: string]: unknown }) => void;

function makeManualStream() {
  let sink: EventSink | null = null;
  const streamFn: StreamFn = (opts) => {
    sink = opts.onEvent;
    return { cancel: vi.fn(), done: Promise.resolve() };
  };
  return {
    streamFn,
    push(ev: { type: string; [key: string]: unknown }) {
      act(() => sink?.(ev));
    },
  };
}

async function renderPane(streamFn: StreamFn) {
  render(<ConversationPane bookId="b1" streamFn={streamFn} />);
  await waitFor(() => expect(fetch).toHaveBeenCalled());
}

function sendMessage(text: string) {
  fireEvent.change(screen.getByTestId("composer-input"), { target: { value: text } });
  fireEvent.click(screen.getByTestId("btn-send"));
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

describe("ConversationPane legacy tool events", () => {
  it("does not render deterministic mutation feedback from legacy tool_call_end events", async () => {
    const m = makeManualStream();
    await renderPane(m.streamFn);
    sendMessage("add outline");

    const before = useConversationStore.getState().libraryRefreshTrigger;
    m.push({
      type: "tool_call_end",
      toolName: "add_outline_node",
      result: { created: true, id: "o1", title: "Chapter 2" },
    });

    expect(screen.queryByText("已添加大纲节点:Chapter 2")).not.toBeInTheDocument();
    expect(useConversationStore.getState().libraryRefreshTrigger).toBe(before);
  });

  it("ignores legacy tool failures because validation_report/error must carry failures now", async () => {
    const m = makeManualStream();
    await renderPane(m.streamFn);
    sendMessage("add outline");

    m.push({
      type: "tool_call_end",
      toolName: "add_outline_node",
      result: { success: false, error: "parentId is required" },
    });

    expect(screen.queryByText(/parentId is required/)).not.toBeInTheDocument();
  });
});
