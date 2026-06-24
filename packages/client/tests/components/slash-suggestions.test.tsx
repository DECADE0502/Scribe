import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ConversationPane, type StreamFn } from "../../src/components/conversation/conversation-pane.js";
import { useConversationStore } from "../../src/stores/conversation.js";

const noopStream: StreamFn = () => ({ cancel: vi.fn(), done: Promise.resolve() });

beforeEach(() => {
  useConversationStore.getState().reset();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ messages: [], ok: true }),
  } as Response));
});

describe("natural language shortcuts", () => {
  async function renderPane() {
    render(<ConversationPane bookId="b1" streamFn={noopStream} />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
  }

  it("opens the suggestion list for slash input", async () => {
    await renderPane();

    fireEvent.change(screen.getByTestId("composer-input"), { target: { value: "/" } });

    expect(screen.getByTestId("slash-suggestions")).toBeInTheDocument();
    expect(screen.getAllByTestId(/^slash-option-/).length).toBeGreaterThan(0);
  });

  it("filters suggestions by keyword", async () => {
    await renderPane();

    fireEvent.change(screen.getByTestId("composer-input"), { target: { value: "/重写" } });

    expect(screen.getAllByTestId(/^slash-option-/).length).toBeGreaterThan(0);
  });

  it("picks a shortcut as plain text only", async () => {
    await renderPane();
    const input = screen.getByTestId("composer-input");

    fireEvent.change(input, { target: { value: "/帮" } });
    fireEvent.click(screen.getByText("请帮我写下一章"));

    expect((input as HTMLTextAreaElement).value.trim()).toBe("请帮我写下一章，并延续前文语气。");
    expect(screen.queryByTestId("slash-suggestions")).not.toBeInTheDocument();
  });

  it("does not open suggestions for ordinary text", async () => {
    await renderPane();

    fireEvent.change(screen.getByTestId("composer-input"), { target: { value: "你好" } });

    expect(screen.queryByTestId("slash-suggestions")).not.toBeInTheDocument();
  });

  it("closes suggestions with Escape", async () => {
    await renderPane();

    fireEvent.change(screen.getByTestId("composer-input"), { target: { value: "/" } });
    expect(screen.getByTestId("slash-suggestions")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByTestId("slash-suggestions")).not.toBeInTheDocument();
  });
});


