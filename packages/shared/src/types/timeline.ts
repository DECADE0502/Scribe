import { z } from "zod";
export const TimelineEventSchema = z.object({
  id: z.string(),
  chapterNo: z.number().int(),
  storyTime: z.string(),
  event: z.string(),
  participants: z.array(z.string()),
});
export type TimelineEvent = z.infer<typeof TimelineEventSchema>;
export const NewTimelineEventSchema = TimelineEventSchema.omit({ id: true });
export type NewTimelineEvent = z.infer<typeof NewTimelineEventSchema>;
