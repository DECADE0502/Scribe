import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { ConversationPane, type StreamFn } from "../../src/components/conversation/conversation-pane.js";
import { useConversationStore } from "../../src/stores/conversation.js";

type EventSink = (ev: { type: string; [key: string]: unknown }) => void;

/** 可手动推事件的 stream mock */
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
});

function renderPane(streamFn: StreamFn) {
  return render(<ConversationPane bookId="b1" streamFn={streamFn} />);
}

function sendMessage(text: string) {
  fireEvent.change(screen.getByTestId("composer-input"), { target: { value: text } });
  fireEvent.click(screen.getByTestId("btn-send"));
}

describe("ConversationPane", () => {
  it("发送后:占位 → 文本逐字 → done 固化到消息列表", async () => {
    const m = makeManualStream();
    renderPane(m.streamFn);

    sendMessage("你好");
    // 用户消息立即出现
    expect(screen.getByText("你好")).toBeInTheDocument();
    // 流式占位(AI 思考中)
    expect(screen.getByTestId("streaming-placeholder")).toBeInTheDocument();

    m.push({ type: "text_delta", delta: "在" });
    m.push({ type: "text_delta", delta: "的" });
    expect(screen.getByTestId("streaming-message")).toHaveTextContent("在的");

    m.push({ type: "done" });
    await waitFor(() => {
      expect(screen.queryByTestId("streaming-message")).not.toBeInTheDocument();
    });
    // 固化的 assistant 消息
    expect(screen.getByText("在的")).toBeInTheDocument();
  });

  it("工具调用:start 显示进行中,end 后消失", () => {
    const m = makeManualStream();
    renderPane(m.streamFn);
    sendMessage("建板块");

    m.push({ type: "tool_call_start", toolName: "create_genre_section" });
    expect(screen.getByTestId("tool-running")).toHaveTextContent("create_genre_section");

    m.push({ type: "tool_call_end", toolName: "create_genre_section", result: {} });
    expect(screen.queryByTestId("tool-running")).not.toBeInTheDocument();
  });

  it("error 事件:显示中文错误 + 重试按钮重发", async () => {
    const m = makeManualStream();
    renderPane(m.streamFn);
    sendMessage("写一章");

    m.push({ type: "error", errorClass: "rate_limit", message: "请求过于频繁,请稍后重试" });
    await waitFor(() => screen.getByTestId("conversation-error"));
    expect(screen.getByText(/请求过于频繁/)).toBeInTheDocument();

    // 点重试会重新发起 stream(再次出现 streaming 占位)
    fireEvent.click(screen.getByTestId("btn-retry"));
    expect(screen.getByTestId("streaming-placeholder")).toBeInTheDocument();
  });

  it("Ctrl+Enter 发送", () => {
    const m = makeManualStream();
    renderPane(m.streamFn);
    const input = screen.getByTestId("composer-input");
    fireEvent.change(input, { target: { value: "测试消息" } });
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    expect(screen.getByText("测试消息")).toBeInTheDocument();
    expect(screen.getByTestId("streaming-placeholder")).toBeInTheDocument();
  });

  it("流式中按 Esc 取消:已收到的部分固化", async () => {
    const m = makeManualStream();
    renderPane(m.streamFn);
    sendMessage("长文");
    m.push({ type: "text_delta", delta: "已写的部分" });

    fireEvent.keyDown(screen.getByTestId("composer-input"), { key: "Escape" });
    expect(m.cancelSpy).toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByTestId("streaming-message")).not.toBeInTheDocument();
    });
    expect(screen.getByText("已写的部分")).toBeInTheDocument();
  });

  it("流式中发送按钮禁用", () => {
    const m = makeManualStream();
    renderPane(m.streamFn);
    sendMessage("第一条");
    const input = screen.getByTestId("composer-input");
    fireEvent.change(input, { target: { value: "第二条" } });
    expect(screen.getByTestId("btn-send")).toBeDisabled();
  });

  it("写作流程显示完整阶段进度,不显示正文内容", async () => {
    const m = makeManualStream();
    renderPane(m.streamFn);
    sendMessage("写下一章");

    m.push({ type: "tool_call_start", toolName: "chapter_write", args: {} });
    m.push({ type: "text_delta", delta: "不应该出现在左侧的正文" });
    m.push({ type: "tool_call_end", toolName: "chapter_write", result: { wordCount: 12 } });
    m.push({ type: "tool_call_end", toolName: "chapter_audit", result: { verdict: "ok" } });

    expect(screen.getByTestId("workflow-progress")).toHaveTextContent("写正文");
    expect(screen.getByTestId("workflow-progress")).toHaveTextContent("审查");
    expect(screen.getByTestId("workflow-progress")).toHaveTextContent("硬事实检查");
    expect(screen.queryByText("不应该出现在左侧的正文")).not.toBeInTheDocument();

    m.push({ type: "done" });
    await waitFor(() => expect(screen.queryByTestId("streaming-message")).not.toBeInTheDocument());
    expect(screen.queryByText("不应该出现在左侧的正文")).not.toBeInTheDocument();
  });
});
