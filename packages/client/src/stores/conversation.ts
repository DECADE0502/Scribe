import { create } from "zustand";

export interface ToolEvent {
  kind: "start" | "end";
  toolName: string;
  payload?: unknown;
}

export type WorkflowStageStatus = "pending" | "active" | "done" | "error";

export interface WorkflowStage {
  id: string;
  label: string;
  status: WorkflowStageStatus;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  reasoning?: string;
  toolEvents?: ToolEvent[];
  workflowStages?: WorkflowStage[];
  error?: { message: string; errorClass: string };
}

export interface StreamingState {
  id: string;
  text: string;
  reasoning: string;
  toolEvents: ToolEvent[];
  workflowStages: WorkflowStage[];
  suppressText: boolean;
}

export interface AutoStatus {
  state: string;
  doneCount: number;
  total: number;
  currentChapter?: number;
}

interface ConversationStore {
  messages: ChatMessage[];
  streaming: StreamingState | null;
  error: { message: string; errorClass: string } | null;
  autoStatus: AutoStatus | null;
  /** 章节提交触发器:对话流程写完一章后递增,编辑器监听此值刷新 */
  chapterRefreshTrigger: number;
  libraryRefreshTrigger: number;
  appendUserMessage(content: string): void;
  appendSystemMessage(content: string): void;
  beginStream(id: string): void;
  appendDelta(delta: string): void;
  appendReasoning(delta: string): void;
  pushToolEvent(ev: ToolEvent): void;
  setWorkflowStages(stages: WorkflowStage[]): void;
  startWorkflow(stages: WorkflowStage[]): void;
  updateWorkflowStage(id: string, status: WorkflowStageStatus): void;
  setSuppressText(suppress: boolean): void;
  finishStream(): void;
  setError(message: string, errorClass: string): void;
  clearError(): void;
  setAutoStatus(status: AutoStatus | null): void;
  triggerChapterRefresh(): void;
  triggerLibraryRefresh(): void;
  hydrate(msgs: ChatMessage[]): void;
  reset(): void;
}

let seq = 0;
const nextId = () => `m${++seq}-${Date.now()}`;

export const useConversationStore = create<ConversationStore>((set, get) => ({
  messages: [],
  streaming: null,
  error: null,
  autoStatus: null,
  chapterRefreshTrigger: 0,
  libraryRefreshTrigger: 0,

  appendUserMessage(content) {
    set(s => ({ messages: [...s.messages, { id: nextId(), role: "user", content }] }));
  },

  appendSystemMessage(content) {
    set(s => ({ messages: [...s.messages, { id: nextId(), role: "system", content }] }));
  },

  beginStream(id) {
    set({
      streaming: { id, text: "", reasoning: "", toolEvents: [], workflowStages: [], suppressText: false },
      error: null,
    });
  },

  appendDelta(delta) {
    set(s => s.streaming
      ? { streaming: s.streaming.suppressText
        ? s.streaming
        : { ...s.streaming, text: s.streaming.text + delta } }
      : {});
  },

  appendReasoning(delta) {
    set(s => s.streaming
      ? { streaming: { ...s.streaming, reasoning: s.streaming.reasoning + delta } }
      : {});
  },

  pushToolEvent(ev) {
    set(s => s.streaming
      ? { streaming: { ...s.streaming, toolEvents: [...s.streaming.toolEvents, ev] } }
      : {});
  },

  setWorkflowStages(stages) {
    set(s => s.streaming
      ? { streaming: { ...s.streaming, workflowStages: stages } }
      : {});
  },

  startWorkflow(stages) {
    set(s => s.streaming
      ? { streaming: { ...s.streaming, workflowStages: stages } }
      : {});
  },

  updateWorkflowStage(id, status) {
    set(s => s.streaming
      ? {
        streaming: {
          ...s.streaming,
          workflowStages: s.streaming.workflowStages.map((stage, index, stages) => {
            if (stage.id === id) return { ...stage, status };
            const changedIndex = stages.findIndex(item => item.id === id);
            if (
              status === "done" &&
              changedIndex >= 0 &&
              index === changedIndex + 1 &&
              stage.status === "pending"
            ) {
              return { ...stage, status: "active" };
            }
            return stage;
          }),
        },
      }
      : {});
  },

  setSuppressText(suppress) {
    set(s => s.streaming
      ? { streaming: { ...s.streaming, suppressText: suppress } }
      : {});
  },

  finishStream() {
    const { streaming } = get();
    if (!streaming) return;
    const msg: ChatMessage = {
      id: streaming.id,
      role: "assistant",
      content: streaming.text,
      reasoning: streaming.reasoning || undefined,
      toolEvents: streaming.toolEvents.length ? streaming.toolEvents : undefined,
      workflowStages: streaming.workflowStages.length ? streaming.workflowStages : undefined,
    };
    set(s => ({ messages: [...s.messages, msg], streaming: null }));
  },

  setError(message, errorClass) {
    const { streaming } = get();
    if (streaming && streaming.text) {
      // 已有部分输出:固化为带错误标记的消息
      const msg: ChatMessage = {
        id: streaming.id,
        role: "assistant",
        content: streaming.text,
        workflowStages: streaming.workflowStages.length ? streaming.workflowStages : undefined,
        error: { message, errorClass },
      };
      set(s => ({ messages: [...s.messages, msg], streaming: null, error: { message, errorClass } }));
    } else {
      set({ streaming: null, error: { message, errorClass } });
    }
  },

  clearError() {
    set({ error: null });
  },

  setAutoStatus(status) {
    set({ autoStatus: status });
  },

  triggerChapterRefresh() {
    set(s => ({ chapterRefreshTrigger: s.chapterRefreshTrigger + 1 }));
  },

  triggerLibraryRefresh() {
    set(s => ({ libraryRefreshTrigger: s.libraryRefreshTrigger + 1 }));
  },

  hydrate(msgs) {
    set(s => ({
      messages: s.messages.length === 0 ? msgs : s.messages,
      streaming: s.messages.length === 0 ? null : s.streaming,
      error: s.messages.length === 0 ? null : s.error,
    }));
  },

  reset() {
    set({
      messages: [],
      streaming: null,
      error: null,
      autoStatus: null,
    });
  },
}));
