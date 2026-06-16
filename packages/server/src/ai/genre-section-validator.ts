import type { GenreField, GenreSection } from "@scribe/shared";
import { resolveIdentityFieldNames } from "@scribe/shared";

/**
 * 最小 charactersRepo 接口(只要 get 方法)
 */
export interface CharactersRepoLike {
  get(id: string): { id: string } | undefined;
  list?(): Array<{ id: string; name: string }>;
}

/**
 * 最小 sectionsRepo 接口(用于解析 ref:section:<name>)
 */
export interface SectionsRepoLike {
  listItems(sectionId: string): Array<{ id: string }>;
  getByName?(name: string): { id: string } | undefined;
  listSections?(): Array<{ id: string; name: string }>;
}

export class ValidationError extends Error {
  constructor(
    message: string,
    public field?: string,
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

export function validateSectionDeclaration(
  section: GenreSection,
  opts: { allowLegacyLabel?: boolean } = {},
): void {
  const fieldNames = new Set(section.schema.map((field) => field.name));
  const explicitIdentity =
    section.identityFields?.filter(Boolean) ??
    section.schema
      .filter((field) => field.role === "identity")
      .map((field) => field.name);
  const hasLegacyOnly =
    explicitIdentity.length === 0 &&
    resolveIdentityFieldNames(section).length > 0;

  if (explicitIdentity.length === 0) {
    if (opts.allowLegacyLabel && hasLegacyOnly) return;
    throw new ValidationError("schema 必须声明 identity 字段");
  }

  for (const field of explicitIdentity) {
    if (!fieldNames.has(field)) {
      throw new ValidationError(`identity 字段 ${field} 不存在`, field);
    }
  }

  const displayFields =
    section.displayFields?.filter(Boolean) ??
    section.schema
      .filter((field) => field.role === "label")
      .map((field) => field.name);
  for (const field of displayFields) {
    if (!fieldNames.has(field)) {
      throw new ValidationError(`display 字段 ${field} 不存在`, field);
    }
  }
}

/**
 * 校验一个 item 的 data 是否符合 section.schema。
 *
 * 规则:
 * - required 字段缺失(undefined/null) → 抛 ValidationError
 * - 字段类型不匹配 → 抛 ValidationError
 * - ref:character 检查 character 存在(若注入了 charactersRepo)
 * - ref:section:<name> 检查 section + item 都存在(若注入了 sectionsRepo)
 * - list:<inner> 验证为数组且每个元素符合 inner 类型
 *
 * 容错:
 * - data 中多余的、不在 schema 里的字段 → 忽略(允许 schema 演化向后兼容)
 */
export function validateItemAgainstSchema(
  section: GenreSection,
  data: Record<string, unknown>,
  charactersRepo?: CharactersRepoLike,
  sectionsRepo?: SectionsRepoLike,
): void {
  for (const field of section.schema) {
    const value = data[field.name];
    if (value === undefined || value === null) {
      if (field.required) {
        throw new ValidationError(`字段 ${field.name} 必填`, field.name);
      }
      continue;
    }
    validateFieldValue(field, value, charactersRepo, sectionsRepo);
  }
}

function validateFieldValue(
  field: GenreField,
  value: unknown,
  charactersRepo?: CharactersRepoLike,
  sectionsRepo?: SectionsRepoLike,
): void {
  const t = field.type;
  if (t === "string" || t === "text") {
    if (typeof value !== "string") {
      throw new ValidationError(
        `字段 ${field.name} 应为字符串`,
        field.name,
      );
    }
  } else if (t === "number") {
    if (typeof value !== "number") {
      throw new ValidationError(`字段 ${field.name} 应为数字`, field.name);
    }
  } else if (t === "enum") {
    if (typeof value !== "string") {
      throw new ValidationError(
        `字段 ${field.name} 应为字符串(enum 值)`,
        field.name,
      );
    }
    if (field.values && !field.values.includes(value)) {
      throw new ValidationError(
        `字段 ${field.name} 值「${value}」不在允许列表,只能取:${field.values.join("、")}`,
        field.name,
      );
    }
  } else if (typeof t === "object" && t.kind === "enum") {
    if (typeof value !== "string") {
      throw new ValidationError(
        `字段 ${field.name} 应为字符串`,
        field.name,
      );
    }
    if (!t.values.includes(value)) {
      throw new ValidationError(
        `字段 ${field.name} 值「${value}」不在允许列表,只能取:${t.values.join("、")}`,
        field.name,
      );
    }
  } else if (t === "ref:character") {
    if (typeof value !== "string") {
      throw new ValidationError(
        `字段 ${field.name} 应为角色 ID`,
        field.name,
      );
    }
    if (charactersRepo && !charactersRepo.get(value)) {
      throw new ValidationError(
        `角色 ID ${value} 不存在`,
        field.name,
      );
    }
  } else if (t === "list:string") {
    if (!Array.isArray(value)) {
      throw new ValidationError(`字段 ${field.name} 应为数组`, field.name);
    }
    for (const v of value) {
      if (typeof v !== "string") {
        throw new ValidationError(
          `字段 ${field.name} 元素应为 string`,
          field.name,
        );
      }
    }
  } else if (t === "list:number") {
    if (!Array.isArray(value)) {
      throw new ValidationError(`字段 ${field.name} 应为数组`, field.name);
    }
    for (const v of value) {
      if (typeof v !== "number") {
        throw new ValidationError(
          `字段 ${field.name} 元素应为 number`,
          field.name,
        );
      }
    }
  } else if (typeof t === "string" && t.startsWith("ref:section:")) {
    const targetSection = t.slice("ref:section:".length);
    if (typeof value !== "string") {
      throw new ValidationError(
        `字段 ${field.name} 应为板块条目 ID`,
        field.name,
      );
    }
    if (sectionsRepo) {
      const target =
        sectionsRepo.getByName?.(targetSection) ??
        sectionsRepo.listSections?.().find((s) => s.name === targetSection);
      if (!target) {
        throw new ValidationError(
          `板块 ${targetSection} 不存在`,
          field.name,
        );
      }
      const items = sectionsRepo.listItems(target.id);
      if (!items.some((i) => i.id === value)) {
        throw new ValidationError(
          `板块 ${targetSection} 中条目 ${value} 不存在`,
          field.name,
        );
      }
    }
  } else if (typeof t === "string" && t.startsWith("list:")) {
    if (!Array.isArray(value)) {
      throw new ValidationError(`字段 ${field.name} 应为数组`, field.name);
    }
    const innerType = t.slice("list:".length);
    const innerField: GenreField = {
      name: `${field.name}[]`,
      type: innerType as GenreField["type"],
    };
    for (const v of value) {
      validateFieldValue(innerField, v, charactersRepo, sectionsRepo);
    }
  }
}
