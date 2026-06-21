import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { OutlinePanel } from "../../src/components/sidebar/outline-panel.js";
import { useConversationStore } from "../../src/stores/conversation.js";

const fetchMock = vi.fn();

function jsonResponse(data: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => data } as Response;
}

beforeEach(() => {
  useConversationStore.getState().reset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sidebar refresh from conversation tools", () => {
  it("reloads outline panel when libraryRefreshTrigger changes", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ outline: [] }))
      .mockResolvedValueOnce(jsonResponse({
        outline: [
          {
            id: "o1",
            parentId: null,
            level: "chapter",
            title: "Chapter 2",
            summary: null,
            status: "planned",
            sortOrder: 0,
          },
        ],
      }));

    render(<OutlinePanel bookId="b1" />);

    await waitFor(() => expect(screen.getByTestId("outline-empty")).toBeInTheDocument());

    act(() => useConversationStore.getState().triggerLibraryRefresh());

    await waitFor(() => expect(screen.getByText("Chapter 2")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
