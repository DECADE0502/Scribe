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
  /** 该字段是否作为条目的显示名(每个板块应恰有一个 isLabel 字段)。
   *  由 AI 在创建板块时显式声明,消费方据此读取条目名,不靠猜字段名。 */
  isLabel: z.boolean().optional(),
  values: z.array(z.string()).optional(),
});

/**
 * 解析某板块"作为条目显示名"的字段名(题材无关)。
 * 优先级:显式声明的 isLabel 字段 > 第一个必填字段 > 第一个字段。
 * 后两者是对未声明 isLabel 的旧板块的兜底,不是主路径。
 */
export function resolveLabelFieldName(
  schema: Array<{ name: string; required?: boolean; isLabel?: boolean }>,
): string | undefined {
  return (
    schema.find((f) => f.isLabel)?.name ??
    schema.find((f) => f.required)?.name ??
    schema[0]?.name
  );
}

/** 从一条 item.data 解析显示名;取不到声明字段时退到 data 第一个非空值,再退到 fallback。 */
export function resolveItemLabel(
  schema: Array<{ name: string; required?: boolean; isLabel?: boolean }>,
  data: Record<string, unknown>,
  fallback = "(未命名)",
): string {
  const key = resolveLabelFieldName(schema);
  if (key && data[key] != null && data[key] !== "") return String(data[key]);
  const firstVal = Object.values(data).find((v) => v != null && v !== "");
  return firstVal != null ? String(firstVal) : fallback;
}

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
