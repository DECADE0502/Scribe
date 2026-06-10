import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import { ChapterEditor } from "../../src/components/editor/chapter-editor.js";

const chapter = { chapterNo: 1, title: "第一章 初见", content: "# 初见\n\n云雾之间。" };

function renderEditor(onSave = vi.fn(), throttleMs = 50) {
  let editor: Editor | null = null;
  const utils = render(
    <ChapterEditor
      chapter={chapter}
      onSave={onSave}
      throttleMs={throttleMs}
      onEditorReady={(e) => { editor = e; }}
    />,
  );
  return { ...utils, onSave, getEditor: () => editor };
}

describe("ChapterEditor", () => {
  it("渲染标题与初始内容", async () => {
    renderEditor();
    expect(screen.getByTestId("chapter-title")).toHaveTextContent("第一章 初见");
    await waitFor(() => {
      expect(document.querySelector(".ProseMirror")).toBeTruthy();
    });
    expect(document.body.textContent).toContain("云雾之间");
  });

  it("显示字数统计", async () => {
    renderEditor();
    await waitFor(() => {
      const el = screen.getByTestId("char-count");
      expect(el.textContent).toMatch(/\d+ 字/);
    });
  });

  it("编辑后节流触发 onSave,内容为 markdown", async () => {
    const onSave = vi.fn();
    const { getEditor } = renderEditor(onSave, 30);
    await waitFor(() => expect(getEditor()).toBeTruthy());
    act(() => {
      getEditor()!.commands.insertContentAt(getEditor()!.state.doc.content.size, "<p>新增段落</p>");
    });
    await waitFor(() => expect(onSave).toHaveBeenCalled(), { timeout: 2000 });
    const savedMd = onSave.mock.calls[0]![0] as string;
    expect(savedMd).toContain("新增段落");
    expect(savedMd).toContain("# 初见");
  });

  it("节流窗口内多次编辑只保存一次", async () => {
    const onSave = vi.fn();
    const { getEditor } = renderEditor(onSave, 80);
    await waitFor(() => expect(getEditor()).toBeTruthy());
    act(() => {
      const ed = getEditor()!;
      ed.commands.insertContentAt(ed.state.doc.content.size, "<p>一</p>");
      ed.commands.insertContentAt(ed.state.doc.content.size, "<p>二</p>");
      ed.commands.insertContentAt(ed.state.doc.content.size, "<p>三</p>");
    });
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1), { timeout: 2000 });
    // 最后一次的内容包含全部三段
    const savedMd = onSave.mock.calls[0]![0] as string;
    expect(savedMd).toContain("一");
    expect(savedMd).toContain("三");
  });
});
