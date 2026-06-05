import { z } from "zod";
export const ForeshadowingStatusSchema = z.enum(["active", "paid", "dropped"]);
export const ForeshadowingSchema = z.object({
  id: z.string(),
  label: z.string().min(1),
  description: z.string().nullable(),
  plantedChapter: z.number().int().nullable(),
  paidChapter: z.number().int().nullable(),
  status: ForeshadowingStatusSchema,
  relatedCharacters: z.array(z.string()),
});
export type Foreshadowing = z.infer<typeof ForeshadowingSchema>;
export type ForeshadowingStatus = z.infer<typeof ForeshadowingStatusSchema>;
export const NewForeshadowingSchema = ForeshadowingSchema.omit({ id: true });
export type NewForeshadowing = z.infer<typeof NewForeshadowingSchema>;
