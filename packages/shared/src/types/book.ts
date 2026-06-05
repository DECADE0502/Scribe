import { z } from "zod";

export const BookSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  genre: z.string().nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  totalCostUsd: z.number().nonnegative(),
});
export type Book = z.infer<typeof BookSchema>;

export const NewBookInputSchema = z.object({
  title: z.string().min(1),
  genre: z.string().nullable().optional(),
});
export type NewBookInput = z.infer<typeof NewBookInputSchema>;
