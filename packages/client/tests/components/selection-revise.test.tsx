import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import { ChapterEditor } from "../../src/components/editor/chapter-editor.js";
import { SelectionToolbar, actionToInstruction } from "../../src/components/editor/selection-toolbar.js";
import { RevisePreview, type StreamFn } from "../../src/components/editor/revise-preview.js";

function makeManualStream() {
  let sink: ((ev: { type: string; [key: string]: unknown }) => void) | null = null;
  const cancelSpy = vi.fn();
  const streamFn: StreamFn = (opts) => {
    sink = opts.onEvent;
    return { cancel: cancelSpy, done: Promise.resolve() };
  };
  return {
    streamFn,
    cancelSpy,
    push(ev: { type: string; [key: string]: unknown }) {
      act(() => sink?.(ev));
    },
  };
}

describe("SelectionToolbar", () => {
  function Harness(props: { onRevise: (a: string, t: string) => void; expose: (e: Editor) => void }) {
    const [editor, setEditor] = useState<Editor | null>(null);
    return (
      <>
        <ChapterEditor
          chapter={{ chapterNo: 1, title: "第一章", content: "这是一段可以选中的正文内容。" }}
          onSave={vi.fn()}
          onEditorReady={(e) => { setEditor(e); props.expose(e); }}
        />
        <SelectionToolbar editor={editor} onRevise={props.onRevise} />
      </>
    );
  }

  async function setupWithSelection() {
    let editor: Editor | null = null;
    const onRevise = vi.fn();
    render(<Harness onRevise={onRevise} expose={(e) => { editor = e; }} />);
    await waitFor(() => expect(editor).toBeTruthy());
    return { getEditor: () => editor!, onRevise };
  }

  it("无选区时不显示", async () => {
    await setupWithSelection();
    expect(screen.queryByTestId("selection-toolbar")).not.toBeInTheDocument();
  });

  it("选中文本后显示 4 个按钮,点击回传选中文本", async () => {
    const { getEditor, onRevise } = await setupWithSelection();
    act(() => {
      getEditor().commands.setTextSelection({ from: 1, to: 6 });
    });
    await waitFor(() => expect(screen.getByTestId("selection-toolbar")).toBeInTheDocument());
    expect(screen.getByTestId("revise-rewrite")).toBeInTheDocument();
    expect(screen.getByTestId("revise-simplify")).toBeInTheDocument();
    expect(screen.getByTestId("revise-intensify")).toBeInTheDocument();
    expect(screen.getByTestId("revise-custom")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("revise-rewrite"));
    expect(onRevise).toHaveBeenCalledWith("rewrite", expect.stringContaining("这是一段"));
  });
});

describe("actionToInstruction", () => {
  it("预设动作映射中文指令", () => {
    expect(actionToInstruction("rewrite")).toContain("改写");
    expect(actionToInstruction("simplify")).toContain("简化");
    expect(actionToInstruction("intensify")).toContain("情绪");
    expect(actionToInstruction("custom", "自由发挥")).toBe("自由发挥");
  });
});

describe("RevisePreview", () => {
  const baseProps = {
    bookId: "b1",
    chapterNo: 1,
    segmentText: "旧段落",
    instruction: "更冷峻",
  };

  it("流式渲染 → done 后接受按钮可用", async () => {
    const m = makeManualStream();
    render(
      <RevisePreview {...baseProps} onAccepted={vi.fn()} onDismiss={vi.fn()} streamFn={m.streamFn} />,
    );
    expect(screen.getByTestId("revise-accept")).toBeDisabled();
    m.push({ type: "text_delta", delta: "新的" });
    m.push({ type: "text_delta", delta: "段落" });
    expect(screen.getByTestId("revise-text")).toHaveTextContent("新的段落");
    m.push({ type: "done" });
    await waitFor(() => expect(screen.getByTestId("revise-accept")).toBeEnabled());
  });

  it("接受 → POST apply-revision → onAccepted 收到新全文", async () => {
    const m = makeManualStream();
    const onAccepted = vi.fn();
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ versionNo: 2, content: "整章替换后的内容" }),
    } as Response);
    render(
      <RevisePreview
        {...baseProps}
        onAccepted={onAccepted}
        onDismiss={vi.fn()}
        streamFn={m.streamFn}
        fetchFn={fetchFn as unknown as typeof fetch}
      />,
    );
    m.push({ type: "text_delta", delta: "新的段落" });
    m.push({ type: "done" });
    await waitFor(() => expect(screen.getByTestId("revise-accept")).toBeEnabled());
    fireEvent.click(screen.getByTestId("revise-accept"));
    await waitFor(() => expect(onAccepted).toHaveBeenCalledWith("整章替换后的内容"));
    const call = fetchFn.mock.calls[0]!;
    expect(call[0]).toContain("/apply-revision");
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({
      segmentText: "旧段落",
      newSegment: "新的段落",
    });
  });

  it("取消按钮:cancel 流并 onDismiss", () => {
    const m = makeManualStream();
    const onDismiss = vi.fn();
    render(
      <RevisePreview {...baseProps} onAccepted={vi.fn()} onDismiss={onDismiss} streamFn={m.streamFn} />,
    );
    fireEvent.click(screen.getByTestId("revise-dismiss"));
    expect(m.cancelSpy).toHaveBeenCalled();
    expect(onDismiss).toHaveBeenCalled();
  });

  it("error 事件显示错误", async () => {
    const m = makeManualStream();
    render(
      <RevisePreview {...baseProps} onAccepted={vi.fn()} onDismiss={vi.fn()} streamFn={m.streamFn} />,
    );
    m.push({ type: "error", errorClass: "segment_not_found", message: "选中的段落与章节内容不匹配" });
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("不匹配"));
  });
});
