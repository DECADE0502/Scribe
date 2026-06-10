import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { WorkspacePage } from "../../src/pages/workspace.js";

describe("WorkspacePage", () => {
  it("渲染三栏 + bookId 标识", () => {
    render(
      <MemoryRouter initialEntries={["/books/abc"]}>
        <Routes>
          <Route path="/books/:bookId" element={<WorkspacePage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("page-workspace")).toBeInTheDocument();
    expect(screen.getByTestId("pane-conversation")).toBeInTheDocument();
    expect(screen.getByTestId("pane-editor")).toBeInTheDocument();
    expect(screen.getByTestId("pane-sidebar")).toBeInTheDocument();
    expect(screen.getByTestId("book-id-label")).toHaveTextContent("abc");
  });

  it("左栏渲染对话面板,中右栏为中文占位", () => {
    render(
      <MemoryRouter initialEntries={["/books/x"]}>
        <Routes>
          <Route path="/books/:bookId" element={<WorkspacePage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("conversation-pane")).toBeInTheDocument();
    expect(screen.getByTestId("placeholder-editor")).toHaveTextContent("正文");
    expect(screen.getByTestId("placeholder-sidebar")).toHaveTextContent("资料");
  });

  it("返回书架按钮存在", () => {
    render(
      <MemoryRouter initialEntries={["/books/x"]}>
        <Routes>
          <Route path="/books/:bookId" element={<WorkspacePage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("返回书架")).toBeInTheDocument();
  });
});
