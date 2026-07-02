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

describe("ConversationPane agent requests", () => {
  it("chat request body carries message + source, no legacy executionMode", async () => {
    const m = makeManualStream();
    await renderPane(m.streamFn);

    sendMessage("聊聊主角设定");

    await waitFor(() => expect(m.lastBody()).toMatchObject({
      message: "聊聊主角设定",
      source: "chat",
    }));
    expect(m.lastBody() as Record<string, unknown>).not.toHaveProperty("executionMode");
  });

  it("starts a full asset audit request from the active audit menu without exposing the raw prompt", async () => {
    const m = makeManualStream();
    await renderPane(m.streamFn);

    fireEvent.click(screen.getByTestId("btn-asset-audit"));
    expect(screen.getByTestId("asset-audit-menu")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("asset-audit-option-all"));

    await waitFor(() => expect(m.lastBody()).toMatchObject({
      source: "asset_audit",
      target: { auditScope: { assets: ["all"], mode: "report_only" } },
    }));
    const body = m.lastBody() as { message?: string };
    expect(body.message).toContain("主动审查全书资产");
    expect(body.message).toContain("不要只审查当前章节");
    expect(screen.getByText("已触发主动审查：全部资产")).toBeInTheDocument();
    expect(screen.queryByText(/必须读取已有相关资产/)).not.toBeInTheDocument();
  });

  it("audit reply streams as text and issues land after done committed=true", async () => {
    const m = makeManualStream();
    await renderPane(m.streamFn);

    fireEvent.click(screen.getByTestId("btn-asset-audit"));
    fireEvent.click(screen.getByTestId("asset-audit-option-characters"));

    m.push({ type: "text_delta", delta: "发现 2 处角色状态不一致" });
    expect(screen.getByTestId("streaming-message")).toHaveTextContent("发现 2 处");

    m.push({ type: "done", committed: true });
    await waitFor(() => expect(screen.queryByTestId("streaming-message")).not.toBeInTheDocument());
    expect(screen.getByText("变更已提交。")).toBeInTheDocument();
  });
});
