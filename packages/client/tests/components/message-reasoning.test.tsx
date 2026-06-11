import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Message } from "../../src/components/conversation/message.js";
import type { ChatMessage } from "../../src/stores/conversation.js";

const base: ChatMessage = {
  id: "m1",
  role: "assistant",
  content: "这是正文回答。",
  reasoning: "我先分析了主角动机,再决定剧情走向……",
  toolEvents: [],
};

describe("Message 看 AI 思考过程(§5.5)", () => {
  it("有 reasoning 时显示折叠按钮,点击后展开内容", () => {
    render(<Message m={base} />);
    const toggle = screen.getByTestId("toggle-reasoning");
    expect(toggle.textContent).toContain("看 AI 思考过程");
    // 默认折叠
    expect(screen.queryByTestId("reasoning-content")).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByTestId("reasoning-content").textContent).toContain("主角动机");
  });

  it("无 reasoning 时不显示按钮", () => {
    render(<Message m={{ ...base, reasoning: undefined }} />);
    expect(screen.queryByTestId("toggle-reasoning")).toBeNull();
  });

  it("用户消息不显示思考过程", () => {
    render(<Message m={{ ...base, role: "user" }} />);
    expect(screen.queryByTestId("toggle-reasoning")).toBeNull();
  });
});
