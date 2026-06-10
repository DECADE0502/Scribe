import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { SidePanel } from "../../src/components/sidebar/side-panel.js";
import { CharactersPanel } from "../../src/components/sidebar/characters-panel.js";
import { OutlinePanel } from "../../src/components/sidebar/outline-panel.js";
import { ForeshadowingPanel } from "../../src/components/sidebar/foreshadowing-panel.js";
import { TimelinePanel } from "../../src/components/sidebar/timeline-panel.js";
import { RulesPanel } from "../../src/components/sidebar/rules-panel.js";

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

describe("SidePanel 容器", () => {
  it("默认显示角色 tab,可切换", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ characters: [], outline: [], foreshadowing: [], timeline: [], content: "" }));
    render(<SidePanel bookId="b1" />);
    await waitFor(() => expect(screen.getByTestId("characters-panel")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("tab-rules"));
    await waitFor(() => expect(screen.getByTestId("rules-panel")).toBeInTheDocument());
    expect(screen.queryByTestId("characters-panel")).not.toBeInTheDocument();
  });
});

describe("CharactersPanel", () => {
  const linchen = {
    id: "c1", name: "林尘", role: "protagonist",
    baseData: { background: "弃婴" }, currentState: { 位置: "云上城" },
    appearances: [{ chapterNo: 1, brief: "初登场" }],
  };

  it("空状态", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ characters: [] }));
    render(<CharactersPanel bookId="b1" />);
    await waitFor(() => expect(screen.getByTestId("characters-empty")).toBeInTheDocument());
  });

  it("渲染角色卡,点开展开详情", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ characters: [linchen] }));
    render(<CharactersPanel bookId="b1" />);
    await waitFor(() => expect(screen.getByText("林尘")).toBeInTheDocument());
    expect(screen.getByText("主角")).toBeInTheDocument();
    fireEvent.click(screen.getByText("林尘"));
    expect(screen.getByTestId("character-detail-c1")).toHaveTextContent("弃婴");
    expect(screen.getByTestId("character-detail-c1")).toHaveTextContent("云上城");
    expect(screen.getByTestId("character-detail-c1")).toHaveTextContent("第1章");
  });

  it("编辑名字发 PUT", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ characters: [linchen] })); // 初始
    render(<CharactersPanel bookId="b1" />);
    await waitFor(() => screen.getByTestId("character-edit-c1"));
    fireEvent.click(screen.getByTestId("character-edit-c1"));
    fireEvent.change(screen.getByTestId("character-name-input-c1"), { target: { value: "林二尘" } });
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "c1", name: "林二尘" })); // PUT
    fetchMock.mockResolvedValueOnce(jsonResponse({ characters: [{ ...linchen, name: "林二尘" }] })); // reload
    fireEvent.click(screen.getByTestId("character-save-c1"));
    await waitFor(() => expect(screen.getByText("林二尘")).toBeInTheDocument());
    const putCall = fetchMock.mock.calls.find(c => (c[1] as RequestInit | undefined)?.method === "PUT");
    expect(putCall![0]).toContain("/characters/c1");
  });
});

describe("OutlinePanel", () => {
  it("树状渲染 + 折叠", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      outline: [
        { id: "v1", parentId: null, level: "volume", title: "卷一", summary: "重生", status: "in_progress", sortOrder: 0 },
        { id: "a1", parentId: "v1", level: "arc", title: "弧 1.1", summary: null, status: "planned", sortOrder: 0 },
      ],
    }));
    render(<OutlinePanel bookId="b1" />);
    await waitFor(() => expect(screen.getByText("卷一")).toBeInTheDocument());
    expect(screen.getByText("弧 1.1")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("outline-toggle-v1"));
    expect(screen.queryByText("弧 1.1")).not.toBeInTheDocument();
  });
});

describe("ForeshadowingPanel", () => {
  it("active 默认显示,paid 折叠;添加发 POST", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      foreshadowing: [
        { id: "f1", label: "黑剑", description: "出处不明", plantedChapter: 1, paidChapter: null, status: "active", relatedCharacters: ["林尘"] },
        { id: "f2", label: "旧账", description: null, plantedChapter: 2, paidChapter: 5, status: "paid", relatedCharacters: [] },
      ],
    }));
    render(<ForeshadowingPanel bookId="b1" />);
    await waitFor(() => expect(screen.getByText("[黑剑]")).toBeInTheDocument());
    expect(screen.queryByText("[旧账]")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("toggle-paid"));
    expect(screen.getByText("[旧账]")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("new-foreshadowing-label"), { target: { value: "新伏笔" } });
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "f3" }, 201)); // POST
    fetchMock.mockResolvedValueOnce(jsonResponse({ foreshadowing: [] })); // reload
    fireEvent.click(screen.getByTestId("add-foreshadowing"));
    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(c => (c[1] as RequestInit | undefined)?.method === "POST");
      expect(postCall).toBeTruthy();
      expect(JSON.parse((postCall![1] as RequestInit).body as string).label).toBe("新伏笔");
    });
  });
});

describe("TimelinePanel", () => {
  it("按章分组", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      timeline: [
        { id: "t1", chapterNo: 2, storyTime: "次日", event: "进城", participants: ["林尘"] },
        { id: "t2", chapterNo: 1, storyTime: "黎明", event: "出发", participants: [] },
      ],
    }));
    render(<TimelinePanel bookId="b1" />);
    await waitFor(() => expect(screen.getByTestId("timeline-chapter-1")).toBeInTheDocument());
    const chapters = screen.getAllByText(/^第 \d 章$/).map(el => el.textContent);
    expect(chapters).toEqual(["第 1 章", "第 2 章"]);
  });
});

describe("RulesPanel", () => {
  it("显示内容,编辑后保存发 PUT + 显示已保存", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ content: "## 旧规则" }));
    render(<RulesPanel bookId="b1" />);
    await waitFor(() => expect(screen.getByTestId("rules-content")).toHaveTextContent("旧规则"));

    fireEvent.click(screen.getByTestId("rules-edit"));
    fireEvent.change(screen.getByTestId("rules-textarea"), { target: { value: "## 新规则" } });
    fetchMock.mockResolvedValueOnce(jsonResponse({ bytes: 10 })); // PUT
    fireEvent.click(screen.getByTestId("rules-save"));
    await waitFor(() => expect(screen.getByTestId("rules-saved-tip")).toBeInTheDocument());
    expect(screen.getByTestId("rules-content")).toHaveTextContent("新规则");
    const putCall = fetchMock.mock.calls.find(c => (c[1] as RequestInit | undefined)?.method === "PUT");
    expect(putCall![0]).toContain("/rules");
  });
});
