import type { Database } from "better-sqlite3";
import {
  type ConversationMessage,
  type ConversationRole,
  ConversationMessageSchema,
} from "@scribe/shared";
import { parseNullableObject } from "../json-utils.js";

export interface AppendConversationInput {
  role: ConversationRole;
  content: string;
  metadata?: Record<string, unknown> | null;
}

export function createConversationsRepo(db: Database) {
  const rowToMessage = (r: any): ConversationMessage =>
    ConversationMessageSchema.parse({
      id: r.id,
      role: r.role,
      content: r.content,
      metadata: parseNullableObject(r.metadata),
      createdAt: r.created_at,
    });

  return {
    append(input: AppendConversationInput): ConversationMessage {
      const now = Date.now();
      const meta =
        input.metadata === null || input.metadata === undefined
          ? null
          : JSON.stringify(input.metadata);
      const result = db
        .prepare(
          `INSERT INTO conversations(role,content,metadata,created_at)
                    VALUES(?,?,?,?)`
        )
        .run(input.role, input.content, meta, now);
      const id = Number(result.lastInsertRowid);
      const r = db.prepare("SELECT * FROM conversations WHERE id=?").get(id);
      return rowToMessage(r);
    },
    listLatest(limit: number): ConversationMessage[] {
      return db
        .prepare("SELECT * FROM conversations ORDER BY created_at DESC LIMIT ?")
        .all(limit)
        .map(rowToMessage);
    },
    listSince(timestamp: number): ConversationMessage[] {
      return db
        .prepare(
          "SELECT * FROM conversations WHERE created_at > ? ORDER BY created_at ASC"
        )
        .all(timestamp)
        .map(rowToMessage);
    },
    countAll(): number {
      const r = db.prepare("SELECT COUNT(*) AS n FROM conversations").get() as
        | { n: number }
        | undefined;
      return r?.n ?? 0;
    },
  };
}
