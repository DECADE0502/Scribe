import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { OnboardPage } from "../../src/pages/onboard.js";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

function renderOnboard() {
  return render(
    <MemoryRouter initialEntries={["/books/b1/onboard"]}>
      <Routes>
        <Route path="/books/:bookId/onboard" element={<OnboardPage />} />
        <Route path="/books/:bookId" element={<div>工作台</div>} />
        <Route path="/library" element={<div>书架</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("OnboardPage", () => {
  it("渲染对话式新建书界面 + 引导语 + 状态", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: false, missing: ["题材", "主角"] }) } as Response);
    renderOnboard();
    expect(screen.getByTestId("page-onboard")).toBeTruthy();
    expect(screen.getByText(/对话把这本书的底子/)).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("onboard-status").textContent).toContain("题材"));
    // 不是占位符
    expect(screen.queryByText(/待实现/)).toBeNull();
  });

  it("设定齐了时出现进入工作台按钮", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true, missing: [] }) } as Response);
    renderOnboard();
    await waitFor(() => expect(screen.getByTestId("onboard-start")).toBeTruthy());
    fireEvent.click(screen.getByTestId("onboard-start"));
    await waitFor(() => expect(screen.getByText("工作台")).toBeTruthy());
  });

  it("跳过按钮调用 skip 并进入工作台", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: false, missing: ["题材"] }) } as Response);
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ skipped: true }) } as Response);
    renderOnboard();
    await waitFor(() => screen.getByTestId("onboard-skip"));
    fireEvent.click(screen.getByTestId("onboard-skip"));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("/onboard/skip"));
      expect(call).toBeTruthy();
    });
    await waitFor(() => expect(screen.getByText("工作台")).toBeTruthy());
  });
});
