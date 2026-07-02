import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { EditorPane } from "../../src/components/editor/editor-pane.js";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(data: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => data } as Response;
}

const ch1 = { chapterNo: 1, title: "第一章", content: "# 第一章\n\n正文内容。", wordCount: 4 };
const ch2 = { chapterNo: 2, title: "第二章", content: "第二章内容。", wordCount: 5 };

describe("EditorPane", () => {
  it("无章节:显示自然语言写作引导", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ chapters: [] }));
    render(<EditorPane bookId="b1" />);
    await waitFor(() => expect(screen.getByTestId("editor-empty")).toBeInTheDocument());
    expect(screen.getByText(/自然语言请求|第一章/)).toBeInTheDocument();
    expect(screen.getByTestId("chapter-new")).toBeInTheDocument();
  });

  it("有章节:章节条 + 默认选中最后一章 + 加载编辑器", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.endsWith("/chapters")) return jsonResponse({ chapters: [ch1, ch2] });
      if (u.endsWith("/chapters/2")) return jsonResponse(ch2);
      if (u.endsWith("/chapters/1")) return jsonResponse(ch1);
      return jsonResponse({}, 404);
    });
    render(<EditorPane bookId="b1" />);
    await waitFor(() => expect(screen.getByTestId("chapter-tab-2")).toBeInTheDocument());
    expect(screen.getByTestId("chapter-tab-2")).toHaveClass("active");
    await waitFor(() => expect(screen.getByTestId("chapter-editor")).toBeInTheDocument());
    expect(screen.getByTestId("chapter-title")).toHaveTextContent("第二章");
  });

  it("点章节 chip 切换章节", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.endsWith("/chapters")) return jsonResponse({ chapters: [ch1, ch2] });
      if (u.endsWith("/chapters/2")) return jsonResponse(ch2);
      if (u.endsWith("/chapters/1")) return jsonResponse(ch1);
      return jsonResponse({}, 404);
    });
    render(<EditorPane bookId="b1" />);
    await waitFor(() => screen.getByTestId("chapter-tab-1"));
    fireEvent.click(screen.getByTestId("chapter-tab-1"));
    await waitFor(() => expect(screen.getByTestId("chapter-title")).toHaveTextContent("第一章"));
  });

  it("点 + 新建章节(PUT 下一号)", async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      calls.push([String(url), init]);
      const u = String(url);
      if (init?.method === "PUT") return jsonResponse({ versionNo: 1 });
      if (u.endsWith("/chapters")) return jsonResponse({ chapters: [ch1] });
      if (u.endsWith("/chapters/1")) return jsonResponse(ch1);
      if (u.endsWith("/chapters/2")) return jsonResponse(ch2);
      return jsonResponse({}, 404);
    });
    render(<EditorPane bookId="b1" />);
    await waitFor(() => screen.getByTestId("chapter-new"));
    fireEvent.click(screen.getByTestId("chapter-new"));
    await waitFor(() => {
      const put = calls.find(c => c[1]?.method === "PUT");
      expect(put).toBeTruthy();
      expect(put![0]).toContain("/chapters/2"); // max(1) + 1
    });
  });

  it("历史按钮切换 VersionHistory 视图", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes("/versions")) return jsonResponse({ versions: [] });
      if (u.endsWith("/chapters")) return jsonResponse({ chapters: [ch1] });
      if (u.endsWith("/chapters/1")) return jsonResponse(ch1);
      return jsonResponse({}, 404);
    });
    render(<EditorPane bookId="b1" />);
    await waitFor(() => screen.getByTestId("btn-history"));
    fireEvent.click(screen.getByTestId("btn-history"));
    await waitFor(() => expect(screen.getByTestId("version-history")).toBeInTheDocument());
  });

  it("重写当前章通过 agent/run 提交当前章节目标,不新开下一章", async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    vi.spyOn(window, "prompt").mockReturnValue("重写这一章");
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      calls.push([String(url), init]);
      const u = String(url);
      if (init?.method === "POST" && u.includes("/agent/run")) {
        return {
          ok: true,
          body: new ReadableStream({ start(ctrl) { ctrl.close(); } }),
        } as Response;
      }
      if (u.endsWith("/chapters")) return jsonResponse({ chapters: [ch1, ch2] });
      if (u.endsWith("/chapters/2")) return jsonResponse(ch2);
      if (u.endsWith("/chapters/1")) return jsonResponse(ch1);
      return jsonResponse({}, 404);
    });
    render(<EditorPane bookId="b1" />);
    await waitFor(() => screen.getByTestId("chapter-tab-2"));
    fireEvent.click(screen.getByTestId("chapter-tab-1"));
    await waitFor(() => expect(screen.getByTestId("chapter-title")).toHaveTextContent("第一章"));

    fireEvent.click(screen.getByTestId("btn-rewrite-current"));

    await waitFor(() => {
      const agentRun = calls.find(([url, init]) => init?.method === "POST" && url.includes("/agent/run"));
      expect(agentRun).toBeTruthy();
      expect(agentRun![0]).toContain("/books/b1/agent/run");
      expect(JSON.parse(String(agentRun![1]?.body))).toMatchObject({
        source: "editor",
        target: { chapterNo: 1, mode: "rewrite" },
      });
    });
  });

  it("does not expose legacy draft/finalize editor controls", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.endsWith("/chapters")) return jsonResponse({ chapters: [ch1] });
      if (u.endsWith("/chapters/1")) return jsonResponse(ch1);
      return jsonResponse({}, 404);
    });

    render(<EditorPane bookId="b1" />);

    await waitFor(() => screen.getByTestId("chapter-tab-1"));
    expect(screen.queryByTestId("btn-write-draft")).toBeNull();
    expect(screen.queryByTestId("btn-finalize")).toBeNull();
    expect(screen.getByTestId("btn-write-next")).toBeInTheDocument();
  });

  it("does not refresh chapters when agent run finishes without commit", async () => {
    vi.spyOn(window, "prompt").mockReturnValue("rewrite current chapter");
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (init?.method === "POST" && u.includes("/agent/run")) {
        const payload = `event: done\ndata: ${JSON.stringify({ type: "done", committed: false })}\n\n`;
        return {
          ok: true,
          body: new ReadableStream({
            start(ctrl) {
              ctrl.enqueue(new TextEncoder().encode(payload));
              ctrl.close();
            },
          }),
        } as Response;
      }
      if (u.endsWith("/chapters")) return jsonResponse({ chapters: [ch1, ch2] });
      if (u.endsWith("/chapters/2")) return jsonResponse(ch2);
      if (u.endsWith("/chapters/1")) return jsonResponse(ch1);
      return jsonResponse({}, 404);
    });

    render(<EditorPane bookId="b1" />);
    await waitFor(() => screen.getByTestId("chapter-tab-2"));
    fetchMock.mockClear();

    fireEvent.click(screen.getByTestId("btn-rewrite-current"));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url, init]) => (
        init?.method === "POST" && String(url).includes("/agent/run")
      ))).toBe(true);
    });
    expect(fetchMock.mock.calls.some(([url, init]) => (
      init?.method !== "POST" && String(url).endsWith("/chapters")
    ))).toBe(false);
  });

  it("committed=true reloads chapter list (no staging approve step)", async () => {
    vi.spyOn(window, "prompt").mockReturnValue("write next chapter");
    const calls: Array<[string, RequestInit | undefined]> = [];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      calls.push([String(url), init]);
      const u = String(url);
      if (init?.method === "POST" && u.includes("/agent/run")) {
        const payload = [
          `event: text_delta\ndata: ${JSON.stringify({ type: "text_delta", delta: "正文……" })}\n\n`,
          `event: done\ndata: ${JSON.stringify({ type: "done", committed: true })}\n\n`,
        ].join("");
        return {
          ok: true,
          body: new ReadableStream({
            start(ctrl) {
              ctrl.enqueue(new TextEncoder().encode(payload));
              ctrl.close();
            },
          }),
        } as Response;
      }
      if (u.endsWith("/chapters")) return jsonResponse({ chapters: [ch1, ch2] });
      if (u.endsWith("/chapters/2")) return jsonResponse(ch2);
      if (u.endsWith("/chapters/1")) return jsonResponse(ch1);
      return jsonResponse({}, 404);
    });

    render(<EditorPane bookId="b1" />);
    await waitFor(() => screen.getByTestId("chapter-tab-2"));
    calls.length = 0;

    fireEvent.click(screen.getByTestId("btn-write-next"));

    // done.committed=true → 直接刷新章节列表;不存在 approve/cancel 二段提交端点
    await waitFor(() => {
      expect(calls.some(([url, init]) => (
        init?.method !== "POST" && url.endsWith("/chapters")
      ))).toBe(true);
    });
    expect(calls.some(([url]) => url.includes("/agent/runs/"))).toBe(false);
  });
});


