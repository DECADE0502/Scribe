import { z } from "zod";
export const GenreFieldTypeSchema = z.enum([
  "string",
  "text",
  "number",
  "enum",
  "ref:character",
  "list:string",
  "list:number",
]);
export const GenreSectionFieldSchema = z.object({
  name: z.string().min(1),
  type: GenreFieldTypeSchema,
  description: z.string().optional(),
  required: z.boolean().optional(),
  values: z.array(z.string()).optional(),
});
export const GenreSectionSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  schema: z.array(GenreSectionFieldSchema),
  createdBy: z.enum(["ai", "user"]),
  createdAt: z.number().int(),
});
export const GenreSectionItemSchema = z.object({
  id: z.string(),
  sectionId: z.string(),
  data: z.record(z.unknown()),
  updatedAt: z.number().int(),
});
export type GenreField = z.infer<typeof GenreSectionFieldSchema>;
export type GenreFieldType = z.infer<typeof GenreFieldTypeSchema>;
export type GenreSection = z.infer<typeof GenreSectionSchema>;
export type GenreSectionItem = z.infer<typeof GenreSectionItemSchema>;
