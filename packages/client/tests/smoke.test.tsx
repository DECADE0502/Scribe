import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { App } from "../src/App.js";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ books: [] }),
  } as Response);
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("App smoke", () => {
  it("渲染默认路由(/library)显示书架标题", async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "我的书架" })).toBeInTheDocument();
    });
  });
});
