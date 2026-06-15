import { tool, type Tool } from "ai";
import { z } from "zod";
import {
  GenreSectionFieldSchema,
  type GenreField,
  type GenreSection,
  type GenreSectionItem,
} from "@scribe/shared";
import {
  validateItemAgainstSchema,
  type CharactersRepoLike,
} from "../genre-section-validator.js";

export interface GenreToolsRepoLike {
  createSection(input: {
    name: string;
    schema: GenreField[];
    createdBy: "ai" | "user";
  }): GenreSection;
  getSection(id: string): GenreSection | undefined;
  getByName(name: string): GenreSection | undefined;
  listSections(): GenreSection[];
  updateSectionSchema(id: string, schema: GenreField[]): GenreSection;
  deleteSection(id: string): void;
  addItem(
    sectionId: string,
    data: Record<string, unknown>,
  ): GenreSectionItem;
  getItem(itemId: string): GenreSectionItem | undefined;
  listItems(sectionId: string): GenreSectionItem[];
  updateItem(
    itemId: string,
    data: Record<string, unknown>,
  ): GenreSectionItem;
  deleteItem(itemId: string): void;
}

export interface GenreToolsDeps {
  repo: GenreToolsRepoLike;
  charactersRepo?: CharactersRepoLike;
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

export function makeGenreSectionTools(
  deps: GenreToolsDeps,
): Record<string, Tool> {
  const repo = deps.repo;

  return {
    create_genre_section: tool({
      description:
        "创建一个题材专属板块,用于追踪本题材独有的世界观元素(如修仙的'功法体系'、都市的'财务')。schema 至少 1 个字段,并且**必须恰好有一个字段标记 isLabel:true 作为条目显示名**(如功法板块把'功法名'设为 isLabel)。",
      parameters: z.object({
        name: z.string().min(1).describe("板块名,如 '功法体系'"),
        schema: z
          .array(GenreSectionFieldSchema)
          .min(1)
          .describe("字段定义数组;须恰好一个字段设 isLabel:true(条目显示名)"),
      }),
      execute: async ({ name, schema }) => {
        if (repo.getByName(name)) {
          throw new Error(`板块名已存在:${name}`);
        }
        return repo.createSection({ name, schema: normalizeLabelField(schema), createdBy: "ai" });
      },
    }),

    update_genre_section_schema: tool({
      description:
        "修改某板块的字段定义。注意:已存在的条目中,新增的 required 字段会用 fallback 值 null,删除的字段被忽略。仍须恰好一个字段 isLabel:true。",
      parameters: z.object({
        sectionName: z.string().describe("要修改的板块名"),
        schema: z
          .array(GenreSectionFieldSchema)
          .min(1)
          .describe("新的字段定义数组;须恰好一个字段设 isLabel:true"),
      }),
      execute: async ({ sectionName, schema }) => {
        const section = repo.getByName(sectionName);
        if (!section) throw new Error(`板块不存在:${sectionName}`);
        return repo.updateSectionSchema(section.id, normalizeLabelField(schema));
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
        "向某个板块添加一个条目(必须先有板块)。data 字段须符合该板块的 schema。",
      parameters: z.object({
        sectionName: z.string().describe("目标板块名"),
        data: z
          .record(z.unknown())
          .describe("条目数据,字段对应板块 schema"),
      }),
      execute: async ({ sectionName, data }) => {
        const section = repo.getByName(sectionName);
        if (!section) throw new Error(`板块不存在:${sectionName}`);
        validateItemAgainstSchema(section, data, deps.charactersRepo, repo);
        return repo.addItem(section.id, data);
      },
    }),

    update_genre_section_item: tool({
      description: "更新一个已存在条目的数据(部分字段)。",
      parameters: z.object({
        itemId: z.string().describe("条目 ID"),
        data: z
          .record(z.unknown())
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
}
