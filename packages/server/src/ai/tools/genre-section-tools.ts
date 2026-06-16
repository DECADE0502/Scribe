import { tool, type Tool } from "ai";
import { z } from "zod";
import {
  GenreSectionFieldSchema,
  resolveItemIdentityKey,
  type GenreField,
  type GenreSection,
  type GenreSectionItem,
} from "@scribe/shared";
import {
  validateSectionDeclaration,
  validateItemAgainstSchema,
  type CharactersRepoLike,
} from "../genre-section-validator.js";

export interface GenreToolsRepoLike {
  createSection(input: {
    name: string;
    schema: GenreField[];
    identityFields?: string[];
    displayFields?: string[];
    searchFields?: string[];
    createdBy: "ai" | "user";
  }): GenreSection;
  getSection(id: string): GenreSection | undefined;
  getByName(name: string): GenreSection | undefined;
  listSections(): GenreSection[];
  updateSectionSchema(
    id: string,
    schema: GenreField[],
    metadata?: {
      identityFields?: string[];
      displayFields?: string[];
      searchFields?: string[];
    },
  ): GenreSection;
  deleteSection(id: string): void;
  addItem(
    sectionId: string,
    data: Record<string, unknown>,
  ): GenreSectionItem;
  getItem(itemId: string): GenreSectionItem | undefined;
  listItems(sectionId: string): GenreSectionItem[];
  findItemByIdentity?(
    section: GenreSection,
    data: Record<string, unknown>,
  ): GenreSectionItem | undefined;
  updateItem(
    itemId: string,
    data: Record<string, unknown>,
  ): GenreSectionItem;
  deleteItem(itemId: string): void;
}

export interface GenreToolsDeps {
  repo: GenreToolsRepoLike;
  charactersRepo?: CharactersRepoLike;
  includeLegacyNames?: boolean;
}

/**
 * 保证 schema 恰好有一个 isLabel 字段(显示名)。
 * AI 已声明则尊重第一个声明、清掉其余;AI 没声明则把"第一个必填字段、否则第一个字段"
 * 提升为 isLabel。这样落盘的 schema 始终自带显示名声明,读取方零猜测。
 */
export function normalizeLabelField(schema: GenreField[]): GenreField[] {
  const declared = schema.find((f) => f.isLabel);
  const labelName = declared?.name
    ?? schema.find((f) => f.required)?.name
    ?? schema[0]?.name;
  return schema.map((f) => ({ ...f, isLabel: f.name === labelName }));
}

function normalizeRelationFieldTypes(schema: GenreField[]): GenreField[] {
  return schema.map((field) => {
    if (typeof field.type !== "string") return field;
    if (field.type.startsWith("ref:") && !field.type.startsWith("ref:section:") && field.type !== "ref:character") {
      return { ...field, type: `ref:section:${field.type.slice("ref:".length)}` as GenreField["type"] };
    }
    if (field.type.startsWith("list:ref:") && !field.type.startsWith("list:ref:section:") && field.type !== "list:ref:character") {
      return { ...field, type: `list:ref:section:${field.type.slice("list:ref:".length)}` as GenreField["type"] };
    }
    return field;
  });
}

const RecordDataSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}, z.record(z.unknown()));

function normalizeSectionDeclaration(input: {
  name: string;
  schema: GenreField[];
  identityFields?: string[];
  displayFields?: string[];
  searchFields?: string[];
}): {
  name: string;
  schema: GenreField[];
  identityFields?: string[];
  displayFields?: string[];
  searchFields?: string[];
} {
  const schema = normalizeRelationFieldTypes(normalizeLabelField(input.schema));
  const identityFields =
    input.identityFields?.filter(Boolean) ??
    schema.filter((field) => field.role === "identity").map((field) => field.name);
  const displayFields =
    input.displayFields?.filter(Boolean) ??
    schema.filter((field) => field.role === "label").map((field) => field.name);
  const searchFields = input.searchFields?.filter(Boolean);
  return {
    name: input.name,
    schema,
    identityFields: identityFields.length ? identityFields : undefined,
    displayFields: displayFields.length ? displayFields : undefined,
    searchFields: searchFields?.length ? searchFields : undefined,
  };
}

