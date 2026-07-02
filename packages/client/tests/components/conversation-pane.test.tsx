import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { ConversationPane, type StreamFn } from "../../src/components/conversation/conversation-pane.js";
import { useConversationStore } from "../../src/stores/conversation.js";

type EventSink = (ev: { type: string; [key: string]: unknown }) => void;

function makeManualStream() {
  let sink: EventSink | null = null;
  const cancelSpy = vi.fn();
  const streamFn: StreamFn = (opts) => {
    sink = opts.onEvent;
    return { cancel: cancelSpy, done: Promise.resolve() };
  };
  return {
    streamFn,
    cancelSpy,
    push(ev: { type: string; [key: string]: unknown }) {
      act(() => sink?.(ev));
    },
  };
}

beforeEach(() => {
  useConversationStore.getState().reset();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ messages: [], ok: true }),
  } as Response));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function renderPane(streamFn: StreamFn, bookId = "b1") {
  const view = render(<ConversationPane bookId={bookId} streamFn={streamFn} />);
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  return view;
}

function sendMessage(text: string) {
  fireEvent.change(screen.getByTestId("composer-input"), { target: { value: text } });
  fireEvent.click(screen.getByTestId("btn-send"));
}

describe("ConversationPane", () => {
  it("replaces history when switching books", async () => {
    const stream = makeManualStream();
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/conversation")) {
        const messages = url.includes("/books/b1/")
          ? [{ id: 1, role: "user", content: "旧书消息", createdAt: 1 }]
          : [{ id: 2, role: "user", content: "新书消息", createdAt: 2 }];
        return Promise.resolve({ ok: true, json: async () => ({ messages }) } as Response);
      }
      return Promise.resolve({ ok: true, json: async () => ({ ok: true }) } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    const view = await renderPane(stream.streamFn, "b1");
    await waitFor(() => expect(screen.getByText("旧书消息")).toBeInTheDocument());

    view.rerender(<ConversationPane bookId="b2" streamFn={stream.streamFn} />);

    await waitFor(() => expect(screen.getByText("新书消息")).toBeInTheDocument());
    expect(screen.queryByText("旧书消息")).not.toBeInTheDocument();
  });

  it("sends chat through the unified agent endpoint and renders streamed deltas", async () => {
    const m = makeManualStream();
    await renderPane(m.streamFn);

    sendMessage("你好");

    expect(screen.getByText("你好")).toBeInTheDocument();
    expect(screen.getByTestId("streaming-placeholder")).toBeInTheDocument();

    m.push({ type: "text_delta", delta: "在" });
    m.push({ type: "text_delta", delta: "的" });
    expect(screen.getByTestId("streaming-message")).toHaveTextContent("在的");

    m.push({ type: "done", committed: false });
    await waitFor(() => expect(screen.queryByTestId("streaming-message")).not.toBeInTheDocument());
    expect(screen.getByText("在的")).toBeInTheDocument();
  });

  it("done committed=false does not refresh chapters (pure chat)", async () => {
    const m = makeManualStream();
    await renderPane(m.streamFn);
    sendMessage("先聊聊第一人称");
    const before = useConversationStore.getState().chapterRefreshTrigger;

    m.push({ type: "text_delta", delta: "可以，先保持第一人称。" });
    m.push({ type: "done", committed: false });

    await waitFor(() => expect(screen.queryByTestId("streaming-message")).not.toBeInTheDocument());
    expect(useConversationStore.getState().chapterRefreshTrigger).toBe(before);
    expect(screen.getByText("可以，先保持第一人称。")).toBeInTheDocument();
    expect(screen.queryByText("变更已提交。")).not.toBeInTheDocument();
  });

  it("done committed=true refreshes chapters and library", async () => {
    const m = makeManualStream();
    await renderPane(m.streamFn);
    sendMessage("写第一章");
    const beforeChapter = useConversationStore.getState().chapterRefreshTrigger;
    const beforeLibrary = useConversationStore.getState().libraryRefreshTrigger;

    m.push({ type: "text_delta", delta: "正文内容……" });
    m.push({ type: "done", committed: true });

    await waitFor(() => expect(screen.queryByTestId("streaming-message")).not.toBeInTheDocument());
    expect(useConversationStore.getState().chapterRefreshTrigger).toBe(beforeChapter + 1);
    expect(useConversationStore.getState().libraryRefreshTrigger).toBe(beforeLibrary + 1);
    expect(screen.getByText("变更已提交。")).toBeInTheDocument();
  });

  it("shows errors and retries the last message", async () => {
    const m = makeManualStream();
    await renderPane(m.streamFn);
    sendMessage("写一章");

    m.push({ type: "error", errorClass: "provider_error", message: "请求过于频繁，请稍后重试" });
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("请求过于频繁"));

    fireEvent.click(screen.getByTestId("btn-retry"));
    expect(screen.getByTestId("streaming-placeholder")).toBeInTheDocument();
  });

  it("Ctrl+Enter sends the message", async () => {
    const m = makeManualStream();
    await renderPane(m.streamFn);
    const input = screen.getByTestId("composer-input");
    fireEvent.change(input, { target: { value: "测试消息" } });
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    expect(screen.getByText("测试消息")).toBeInTheDocument();
    expect(screen.getByTestId("streaming-placeholder")).toBeInTheDocument();
  });

  it("Escape cancels and preserves received assistant text", async () => {
    const m = makeManualStream();
    await renderPane(m.streamFn);
    sendMessage("长文");
    m.push({ type: "text_delta", delta: "已写的部分" });

    fireEvent.keyDown(screen.getByTestId("composer-input"), { key: "Escape" });
    expect(m.cancelSpy).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId("streaming-message")).not.toBeInTheDocument());
    expect(screen.getByText("已写的部分")).toBeInTheDocument();
  });

  it("disables send while streaming", async () => {
    const m = makeManualStream();
    await renderPane(m.streamFn);
    sendMessage("第一条");
    const input = screen.getByTestId("composer-input");
    fireEvent.change(input, { target: { value: "第二条" } });
    expect(screen.getByTestId("btn-send")).toBeDisabled();
  });

  it("active audit sends a structured asset_audit run without exposing raw prompt as the visible message", async () => {
    const m = makeManualStream();
    await renderPane(m.streamFn);

    fireEvent.click(screen.getByTestId("btn-asset-audit"));
    fireEvent.click(screen.getByTestId("asset-audit-option-characters"));

    expect(screen.getByText("已触发主动审查：角色")).toBeInTheDocument();
    expect(screen.queryByText(/必须读取已有相关资产/)).not.toBeInTheDocument();
  });
});
