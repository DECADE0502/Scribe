import { z } from "zod";
export const KeyEventSchema = z.object({
  event: z.string(),
  characters: z.array(z.string()),
  foreshadowingRefs: z.array(z.string()),
});
export const ChapterSummarySchema = z.object({
  chapterNo: z.number().int(),
  oneLiner: z.string(),
  paragraph: z.string(),
  keyEvents: z.array(KeyEventSchema),
  generatedAt: z.number().int(),
  reasoningContent: z.string().nullable(),
});
export const ChapterVersionSourceSchema = z.enum([
  "ai_write",
  "ai_rewrite",
  "user_edit",
  "segment_revise",
]);
export const ChapterVersionSchema = z.object({
  id: z.number().int(),
  chapterNo: z.number().int(),
  versionNo: z.number().int(),
  source: ChapterVersionSourceSchema,
  contentMd: z.string(),
  createdAt: z.number().int(),
});
export type KeyEvent = z.infer<typeof KeyEventSchema>;
export type ChapterSummary = z.infer<typeof ChapterSummarySchema>;
export type ChapterVersion = z.infer<typeof ChapterVersionSchema>;
export type ChapterVersionSource = z.infer<typeof ChapterVersionSourceSchema>;
