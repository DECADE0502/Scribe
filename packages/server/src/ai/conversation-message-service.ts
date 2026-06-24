import type { ConversationRole } from "@scribe/shared";
import type { createConversationsRepo } from "../db/repositories/conversations.js";

export type ConversationMessageKind =
  | "user_visible"
  | "assistant_visible"
  | "agent_progress_summary"
  | "manual_asset_change"
  | "hidden_draft"
  | "hidden_prompt"
  | "system_note";

export interface ConversationMessageService {
  recordUserVisible(content: string, metadata?: Record<string, unknown>): void;
  recordAssistantVisible(content: string, metadata?: Record<string, unknown>): void;
  recordAgentProgressSummary(content: string, metadata?: Record<string, unknown>): void;
  recordManualAssetChange(input: {
    content: string;
    target: string;
    id?: string;
    metadata?: Record<string, unknown>;
  }): void;
  recordHiddenDraft(content: string, metadata?: Record<string, unknown>): void;
  recordHiddenPrompt(content: string, metadata?: Record<string, unknown>): void;
  recordSystemNote(content: string, metadata?: Record<string, unknown>): void;
}

type ConversationsRepo = ReturnType<typeof createConversationsRepo>;

export function createConversationMessageService(
  repo: ConversationsRepo,
): ConversationMessageService {
  const append = (
    role: ConversationRole,
    kind: ConversationMessageKind,
    content: string,
    metadata: Record<string, unknown> = {},
  ): void => {
    repo.append({
      role,
      content,
      metadata: { ...metadata, kind },
    });
  };

  return {
    recordUserVisible(content, metadata) {
      append("user", "user_visible", content, metadata);
    },
    recordAssistantVisible(content, metadata) {
      append("assistant", "assistant_visible", content, metadata);
    },
    recordAgentProgressSummary(content, metadata) {
      append("assistant", "agent_progress_summary", content, metadata);
    },
    recordManualAssetChange(input) {
      append("system", "manual_asset_change", input.content, {
        ...(input.metadata ?? {}),
        target: input.target,
        ...(input.id ? { id: input.id } : {}),
      });
    },
    recordHiddenDraft(content, metadata) {
      append("assistant", "hidden_draft", content, metadata);
    },
    recordHiddenPrompt(content, metadata) {
      append("user", "hidden_prompt", content, metadata);
    },
    recordSystemNote(content, metadata) {
      append("system", "system_note", content, metadata);
    },
  };
}