export function makeGenreSectionTools(
  deps: GenreToolsDeps,
): Record<string, Tool> {
  const repo = deps.repo;

  const findItemByIdentity = (
    section: GenreSection,
    data: Record<string, unknown>,
  ): GenreSectionItem | undefined => {
    if (repo.findItemByIdentity) return repo.findItemByIdentity(section, data);
    const targetKey = resolveItemIdentityKey(section, data);
    if (!targetKey) return undefined;
    return repo
      .listItems(section.id)
      .find((item) => resolveItemIdentityKey(section, item.data) === targetKey);
  };

  const relationFieldTargetsSection = (
    field: GenreField,
    targetSectionName: string,
  ): boolean =>
    field.type === `ref:section:${targetSectionName}` ||
    field.type === `list:ref:section:${targetSectionName}`;

  const findCharacterByIdentity = (
    identity: Record<string, unknown>,
  ): { id: string; name?: string } | undefined => {
    if (!deps.charactersRepo) return undefined;
    const id = identity.id;
    if (typeof id === "string") {
      const byId = deps.charactersRepo.get(id);
      if (byId) return byId;
    }
    const name = identity.name;
    if (typeof name === "string") {
      return deps.charactersRepo.list?.().find((character) => character.name === name);
    }
    return undefined;
  };

  const normalizeCharacterRefs = (
    section: GenreSection,
    data: Record<string, unknown>,
  ): Record<string, unknown> => {
    if (!deps.charactersRepo?.list) return data;
    let changed = false;
    const next = { ...data };
    const findByName = (name: string): string | undefined =>
      deps.charactersRepo?.list?.().find((character) => character.name === name)?.id;

    for (const field of section.schema) {
      const value = next[field.name];
      if (typeof value === "string" && field.type === "ref:character") {
        const id = findByName(value);
        if (id) {
          next[field.name] = id;
          changed = true;
        }
      } else if (Array.isArray(value) && field.type === "list:ref:character") {
        const normalized = value.map((item) =>
          typeof item === "string" ? findByName(item) ?? item : item,
        );
        if (normalized.some((item, index) => item !== value[index])) {
          next[field.name] = normalized;
          changed = true;
        }
      }
    }

    return changed ? next : data;
  };

  const evolveEnumFieldsForData = (
    section: GenreSection,
    data: Record<string, unknown>,
  ): GenreSection => {
    let changed = false;
    const schema = section.schema.map((field) => {
      const value = data[field.name];
      const values =
        typeof field.type === "object" && field.type.kind === "enum"
          ? field.type.values
          : field.values;
      if (typeof value === "string" && values && !values.includes(value)) {
        changed = true;
        if (typeof field.type === "object" && field.type.kind === "enum") {
          return {
            ...field,
            type: { ...field.type, values: [...field.type.values, value] },
          };
        }
        return { ...field, values: [...values, value] };
      }
      return field;
    });

    return changed
      ? repo.updateSectionSchema(section.id, schema, {
          identityFields: section.identityFields,
          displayFields: section.displayFields,
          searchFields: section.searchFields,
        })
      : section;
  };

  const upsertItem = async (
    sectionName: string,
    data: Record<string, unknown>,
  ): Promise<{ created?: boolean; updated?: boolean; item: GenreSectionItem; identityKey?: string }> => {
    let section = repo.getByName(sectionName);
    if (!section) throw new Error(`板块不存在:${sectionName}`);
    validateSectionDeclaration(section, { allowLegacyLabel: true });
    const normalizedData = normalizeCharacterRefs(section, data);
    section = evolveEnumFieldsForData(section, normalizedData);
    validateItemAgainstSchema(section, normalizedData, deps.charactersRepo, repo);

    const identityKey = resolveItemIdentityKey(section, normalizedData);
    const existing = findItemByIdentity(section, normalizedData);
    if (existing) {
      const merged = { ...existing.data, ...normalizedData };
      validateItemAgainstSchema(section, merged, deps.charactersRepo, repo);
      return {
        updated: true,
        item: repo.updateItem(existing.id, merged),
        identityKey,
      };
    }

    return {
      created: true,
      item: repo.addItem(section.id, normalizedData),
      identityKey,
    };
  };

  const tools = {
    create_genre_section: tool({
      description:
        "创建一个通用记录集合,用于追踪本书需要长期保持一致的任意对象/规则/关系。schema 至少 1 个字段。新集合必须声明 identityFields; displayFields/searchFields 用于展示和召回。",
      parameters: z.object({
        name: z.string().min(1).describe("集合名,由 AI 根据本书需要自行命名"),
        identityFields: z
          .array(z.string().min(1))
          .optional()
          .describe("唯一识别同一条记录的字段名数组"),
        displayFields: z
          .array(z.string().min(1))
          .optional()
          .describe("展示给作者看的字段名数组"),
        searchFields: z
          .array(z.string().min(1))
          .optional()
          .describe("用于召回/检索的字段名数组"),
        schema: z
          .array(GenreSectionFieldSchema)
          .min(1)
          .describe("字段定义数组;字段可声明 role:identity/label/summary/description/status/rank/relation/tag/evidence"),
      }),
      execute: async ({ name, schema, identityFields, displayFields, searchFields }) => {
        if (repo.getByName(name)) {
          throw new Error(`板块名已存在:${name}`);
        }
        const normalized = normalizeSectionDeclaration({
          name,
          schema,
          identityFields,
          displayFields,
          searchFields,
        });
        const preview: GenreSection = {
          id: "__preview__",
          name,
          schema: normalized.schema,
          identityFields: normalized.identityFields,
          displayFields: normalized.displayFields,
          searchFields: normalized.searchFields,
          createdBy: "ai",
          createdAt: Date.now(),
        };
        validateSectionDeclaration(preview);
        return repo.createSection({ ...normalized, createdBy: "ai" });
      },
    }),

    update_genre_section_schema: tool({
      description:
        "修改通用记录集合的字段定义和声明元数据。注意:已存在的条目中,新增的 required 字段会在后续更新时校验,删除的字段被忽略。",
      parameters: z.object({
        sectionName: z.string().describe("要修改的集合名"),
        identityFields: z
          .array(z.string().min(1))
          .optional()
          .describe("新的唯一识别字段;不传则保留原声明"),
        displayFields: z
          .array(z.string().min(1))
          .optional()
          .describe("新的展示字段;不传则保留原声明"),
        searchFields: z
          .array(z.string().min(1))
          .optional()
          .describe("新的召回/检索字段;不传则保留原声明"),
        schema: z
          .array(GenreSectionFieldSchema)
          .min(1)
          .describe("新的字段定义数组;字段可声明通用 role"),
      }),
      execute: async ({ sectionName, schema, identityFields, displayFields, searchFields }) => {
        const section = repo.getByName(sectionName);
        if (!section) throw new Error(`板块不存在:${sectionName}`);
        const normalized = normalizeSectionDeclaration({
          name: sectionName,
          schema,
          identityFields: identityFields ?? section.identityFields,
          displayFields: displayFields ?? section.displayFields,
          searchFields: searchFields ?? section.searchFields,
        });
        const preview: GenreSection = {
          ...section,
          schema: normalized.schema,
          identityFields: normalized.identityFields,
          displayFields: normalized.displayFields,
          searchFields: normalized.searchFields,
        };
        validateSectionDeclaration(preview, { allowLegacyLabel: true });
        return repo.updateSectionSchema(section.id, normalized.schema, {
          identityFields: normalized.identityFields,
          displayFields: normalized.displayFields,
          searchFields: normalized.searchFields,
        });
      },
    }),

    delete_genre_section: tool({
      description: "删除一个板块及其所有条目(级联)。慎用。",
      parameters: z.object({
        sectionName: z.string().describe("要删除的板块名"),
      }),
      execute: async ({ sectionName }) => {
        const section = repo.getByName(sectionName);
        if (!section) throw new Error(`板块不存在:${sectionName}`);
        const itemsCount = repo.listItems(section.id).length;
        repo.deleteSection(section.id);
        return { deleted: section.name, itemsRemoved: itemsCount };
      },
    }),

    add_genre_section_item: tool({
      description:
        "向某个通用记录集合写入条目。实际执行 upsert:按 identityFields 去重,存在则更新,不存在才新增。data 字段须符合该集合 schema。",
      parameters: z.object({
        sectionName: z.string().describe("目标板块名"),
        data: RecordDataSchema
          .describe("条目数据,字段对应板块 schema"),
      }),
      execute: async ({ sectionName, data }) => {
        const result = await upsertItem(sectionName, data);
        return result.item;
      },
    }),

    upsert_genre_section_item: tool({
      description:
        "通用写入记录条目。按集合声明的 identityFields 查重;存在则 merge 更新,不存在才新增。本地负责去重,AI 不需要先查。",
      parameters: z.object({
        sectionName: z.string().describe("目标集合名"),
        data: RecordDataSchema
          .describe("条目数据,字段对应集合 schema"),
      }),
      execute: async ({ sectionName, data }) => upsertItem(sectionName, data),
    }),

    link_record_items: tool({
      description:
        "通用记录关系链接。按 source/target 集合声明的 identityFields 定位两端记录,再写入 source 记录中声明为 relation 的字段。本地只校验声明和引用,不理解任何题材语义。",
      parameters: z.object({
        sourceSectionName: z.string().min(1),
        sourceIdentity: z.record(z.unknown()),
        relationField: z.string().min(1),
        targetSectionName: z.string().min(1),
        targetIdentity: z.record(z.unknown()),
      }),
      execute: async ({
        sourceSectionName,
        sourceIdentity,
        relationField,
        targetSectionName,
        targetIdentity,
      }) => {
        const sourceSection = repo.getByName(sourceSectionName);
        if (!sourceSection) {
          throw new Error(`record collection not found:${sourceSectionName}`);
        }
        validateSectionDeclaration(sourceSection, { allowLegacyLabel: true });

        const field = sourceSection.schema.find((f) => f.name === relationField);
        if (!field || field.role !== "relation") {
          throw new Error(`relation field not declared:${relationField}`);
        }
        if (field.type === "ref:character" || field.type === "list:ref:character") {
          const sourceItem = findItemByIdentity(sourceSection, sourceIdentity);
          if (!sourceItem) {
            throw new Error(`source record item not found:${sourceSection.name}`);
          }
          const targetCharacter = findCharacterByIdentity(targetIdentity);
          if (!targetCharacter) {
            throw new Error("target character not found");
          }
          const currentValue = sourceItem.data[relationField];
          const nextValue = String(field.type).startsWith("list:")
            ? Array.from(
                new Set([
                  ...(Array.isArray(currentValue) ? currentValue : []),
                  targetCharacter.id,
                ]),
              )
            : targetCharacter.id;
          const nextData = { ...sourceItem.data, [relationField]: nextValue };
          validateItemAgainstSchema(
            sourceSection,
            nextData,
            deps.charactersRepo,
            repo,
          );
          const updated = repo.updateItem(sourceItem.id, nextData);
          return {
            linked: true,
            sourceItemId: updated.id,
            targetCharacterId: targetCharacter.id,
            relationField,
          };
        }

        const targetSection = repo.getByName(targetSectionName);
        if (!targetSection) {
          throw new Error(`record collection not found:${targetSectionName}`);
        }
        validateSectionDeclaration(targetSection, { allowLegacyLabel: true });
        if (!relationFieldTargetsSection(field, targetSection.name)) {
          throw new Error(
            `relation field ${relationField} does not reference ${targetSection.name}`,
          );
        }

        const sourceItem = findItemByIdentity(sourceSection, sourceIdentity);
        if (!sourceItem) {
          throw new Error(`source record item not found:${sourceSection.name}`);
        }
        const targetItem = findItemByIdentity(targetSection, targetIdentity);
        if (!targetItem) {
          throw new Error(`target record item not found:${targetSection.name}`);
        }

        const currentValue = sourceItem.data[relationField];
        const nextValue = String(field.type).startsWith("list:")
          ? Array.from(
              new Set([
                ...(Array.isArray(currentValue) ? currentValue : []),
                targetItem.id,
              ]),
            )
          : targetItem.id;
        const nextData = { ...sourceItem.data, [relationField]: nextValue };
        validateItemAgainstSchema(
          sourceSection,
          nextData,
          deps.charactersRepo,
          repo,
        );

        const updated = repo.updateItem(sourceItem.id, nextData);
        return {
          linked: true,
          sourceItemId: updated.id,
          targetItemId: targetItem.id,
          relationField,
        };
      },
    }),

    update_genre_section_item: tool({
      description: "更新一个已存在条目的数据(部分字段)。",
      parameters: z.object({
        itemId: z.string().describe("条目 ID"),
        data: RecordDataSchema
          .describe("要更新的字段(merge 到现有 data)"),
      }),
      execute: async ({ itemId, data }) => {
        const item = repo.getItem(itemId);
        if (!item) throw new Error(`条目不存在:${itemId}`);
        const section = repo.getSection(item.sectionId);
        if (!section) throw new Error(`条目所属板块已被删除`);
        const merged = { ...item.data, ...data };
        validateItemAgainstSchema(
          section,
          merged,
          deps.charactersRepo,
          repo,
        );
        return repo.updateItem(itemId, merged);
      },
    }),

    delete_genre_section_item: tool({
      description: "删除一个条目。",
      parameters: z.object({
        itemId: z.string().describe("条目 ID"),
      }),
      execute: async ({ itemId }) => {
        const item = repo.getItem(itemId);
        if (!item) throw new Error(`条目不存在:${itemId}`);
        repo.deleteItem(itemId);
        return { deleted: itemId };
      },
    }),

  };

  return {
    create_record_collection: tools.create_genre_section,
    update_record_collection_schema: tools.update_genre_section_schema,
    upsert_record_item: tools.upsert_genre_section_item,
    link_record_items: tools.link_record_items,
    update_record_item: tools.update_genre_section_item,
    delete_record_item: tools.delete_genre_section_item,
    delete_record_collection: tools.delete_genre_section,
    ...(deps.includeLegacyNames ? tools : {}),
  };
}
