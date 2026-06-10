import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { WorkspacePage } from "../../src/pages/workspace.js";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  // SidePanel 默认 tab 会拉 characters
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ characters: [] }),
  } as Response);
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
  it("渲染三栏 + bookId 标识", () => {
    renderAt("/books/abc");
    expect(screen.getByTestId("page-workspace")).toBeInTheDocument();
    expect(screen.getByTestId("pane-conversation")).toBeInTheDocument();
    expect(screen.getByTestId("pane-editor")).toBeInTheDocument();
    expect(screen.getByTestId("pane-sidebar")).toBeInTheDocument();
    expect(screen.getByTestId("book-id-label")).toHaveTextContent("abc");
  });

  it("左栏对话面板,中栏占位,右栏资料面板", () => {
    renderAt("/books/x");
    expect(screen.getByTestId("conversation-pane")).toBeInTheDocument();
    expect(screen.getByTestId("placeholder-editor")).toHaveTextContent("正文");
    expect(screen.getByTestId("side-panel")).toBeInTheDocument();
  });

  it("返回书架按钮存在", () => {
    renderAt("/books/x");
    expect(screen.getByText("返回书架")).toBeInTheDocument();
  });
});
