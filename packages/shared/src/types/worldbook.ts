import { z } from "zod";

export const WorldbookActivationSchema = z.enum(["constant", "triggered"]);

export const WorldbookEntrySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  content: z.string().min(1),
  enabled: z.boolean(),
  activation: WorldbookActivationSchema,
  keys: z.array(z.string()),
  secondaryKeys: z.array(z.string()),
  constant: z.boolean(),
  priority: z.number().int(),
  insertionDepth: z.number().int().min(0),
  recursive: z.boolean(),
  recursionLimit: z.number().int().min(0),
  tokenBudget: z.number().int().positive().nullable(),
  category: z.string().min(1).nullable(),
  metadata: z.record(z.unknown()),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

export const NewWorldbookEntryInputSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
  enabled: z.boolean().optional(),
  activation: WorldbookActivationSchema.optional(),
  keys: z.array(z.string()).optional(),
  secondaryKeys: z.array(z.string()).optional(),
  constant: z.boolean().optional(),
  priority: z.number().int().optional(),
  insertionDepth: z.number().int().min(0).optional(),
  recursive: z.boolean().optional(),
  recursionLimit: z.number().int().min(0).optional(),
  tokenBudget: z.number().int().positive().nullable().optional(),
  category: z.string().min(1).nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const WorldbookEntryPatchSchema =
  NewWorldbookEntryInputSchema.partial();

export type WorldbookActivation = z.infer<typeof WorldbookActivationSchema>;
export type WorldbookEntry = z.infer<typeof WorldbookEntrySchema>;
export type NewWorldbookEntryInput = z.infer<
  typeof NewWorldbookEntryInputSchema
>;
export type WorldbookEntryPatch = z.infer<typeof WorldbookEntryPatchSchema>;
