import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConversationPane, type StreamFn } from "../../src/components/conversation/conversation-pane.js";
import { useConversationStore } from "../../src/stores/conversation.js";

const noopStream: StreamFn = () => ({ cancel: vi.fn(), done: Promise.resolve() });

beforeEach(() => {
  useConversationStore.getState().reset();
});

describe("斜杠命令补全", () => {
  it("输入 / 弹出全部 8 个命令", () => {
    render(<ConversationPane bookId="b1" streamFn={noopStream} />);
    fireEvent.change(screen.getByTestId("composer-input"), { target: { value: "/" } });
    expect(screen.getByTestId("slash-suggestions")).toBeInTheDocument();
    expect(screen.getAllByTestId(/^slash-option-/)).toHaveLength(8);
  });

  it("输入 /re 过滤出 3 个命令", () => {
    render(<ConversationPane bookId="b1" streamFn={noopStream} />);
    fireEvent.change(screen.getByTestId("composer-input"), { target: { value: "/re" } });
    expect(screen.getAllByTestId(/^slash-option-/)).toHaveLength(3);
  });

  it("点选命令补全到输入框", () => {
    render(<ConversationPane bookId="b1" streamFn={noopStream} />);
    const input = screen.getByTestId("composer-input");
    fireEvent.change(input, { target: { value: "/au" } });
    fireEvent.click(screen.getByTestId("slash-option-auto"));
    expect((input as HTMLTextAreaElement).value).toBe("/auto ");
    expect(screen.queryByTestId("slash-suggestions")).not.toBeInTheDocument();
  });

  it("普通文本不弹补全", () => {
    render(<ConversationPane bookId="b1" streamFn={noopStream} />);
    fireEvent.change(screen.getByTestId("composer-input"), { target: { value: "你好" } });
    expect(screen.queryByTestId("slash-suggestions")).not.toBeInTheDocument();
  });

  it("Escape 关闭补全", () => {
    render(<ConversationPane bookId="b1" streamFn={noopStream} />);
    fireEvent.change(screen.getByTestId("composer-input"), { target: { value: "/" } });
    expect(screen.getByTestId("slash-suggestions")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("slash-suggestions")).not.toBeInTheDocument();
  });
});
