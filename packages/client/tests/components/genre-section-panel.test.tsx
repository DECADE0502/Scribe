import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { DynamicFieldInput, type GenreFieldDef } from "../../src/components/sidebar/dynamic-field-input.js";
import { GenreSectionPanel } from "../../src/components/sidebar/genre-section-panel.js";

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

function Harness(props: { field: GenreFieldDef; initial?: unknown; refOptions?: Parameters<typeof DynamicFieldInput>[0]["refOptions"] }) {
  const [v, setV] = useState<unknown>(props.initial);
  return (
    <>
      <DynamicFieldInput field={props.field} value={v} onChange={setV} refOptions={props.refOptions} />
      <output data-testid="value">{JSON.stringify(v)}</output>
    </>
  );
}

describe("DynamicFieldInput", () => {
  it("string → text input", () => {
    render(<Harness field={{ name: "n", type: "string" }} />);
    const input = screen.getByTestId("field-n");
    expect(input.tagName).toBe("INPUT");
    fireEvent.change(input, { target: { value: "九转金身" } });
    expect(screen.getByTestId("value")).toHaveTextContent("九转金身");
  });

  it("text → textarea", () => {
    render(<Harness field={{ name: "d", type: "text" }} />);
    expect(screen.getByTestId("field-d").tagName).toBe("TEXTAREA");
  });

  it("number → number input,转数字", () => {
    render(<Harness field={{ name: "lv", type: "number" }} />);
    fireEvent.change(screen.getByTestId("field-lv"), { target: { value: "3" } });
    expect(screen.getByTestId("value")).toHaveTextContent("3");
  });

  it("enum 对象式 → select 含 values", () => {
    render(<Harness field={{ name: "tier", type: { kind: "enum", values: ["下品", "上品"] } }} />);
    const select = screen.getByTestId("field-tier");
    expect(select.tagName).toBe("SELECT");
    fireEvent.change(select, { target: { value: "上品" } });
    expect(screen.getByTestId("value")).toHaveTextContent("上品");
  });

  it("ref:character → select 加载角色", () => {
    render(
      <Harness
        field={{ name: "owner", type: "ref:character" }}
        refOptions={{ characters: [{ id: "c1", name: "林尘" }] }}
      />,
    );
    const select = screen.getByTestId("field-owner");
    expect(select).toHaveTextContent("林尘");
    fireEvent.change(select, { target: { value: "c1" } });
    expect(screen.getByTestId("value")).toHaveTextContent("c1");
  });

  it("ref:section:法器 → select 加载该板块条目", () => {
    render(
      <Harness
        field={{ name: "佩剑", type: "ref:section:法器" }}
        refOptions={{ sectionItems: { 法器: [{ id: "i1", label: "青锋剑" }] } }}
      />,
    );
    expect(screen.getByTestId("field-佩剑")).toHaveTextContent("青锋剑");
  });

  it("list:string → 可加可删", () => {
    render(<Harness field={{ name: "tags", type: "list:string" }} initial={["旧"]} />);
    fireEvent.change(screen.getByTestId("field-tags-draft"), { target: { value: "新" } });
    fireEvent.click(screen.getByTestId("field-tags-add"));
    expect(screen.getByTestId("value")).toHaveTextContent('["旧","新"]');
    fireEvent.click(screen.getByTestId("field-tags-remove-0"));
    expect(screen.getByTestId("value")).toHaveTextContent('["新"]');
  });
});

describe("GenreSectionPanel", () => {
  const sectionsPayload = {
    sections: [{
      section: {
        id: "s1",
        name: "功法体系",
        schema: [
          { name: "name", type: "string", required: true },
          { name: "tier", type: { kind: "enum", values: ["下品", "上品"] } },
        ],
      },
      items: [
        { id: "i1", sectionId: "s1", data: { name: "九转金身", tier: "上品" } },
      ],
    }],
  };

  function mockInitialLoad() {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("/genre-sections")) return jsonResponse(sectionsPayload);
      if (String(url).includes("/characters")) return jsonResponse({ characters: [] });
      return jsonResponse({}, 404);
    });
  }

  it("渲染条目 + schema 字段只读视图", async () => {
    mockInitialLoad();
    render(<GenreSectionPanel bookId="b1" sectionId="s1" />);
    await waitFor(() => expect(screen.getByText("九转金身")).toBeInTheDocument());
    expect(screen.getByTestId("genre-item-i1")).toHaveTextContent("上品");
  });

  it("按通用 displayFields 渲染条目标题,不靠第一个字段", async () => {
    const genericPayload = {
      sections: [{
        section: {
          id: "s1",
          name: "任意集合",
          identityFields: ["代号"],
          displayFields: ["展示"],
          searchFields: ["代号", "展示", "说明"],
          schema: [
            { name: "代号", type: "string", required: true, role: "identity" },
            { name: "展示", type: "string" },
            { name: "说明", type: "text", role: "summary" },
          ],
        },
        items: [
          { id: "i1", sectionId: "s1", data: { 代号: "A-1", 展示: "一号", 说明: "说明文本" } },
        ],
      }],
    };
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("/genre-sections")) return jsonResponse(genericPayload);
      if (String(url).includes("/characters")) return jsonResponse({ characters: [] });
      return jsonResponse({}, 404);
    });

    render(<GenreSectionPanel bookId="b1" sectionId="s1" />);

    await waitFor(() => expect(screen.getByText("一号")).toBeInTheDocument());
    const item = screen.getByTestId("genre-item-i1");
    expect(item.querySelector("strong")?.textContent).toBe("一号");
    expect(item).toHaveTextContent("说明文本");
  });

  it("点添加显示动态表单,提交发 POST", async () => {
    mockInitialLoad();
    render(<GenreSectionPanel bookId="b1" sectionId="s1" />);
    await waitFor(() => screen.getByTestId("genre-item-new"));
    fireEvent.click(screen.getByTestId("genre-item-new"));
    expect(screen.getByTestId("genre-item-form")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("field-name"), { target: { value: "玄阴诀" } });

    const calls: Array<[string, RequestInit | undefined]> = [];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      calls.push([String(url), init]);
      if (init?.method === "POST") return jsonResponse({ id: "i2" }, 201);
      if (String(url).includes("/genre-sections")) return jsonResponse(sectionsPayload);
      return jsonResponse({ characters: [] });
    });
    fireEvent.click(screen.getByTestId("genre-item-submit"));
    await waitFor(() => {
      const post = calls.find(c => c[1]?.method === "POST");
      expect(post).toBeTruthy();
      expect(post![0]).toContain("/genre-sections/s1/items");
      expect(JSON.parse(post![1]!.body as string).data.name).toBe("玄阴诀");
    });
  });

  it("删除板块需输入板块名确认", async () => {
    mockInitialLoad();
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("错误的名字");
    render(<GenreSectionPanel bookId="b1" sectionId="s1" />);
    await waitFor(() => screen.getByTestId("genre-section-delete"));
    fireEvent.click(screen.getByTestId("genre-section-delete"));
    expect(promptSpy).toHaveBeenCalled();
    // 名字不匹配 → 不应发 DELETE
    expect(fetchMock.mock.calls.some(c => (c[1] as RequestInit | undefined)?.method === "DELETE")).toBe(false);
    promptSpy.mockRestore();
  });
});
