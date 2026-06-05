import { z } from "zod";

export const ModelPricingSchema = z.object({
  input: z.number(),
  output: z.number(),
  cachedInput: z.number().optional(),
});
export type ModelPricing = z.infer<typeof ModelPricingSchema>;

export const ModelInfoSchema = z.object({
  id: z.string(),
  ownedBy: z.string().optional(),
  contextWindow: z.number().int().positive().optional(),
  supportsTools: z.boolean().optional(),
  supportsReasoning: z.boolean().optional(),
  pricing: ModelPricingSchema.optional(),
});
export type ModelInfo = z.infer<typeof ModelInfoSchema>;

export const ErrorClassSchema = z.enum([
  "rate_limit",
  "timeout",
  "stream_idle",
  "auth",
  "context_overflow",
  "unknown",
]);
export type ErrorClass = z.infer<typeof ErrorClassSchema>;
