import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { OnboardPage } from "../../src/pages/onboard.js";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

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

function sseResponse(events: string[]): Response {
  return {
    ok: true,
    status: 200,
    body: new ReadableStream({
      start(controller) {
        for (const event of events) controller.enqueue(new TextEncoder().encode(event));
        controller.close();
      },
    }),
  } as Response;
}

describe("OnboardPage", () => {
  it("renders the onboarding chat page and missing setup status", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: false, missing: ["题材", "主角"] }),
    } as Response);

    renderOnboard();

    expect(screen.getByTestId("page-onboard")).toBeTruthy();
    expect(screen.getByText(/对话把这本书的底子/)).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("onboard-status").textContent).toContain("题材"));
    expect(screen.queryByText(/待实现/)).toBeNull();
  });

  it("shows the workspace button when setup is complete", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, missing: [] }),
    } as Response);

    renderOnboard();

    await waitFor(() => expect(screen.getByTestId("onboard-start")).toBeTruthy());
    fireEvent.click(screen.getByTestId("onboard-start"));
    await waitFor(() => expect(screen.getByText("工作台")).toBeTruthy());
  });

  it("calls skip and navigates to the workspace", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: false, missing: ["题材"] }),
    } as Response);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ skipped: true }),
    } as Response);

    renderOnboard();

    await waitFor(() => screen.getByTestId("onboard-skip"));
    fireEvent.click(screen.getByTestId("onboard-skip"));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("/onboard/skip"));
      expect(call).toBeTruthy();
    });
    await waitFor(() => expect(screen.getByText("工作台")).toBeTruthy());
  });

  it("sends onboarding AI turns through the unified agent endpoint", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: false, missing: ["题材"] }),
    } as Response);
    fetchMock.mockResolvedValueOnce(sseResponse([
      'event: text_delta\ndata: {"type":"text_delta","delta":"收到"}\n\n',
      'event: done\ndata: {"type":"done","committed":true}\n\n',
    ]));

    renderOnboard();

    await waitFor(() => screen.getByTestId("onboard-input"));
    fireEvent.change(screen.getByTestId("onboard-input"), { target: { value: "我想写一本城市奇幻" } });
    fireEvent.click(screen.getByTestId("onboard-send"));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("/agent/run"));
      expect(call).toBeTruthy();
      expect(String(call?.[0] ?? "")).not.toContain("/onboard");
      expect(JSON.parse(String((call?.[1] as RequestInit | undefined)?.body))).toMatchObject({
        message: "我想写一本城市奇幻",
        source: "onboard",
      });
    });
  });
});
