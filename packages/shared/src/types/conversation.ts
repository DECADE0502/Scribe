import { z } from "zod";
export const ConversationRoleSchema = z.enum(["user", "assistant", "system", "tool"]);
export const ConversationMessageSchema = z.object({
  id: z.number().int(),
  role: ConversationRoleSchema,
  content: z.string(),
  metadata: z.record(z.unknown()).nullable(),
  createdAt: z.number().int(),
});
export type ConversationRole = z.infer<typeof ConversationRoleSchema>;
export type ConversationMessage = z.infer<typeof ConversationMessageSchema>;
