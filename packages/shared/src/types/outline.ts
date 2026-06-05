import { z } from "zod";
export const OutlineLevelSchema = z.enum(["volume", "arc", "chapter"]);
export const OutlineStatusSchema = z.enum(["planned", "in_progress", "done"]);
export const OutlineNodeSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  level: OutlineLevelSchema,
  title: z.string(),
  summary: z.string().nullable(),
  status: OutlineStatusSchema,
  sortOrder: z.number().int(),
  metadata: z.record(z.unknown()).nullable(),
});
export type OutlineNode = z.infer<typeof OutlineNodeSchema>;
export type OutlineLevel = z.infer<typeof OutlineLevelSchema>;
export type OutlineStatus = z.infer<typeof OutlineStatusSchema>;
export const NewOutlineNodeSchema = OutlineNodeSchema.omit({ id: true });
export type NewOutlineNode = z.infer<typeof NewOutlineNodeSchema>;
