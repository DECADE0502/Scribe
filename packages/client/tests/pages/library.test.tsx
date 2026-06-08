import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { LibraryPage } from "../../src/pages/library.js";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockListBooks(books: unknown[]) {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ books }),
  } as Response);
}

function mockCreateBook(book: unknown) {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    status: 201,
    json: async () => book,
  } as Response);
}

const sample = (overrides: Partial<{ id: string; title: string; genre: string | null; createdAt: number; updatedAt: number; totalCostUsd: number }> = {}) => ({
  id: "b1",
  title: "测试书",
  genre: "仙侠",
  createdAt: 1_000,
  updatedAt: 2_000,
  totalCostUsd: 0.0123,
  ...overrides,
});

describe("LibraryPage", () => {
  it("空书架显示中文 emptyHint", async () => {
    mockListBooks([]);
    render(<MemoryRouter><LibraryPage /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByTestId("library-empty")).toBeInTheDocument();
    });
    expect(screen.getByText(/还没有作品/)).toBeInTheDocument();
  });

  it("有书时渲染列表,显示书名、题材、成本", async () => {
    mockListBooks([sample({ title: "玄剑录" }), sample({ id: "b2", title: "都市录", genre: "都市" })]);
    render(<MemoryRouter><LibraryPage /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByTestId("library-list")).toBeInTheDocument();
    });
    expect(screen.getByText("玄剑录")).toBeInTheDocument();
    expect(screen.getByText("都市录")).toBeInTheDocument();
    expect(screen.getAllByText(/已花费/)).toHaveLength(2);
  });

  it("点新建按钮触发 POST /api/books", async () => {
    mockListBooks([]);
    mockCreateBook(sample({ id: "new-id" }));
    render(<MemoryRouter><LibraryPage /></MemoryRouter>);
    await waitFor(() => screen.getByTestId("btn-new-book"));
    fireEvent.click(screen.getByTestId("btn-new-book"));
    await waitFor(() => {
      const calls = fetchMock.mock.calls;
      expect(calls.some(c => c[0] === "/api/books" && c[1]?.method === "POST")).toBe(true);
    });
  });

  it("加载失败显示错误消息", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: "服务器错误" }),
    } as Response);
    render(<MemoryRouter><LibraryPage /></MemoryRouter>);
    await waitFor(() => screen.getByTestId("library-error"));
    expect(screen.getByText(/服务器错误/)).toBeInTheDocument();
  });

  it("删除时弹中文确认对话框", async () => {
    mockListBooks([sample({ id: "b1" })]);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<MemoryRouter><LibraryPage /></MemoryRouter>);
    await waitFor(() => screen.getByTestId(`book-card-b1`));
    const deleteBtns = screen.getAllByText("删除");
    fireEvent.click(deleteBtns[0]!);
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("删除后无法恢复"));
    confirmSpy.mockRestore();
  });

  it("加载中显示 loading 提示", async () => {
    let resolve: ((v: { ok: boolean; status: number; json: () => Promise<{ books: unknown[] }> }) => void) | undefined;
    fetchMock.mockReturnValueOnce(new Promise(r => { resolve = r; }));
    render(<MemoryRouter><LibraryPage /></MemoryRouter>);
    expect(screen.getByTestId("library-loading")).toBeInTheDocument();
    resolve?.({ ok: true, status: 200, json: async () => ({ books: [] }) });
    await waitFor(() => {
      expect(screen.queryByTestId("library-loading")).not.toBeInTheDocument();
    });
  });
});
