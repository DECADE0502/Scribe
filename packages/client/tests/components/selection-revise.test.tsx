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
          chapter={{ chapterNo: 1, title: "Chapter 1", content: "This is selectable content." }}
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

  it("is hidden when there is no selection", async () => {
    await setupWithSelection();
    expect(screen.queryByTestId("selection-toolbar")).not.toBeInTheDocument();
  });

  it("shows actions for selected text and returns the selected text", async () => {
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
    expect(onRevise).toHaveBeenCalledWith("rewrite", expect.stringContaining("This "));
  });
});

describe("actionToInstruction", () => {
  it("maps preset actions to Chinese instructions", () => {
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
    segmentText: "old segment",
    instruction: "make it colder",
  };

  it("sends revision through the unified agent endpoint with structured target", async () => {
    const m = makeManualStream();
    render(<RevisePreview {...baseProps} onAccepted={vi.fn()} onDismiss={vi.fn()} streamFn={m.streamFn} />);

    m.push({ type: "main_output", draft: "new segment", reply: "candidate ready" });
    m.push({ type: "validation_report", verdict: "pass", commitAllowed: false, issues: [] });
    m.push({ type: "done", committed: false, needsUserDecision: true, runId: "r1" });

    await waitFor(() => expect(screen.getByTestId("revise-accept")).toBeEnabled());
    expect(screen.getByTestId("revise-text")).toHaveTextContent("new segment");
  });

  it("does not treat visible reply or legacy text_delta as the revision candidate", async () => {
    const m = makeManualStream();
    render(<RevisePreview {...baseProps} onAccepted={vi.fn()} onDismiss={vi.fn()} streamFn={m.streamFn} />);

    m.push({ type: "text_delta", delta: "legacy candidate" });
    m.push({ type: "main_output", reply: "I prepared a candidate" });
    m.push({ type: "done", committed: false, needsUserDecision: true, runId: "r1" });

    expect(screen.getByTestId("revise-text")).not.toHaveTextContent("legacy candidate");
    expect(screen.getByTestId("revise-text")).not.toHaveTextContent("I prepared a candidate");
    expect(screen.getByTestId("revise-accept")).toBeDisabled();
  });

  it("keeps accept disabled when validation fails or the run is not waiting for a decision", async () => {
    const m = makeManualStream();
    render(<RevisePreview {...baseProps} onAccepted={vi.fn()} onDismiss={vi.fn()} streamFn={m.streamFn} />);

    m.push({ type: "main_output", draft: "new segment" });
    m.push({ type: "validation_report", verdict: "fail", commitAllowed: false, issues: [] });
    m.push({ type: "done", committed: false, needsUserDecision: false, runId: "r1" });

    await waitFor(() => expect(screen.getByTestId("revise-accept")).toBeDisabled());
  });

  it("accept returns the approved candidate without calling legacy apply-revision", async () => {
    const m = makeManualStream();
    const onDismiss = vi.fn();
    const onAccepted = vi.fn();
    render(<RevisePreview {...baseProps} onAccepted={onAccepted} onDismiss={onDismiss} streamFn={m.streamFn} />);

    m.push({ type: "main_output", draft: "new paragraph" });
    m.push({ type: "validation_report", verdict: "pass", commitAllowed: false, issues: [] });
    m.push({ type: "done", committed: false, needsUserDecision: true, runId: "r1" });

    await waitFor(() => expect(screen.getByTestId("revise-accept")).toBeEnabled());
    fireEvent.click(screen.getByTestId("revise-accept"));
    expect(onAccepted).toHaveBeenCalledWith("new paragraph");
    expect(onDismiss).toHaveBeenCalled();
  });

  it("cancel cancels the stream and dismisses the preview", () => {
    const m = makeManualStream();
    const onDismiss = vi.fn();
    render(<RevisePreview {...baseProps} onAccepted={vi.fn()} onDismiss={onDismiss} streamFn={m.streamFn} />);
    fireEvent.click(screen.getByTestId("revise-dismiss"));
    expect(m.cancelSpy).toHaveBeenCalled();
    expect(onDismiss).toHaveBeenCalled();
  });

  it("shows errors from the agent stream", async () => {
    const m = makeManualStream();
    render(<RevisePreview {...baseProps} onAccepted={vi.fn()} onDismiss={vi.fn()} streamFn={m.streamFn} />);
    m.push({ type: "error", errorClass: "segment_not_found", message: "selected segment does not match" });
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("does not match"));
  });
});
