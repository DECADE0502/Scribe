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
    .regex(/^ref:(?!character$|section:)[\w一-龥\-]+$/),
  z
    .string()
    .regex(
      /^list:(string|text|number|ref:character|ref:section:[\w一-龥\-]+|ref:(?!character$|section:)[\w一-龥\-]+)$/,
    ),
]);

export const GenreFieldRoleSchema = z.enum([
  "identity",
  "label",
  "summary",
  "description",
  "status",
  "rank",
  "relation",
  "tag",
  "evidence",
]);

export const GenreSectionFieldSchema = z.object({
  name: z.string().min(1),
  type: GenreFieldTypeSchema,
  role: GenreFieldRoleSchema.optional(),
  description: z.string().optional(),
  required: z.boolean().optional(),
  /** 该字段是否作为条目的显示名(每个板块应恰有一个 isLabel 字段)。
   *  由 AI 在创建板块时显式声明,消费方据此读取条目名,不靠猜字段名。 */
  isLabel: z.boolean().optional(),
  values: z.array(z.string()).optional(),
});

type FieldDeclaration = {
  name: string;
  required?: boolean;
  role?: z.infer<typeof GenreFieldRoleSchema>;
  isLabel?: boolean;
};

type SectionDeclaration = {
  identityFields?: string[];
  displayFields?: string[];
  searchFields?: string[];
  schema: FieldDeclaration[];
};

export function resolveIdentityFieldNames(
  section: SectionDeclaration,
): string[] {
  const declared = section.identityFields?.filter(Boolean) ?? [];
  if (declared.length) return declared;

  const roleFields = section.schema
    .filter((f) => f.role === "identity")
    .map((f) => f.name);
  if (roleFields.length) return roleFields;

  const legacy = section.schema.find((f) => f.isLabel)?.name;
  return legacy ? [legacy] : [];
}

export function resolveDisplayFieldNames(
  section: SectionDeclaration,
): string[] {
  const declared = section.displayFields?.filter(Boolean) ?? [];
  if (declared.length) return declared;

  const roleFields = section.schema
    .filter((f) => f.role === "label")
    .map((f) => f.name);
  if (roleFields.length) return roleFields;

  return resolveIdentityFieldNames(section);
}

export function resolveItemIdentityKey(
  section: SectionDeclaration,
  data: Record<string, unknown>,
): string | undefined {
  const keys = resolveIdentityFieldNames(section);
  if (!keys.length) return undefined;

  const parts: string[] = [];
  for (const key of keys) {
    const value = data[key];
    if (value === undefined || value === null || value === "") {
      return undefined;
    }
    parts.push(`${key}=${String(value).trim()}`);
  }
  return parts.join("|");
}

export function resolveItemSearchText(
  section: SectionDeclaration,
  data: Record<string, unknown>,
): string {
  const declared = section.searchFields?.filter(Boolean) ?? [];
  const semantic = section.schema
    .filter((f) =>
      [
        "identity",
        "label",
        "summary",
        "description",
        "status",
        "rank",
        "tag",
      ].includes(f.role ?? ""),
    )
    .map((f) => f.name);
  const fields = [
    ...new Set([
      ...declared,
      ...semantic,
      ...resolveDisplayFieldNames(section),
    ]),
  ];

  return fields
    .map((field) => data[field])
    .filter((value) => value !== undefined && value !== null && value !== "")
    .map((value) => (Array.isArray(value) ? value.join(" ") : String(value)))
    .join("\n");
}

/**
 * 解析某板块"作为条目显示名"的字段名(题材无关)。
 * 优先级:显式 displayFields/label role > identity 声明 > 旧 isLabel > 第一个必填字段 > 第一个字段。
 * 后两者只用于读取旧板块兜底,新写入路径必须显式声明 identity/display。
 */
export function resolveLabelFieldName(
  schema: Array<{ name: string; required?: boolean; isLabel?: boolean; role?: z.infer<typeof GenreFieldRoleSchema> }>,
): string | undefined {
  return (
    schema.find((f) => f.role === "label")?.name ??
    schema.find((f) => f.role === "identity")?.name ??
    schema.find((f) => f.isLabel)?.name ??
    schema.find((f) => f.required)?.name ??
    schema[0]?.name
  );
}

/** 从一条 item.data 解析显示名;取不到声明字段时退到 data 第一个非空值,再退到 fallback。 */
export function resolveItemLabel(
  schemaOrSection:
    | Array<{ name: string; required?: boolean; isLabel?: boolean; role?: z.infer<typeof GenreFieldRoleSchema> }>
    | SectionDeclaration,
  data: Record<string, unknown>,
  fallback = "(未命名)",
): string {
  const displayFields = Array.isArray(schemaOrSection)
    ? [resolveLabelFieldName(schemaOrSection)].filter(
        (v): v is string => Boolean(v),
      )
    : resolveDisplayFieldNames(schemaOrSection);

  const values = displayFields
    .map((key) => data[key])
    .filter((v) => v != null && v !== "")
    .map(String);
  if (values.length) return values.join(" / ");

  const firstVal = Object.values(data).find((v) => v != null && v !== "");
  return firstVal != null ? String(firstVal) : fallback;
}

export const GenreSectionSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  schema: z.array(GenreSectionFieldSchema).min(1),
  identityFields: z.array(z.string().min(1)).optional(),
  displayFields: z.array(z.string().min(1)).optional(),
  searchFields: z.array(z.string().min(1)).optional(),
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
export type GenreFieldRole = z.infer<typeof GenreFieldRoleSchema>;
export type GenreFieldType = z.infer<typeof GenreFieldTypeSchema>;
export type GenreSection = z.infer<typeof GenreSectionSchema>;
export type GenreSectionItem = z.infer<typeof GenreSectionItemSchema>;
export type RecordField = GenreField;
export type RecordCollection = GenreSection;
export type RecordItem = GenreSectionItem;
