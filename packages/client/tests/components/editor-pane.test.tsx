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
  it("无章节:显示空状态引导(含 /write 提示)", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ chapters: [] }));
    render(<EditorPane bookId="b1" />);
    await waitFor(() => expect(screen.getByTestId("editor-empty")).toBeInTheDocument());
    expect(screen.getByText(/\/write/)).toBeInTheDocument();
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
});
