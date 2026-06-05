import { z } from "zod";
export const CharacterAppearanceSchema = z.object({
  chapterNo: z.number().int(),
  brief: z.string(),
});
export const CharacterSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  role: z.enum(["protagonist", "antagonist", "supporting"]).nullable(),
  baseData: z.record(z.unknown()),
  currentState: z.record(z.unknown()),
  appearances: z.array(CharacterAppearanceSchema),
  updatedAt: z.number().int(),
});
export type Character = z.infer<typeof CharacterSchema>;
export type CharacterAppearance = z.infer<typeof CharacterAppearanceSchema>;
export const NewCharacterInputSchema = z.object({
  name: z.string().min(1),
  role: z.enum(["protagonist", "antagonist", "supporting"]).nullable().optional(),
  baseData: z.record(z.unknown()).optional(),
  currentState: z.record(z.unknown()).optional(),
});
export type NewCharacterInput = z.infer<typeof NewCharacterInputSchema>;
