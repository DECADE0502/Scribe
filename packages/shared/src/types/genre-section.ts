import { z } from "zod";

/**
 * 字段类型 union:
 * - 简单字符串:"string" / "text" / "number" / "enum"
 * - 简单字符串:"ref:character"
 * - 简单字符串:"list:string" / "list:number"
 * - 通用字符串模式:"ref:section:<name>" / "list:<inner>"
 * - 对象式:{ kind: "enum", values: [...] }
 */
export const GenreFieldTypeSchema = z.union([
  z.literal("string"),
  z.literal("text"),
  z.literal("number"),
  z.literal("enum"),
  z.object({
    kind: z.literal("enum"),
    values: z.array(z.string()).min(2),
  }),
  z.literal("ref:character"),
  z.literal("list:string"),
  z.literal("list:number"),
  z
    .string()
    .regex(/^ref:section:[\w一-龥\-]+$/),
  z
    .string()
    .regex(
      /^list:(string|text|number|ref:character|ref:section:[\w一-龥\-]+)$/,
    ),
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
  schema: z.array(GenreSectionFieldSchema).min(1),
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
