import { create } from "zustand";

export interface ToolEvent {
  kind: "start" | "end";
  toolName: string;
  payload?: unknown;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  reasoning?: string;
  toolEvents?: ToolEvent[];
  error?: { message: string; errorClass: string };
}

export interface StreamingState {
  id: string;
  text: string;
  reasoning: string;
  toolEvents: ToolEvent[];
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
  appendUserMessage(content: string): void;
  appendSystemMessage(content: string): void;
  beginStream(id: string): void;
  appendDelta(delta: string): void;
  appendReasoning(delta: string): void;
  pushToolEvent(ev: ToolEvent): void;
  finishStream(): void;
  setError(message: string, errorClass: string): void;
  clearError(): void;
  setAutoStatus(status: AutoStatus | null): void;
  reset(): void;
}

let seq = 0;
const nextId = () => `m${++seq}-${Date.now()}`;

export const useConversationStore = create<ConversationStore>((set, get) => ({
  messages: [],
  streaming: null,
  error: null,
  autoStatus: null,

  appendUserMessage(content) {
    set(s => ({ messages: [...s.messages, { id: nextId(), role: "user", content }] }));
  },

  appendSystemMessage(content) {
    set(s => ({ messages: [...s.messages, { id: nextId(), role: "system", content }] }));
  },

  beginStream(id) {
    set({ streaming: { id, text: "", reasoning: "", toolEvents: [] }, error: null });
  },

  appendDelta(delta) {
    set(s => s.streaming
      ? { streaming: { ...s.streaming, text: s.streaming.text + delta } }
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

  finishStream() {
    const { streaming } = get();
    if (!streaming) return;
    const msg: ChatMessage = {
      id: streaming.id,
      role: "assistant",
      content: streaming.text,
      reasoning: streaming.reasoning || undefined,
      toolEvents: streaming.toolEvents.length ? streaming.toolEvents : undefined,
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

  reset() {
    set({ messages: [], streaming: null, error: null, autoStatus: null });
  },
}));
