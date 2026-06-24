import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { DiffView } from "../../src/components/editor/diff-view.js";
import { VersionHistory } from "../../src/components/editor/version-history.js";
import { UsageDetailPage } from "../../src/pages/usage-detail.js";
import { ConversationPane, type StreamFn } from "../../src/components/conversation/conversation-pane.js";
import { useConversationStore } from "../../src/stores/conversation.js";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  useConversationStore.getState().reset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(data: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => data } as Response;
}

function mockConversationBootstrap() {
  fetchMock.mockImplementation(async (url: string) => {
    if (String(url).includes("/conversation")) return jsonResponse({ messages: [], ok: true });
    if (String(url).includes("/onboard-status")) return jsonResponse({ ok: true });
    return jsonResponse({});
  });
}

describe("DiffView", () => {
  it("marks same, added, and removed lines", () => {
    render(<DiffView a={"line one\nold line\n"} b={"line one\nnew line\n"} />);
    const spans = screen.getByTestId("diff-view").querySelectorAll("span");
    const kinds = [...spans].map(s => s.getAttribute("data-diff"));
    expect(kinds).toContain("removed");
    expect(kinds).toContain("added");
    expect(kinds).toContain("same");
  });
});

describe("VersionHistory", () => {
  const versions = [
    { id: 3, chapterNo: 1, versionNo: 3, source: "user_edit", contentMd: "third version content", createdAt: 3000 },
    { id: 2, chapterNo: 1, versionNo: 2, source: "segment_revise", contentMd: "second version", createdAt: 2000 },
    { id: 1, chapterNo: 1, versionNo: 1, source: "ai_write", contentMd: "first version", createdAt: 1000 },
  ];

  it("lists versions in descending order and hides restore for the latest version", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ versions }));
    render(<VersionHistory bookId="b1" chapterNo={1} />);

    await waitFor(() => expect(screen.getByTestId("version-row-3")).toBeInTheDocument());
    expect(screen.queryByTestId("version-restore-3")).not.toBeInTheDocument();
    expect(screen.getByTestId("version-restore-1")).toBeInTheDocument();
  });

  it("restores a selected version through the restore-version endpoint", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ versions }));
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const onRestored = vi.fn();
    render(<VersionHistory bookId="b1" chapterNo={1} onRestored={onRestored} />);

    await waitFor(() => screen.getByTestId("version-restore-1"));
    fetchMock.mockResolvedValueOnce(jsonResponse({ versionNo: 4, restoredFrom: 1 }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ versions }));
    fireEvent.click(screen.getByTestId("version-restore-1"));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(c => (c[1] as RequestInit | undefined)?.method === "POST");
      expect(post?.[0]).toContain("/restore-version");
      expect(JSON.parse((post?.[1] as RequestInit).body as string).versionNo).toBe(1);
    });
    expect(onRestored).toHaveBeenCalledWith("first version");
    confirmSpy.mockRestore();
  });
});

describe("UsageDetailPage", () => {
  it("shows total usage, task usage, chapter usage, and model usage", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("/usage/summary")) {
        return jsonResponse({
          totalUsd: 1.2345,
          byTaskType: [
            { taskType: "write", costUsd: 1.0 },
            { taskType: "audit", costUsd: 0.2345 },
          ],
          byModel: [{ model: "ds-pro", costUsd: 1.2345, promptTokens: 1000, completionTokens: 2000 }],
          byChapter: [{ chapterNo: 1, costUsd: 1.2345 }],
        });
      }
      return jsonResponse({ singleBudgetUsd: 5 });
    });

    render(
      <MemoryRouter initialEntries={["/books/b1/usage"]}>
        <Routes>
          <Route path="/books/:bookId/usage" element={<UsageDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByTestId("usage-total")).toHaveTextContent("$1.2345"));
    expect(screen.getByTestId("usage-task-write")).toHaveTextContent("$1.0000");
    expect(screen.getByText("ds-pro")).toBeInTheDocument();
    expect(screen.getByText("1000")).toBeInTheDocument();
    expect(screen.getByText("2000")).toBeInTheDocument();
  });
});

describe("auto writing agent run", () => {
  function makeManualStream() {
    let sink: ((ev: { type: string; [key: string]: unknown }) => void) | null = null;
    const bodies: unknown[] = [];
    const urls: string[] = [];
    const cancelSpy = vi.fn();
    const streamFn: StreamFn = (opts) => {
      urls.push(opts.url);
      bodies.push(opts.body);
      sink = opts.onEvent;
      return { cancel: cancelSpy, done: Promise.resolve() };
    };
    return {
      streamFn,
      push(ev: { type: string; [key: string]: unknown }) {
        act(() => sink?.(ev));
      },
      lastUrl: () => urls.at(-1) ?? "",
      lastBody: () => bodies.at(-1),
      cancelSpy,
    };
  }

  it("sends multi-chapter writing through the unified agent workflow without client-side intent routing", async () => {
    mockConversationBootstrap();
    const stream = makeManualStream();
    render(<ConversationPane bookId="b1" streamFn={stream.streamFn} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const input = screen.getByTestId("composer-input");
    fireEvent.change(input, { target: { value: "连续写 3 章，长度短" } });
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });

    expect(stream.lastUrl()).toContain("/agent/run");
    expect(stream.lastUrl()).not.toContain("/auto");
    expect(stream.lastBody()).toMatchObject({
      message: "连续写 3 章，长度短",
      source: "chat",
    });
    expect(stream.lastBody()).not.toHaveProperty("target");

    stream.push({ type: "agent_phase", phase: "executing" });
    stream.push({
      type: "agent_progress",
      phase: "executing",
      label: "执行变更",
      status: "running",
      detail: "chapterNo=1, chapterNo=2, chapterNo=3",
    });

    expect(screen.getByTestId("workflow-progress")).toHaveTextContent("chapterNo=1");
    expect(screen.getByTestId("workflow-progress")).toHaveTextContent("chapterNo=2");
    expect(screen.getByTestId("workflow-progress")).toHaveTextContent("chapterNo=3");
  });

  it("cancel aborts the current agent stream without calling legacy /auto/cancel", async () => {
    mockConversationBootstrap();
    const stream = makeManualStream();
    render(<ConversationPane bookId="b1" streamFn={stream.streamFn} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const input = screen.getByTestId("composer-input");
    fireEvent.change(input, { target: { value: "连续写 2 章" } });
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    stream.push({ type: "agent_phase", phase: "executing" });
    fireEvent.click(screen.getByTestId("btn-cancel-stream"));

    expect(stream.cancelSpy).toHaveBeenCalled();
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(c => String(c[0]).includes("/auto/cancel"))).toBe(false);
    });
  });
});



