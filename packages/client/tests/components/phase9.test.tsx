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

describe("DiffView", () => {
  it("行级 diff 标注增删", () => {
    render(<DiffView a={"第一行\n旧的第二行\n"} b={"第一行\n新的第二行\n"} />);
    const spans = screen.getByTestId("diff-view").querySelectorAll("span");
    const kinds = [...spans].map(s => s.getAttribute("data-diff"));
    expect(kinds).toContain("removed");
    expect(kinds).toContain("added");
    expect(kinds).toContain("same");
  });
});

describe("VersionHistory", () => {
  const versions = [
    { id: 3, chapterNo: 1, versionNo: 3, source: "user_edit", contentMd: "第三版正文内容更长", createdAt: 3000 },
    { id: 2, chapterNo: 1, versionNo: 2, source: "segment_revise", contentMd: "第二版正文", createdAt: 2000 },
    { id: 1, chapterNo: 1, versionNo: 1, source: "ai_write", contentMd: "第一版", createdAt: 1000 },
  ];

  it("倒序列出版本,来源中文化", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ versions }));
    render(<VersionHistory bookId="b1" chapterNo={1} />);
    await waitFor(() => expect(screen.getByTestId("version-row-3")).toBeInTheDocument());
    expect(screen.getByTestId("version-row-3")).toHaveTextContent("用户编辑");
    expect(screen.getByTestId("version-row-2")).toHaveTextContent("段落改写");
    expect(screen.getByTestId("version-row-1")).toHaveTextContent("AI 写");
    // 最新版(idx 0)没有回滚按钮,其余有
    expect(screen.queryByTestId("version-restore-3")).not.toBeInTheDocument();
    expect(screen.getByTestId("version-restore-1")).toBeInTheDocument();
  });

  it("回滚发 POST restore-version", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ versions }));
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const onRestored = vi.fn();
    render(<VersionHistory bookId="b1" chapterNo={1} onRestored={onRestored} />);
    await waitFor(() => screen.getByTestId("version-restore-1"));
    fetchMock.mockResolvedValueOnce(jsonResponse({ versionNo: 4, restoredFrom: 1 })); // POST
    fetchMock.mockResolvedValueOnce(jsonResponse({ versions })); // reload
    fireEvent.click(screen.getByTestId("version-restore-1"));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(c => (c[1] as RequestInit | undefined)?.method === "POST");
      expect(post![0]).toContain("/restore-version");
      expect(JSON.parse((post![1] as RequestInit).body as string).versionNo).toBe(1);
    });
    expect(onRestored).toHaveBeenCalledWith("第一版");
    confirmSpy.mockRestore();
  });
});

describe("UsageDetailPage", () => {
  it("显示总览/任务类型/章节/模型", async () => {
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
    expect(screen.getByTestId("usage-task-write")).toHaveTextContent("写作");
    expect(screen.getByText("第 1 章")).toBeInTheDocument();
    expect(screen.getByText("ds-pro")).toBeInTheDocument();
    expect(screen.getByText(/预算上限 \$5/)).toBeInTheDocument();
  });
});

describe("/auto 命令接线", () => {
  function makeManualStream() {
    let sink: ((ev: { type: string; [key: string]: unknown }) => void) | null = null;
    const streamFn: StreamFn = (opts) => {
      sink = opts.onEvent;
      return { cancel: vi.fn(), done: Promise.resolve() };
    };
    return {
      streamFn,
      push(ev: { type: string; [key: string]: unknown }) {
        act(() => sink?.(ev));
      },
      getUrl: () => (streamFn as unknown as { lastUrl?: string }).lastUrl,
    };
  }

  it("/auto 3 → 调 auto 端点,auto_status 显示状态条,critical 暂停追加系统消息", async () => {
    let capturedUrl = "";
    let sink: ((ev: { type: string; [key: string]: unknown }) => void) | null = null;
    const streamFn: StreamFn = (opts) => {
      capturedUrl = opts.url;
      sink = opts.onEvent;
      return { cancel: vi.fn(), done: Promise.resolve() };
    };
    render(<ConversationPane bookId="b1" streamFn={streamFn} />);
    const input = screen.getByTestId("composer-input");
    fireEvent.change(input, { target: { value: "/auto 3" } });
    // 补全弹层打开,先 Escape 关闭再 Ctrl+Enter 发送
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });

    expect(capturedUrl).toContain("/auto");

    act(() => sink?.({ type: "auto_status", state: "writing", remaining: 3, doneChapters: [], currentChapter: 1 }));
    expect(screen.getByTestId("auto-mode-bar")).toHaveTextContent("0/3");
    expect(screen.getByTestId("auto-mode-bar")).toHaveTextContent("第 1 章");

    act(() => sink?.({ type: "auto_status", state: "paused_by_critical", remaining: 2, doneChapters: [1], currentChapter: 2 }));
    await waitFor(() => {
      expect(screen.getByText(/发现严重问题已暂停/)).toBeInTheDocument();
    });
  });

  it("停止按钮调 cancel 端点", async () => {
    let sink: ((ev: { type: string; [key: string]: unknown }) => void) | null = null;
    const streamFn: StreamFn = (opts) => {
      sink = opts.onEvent;
      return { cancel: vi.fn(), done: Promise.resolve() };
    };
    fetchMock.mockResolvedValue(jsonResponse({ cancelled: true }));
    render(<ConversationPane bookId="b1" streamFn={streamFn} />);
    const input = screen.getByTestId("composer-input");
    fireEvent.change(input, { target: { value: "/auto 2" } });
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    act(() => sink?.({ type: "auto_status", state: "writing", remaining: 2, doneChapters: [], currentChapter: 1 }));
    fireEvent.click(screen.getByTestId("auto-stop"));
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(c => String(c[0]).includes("/auto/cancel"))).toBe(true);
    });
  });
});
