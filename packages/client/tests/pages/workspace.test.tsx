import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { WorkspacePage } from "../../src/pages/workspace.js";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  // These page-shell tests only assert layout. Keep child data requests pending so
  // async child state updates do not leak act(...) warnings into this suite.
  fetchMock.mockReturnValue(new Promise(() => {}) as Promise<Response>);
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/books/:bookId" element={<WorkspacePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("WorkspacePage", () => {
  it("renders three panes and book id label", () => {
    renderAt("/books/abc");
    expect(screen.getByTestId("page-workspace")).toBeInTheDocument();
    expect(screen.getByTestId("pane-conversation")).toBeInTheDocument();
    expect(screen.getByTestId("pane-editor")).toBeInTheDocument();
    expect(screen.getByTestId("pane-sidebar")).toBeInTheDocument();
    expect(screen.getByTestId("book-id-label")).toHaveTextContent("abc");
  });

  it("renders conversation, editor, and side panels", () => {
    renderAt("/books/x");
    expect(screen.getByTestId("conversation-pane")).toBeInTheDocument();
    expect(
      screen.queryByTestId("editor-pane") ?? screen.queryByTestId("editor-loading"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("side-panel")).toBeInTheDocument();
  });

  it("renders back to library button", () => {
    renderAt("/books/x");
    expect(screen.getByText(/返回书架/)).toBeInTheDocument();
  });
});
