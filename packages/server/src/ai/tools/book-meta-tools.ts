import * as fs from "node:fs";
import * as path from "node:path";
import { tool, type Tool } from "ai";
import { z } from "zod";

// 最小依赖接口
export interface BookMetaRepoLike {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  list(): { key: string; value: string }[];
}

export interface CharactersRepoLike {
  create(input: {
    name: string;
    role?: "protagonist" | "antagonist" | "supporting" | null;
    baseData?: Record<string, unknown>;
    currentState?: Record<string, unknown>;
  }): { id: string; name: string };
  update(
    id: string,
    patch: Record<string, unknown>,
  ): { id: string; name: string };
  get(id: string): { id: string; name: string } | undefined;
}

export interface OutlineRepoLike {
  create(input: {
    parentId: string | null;
    level: "volume" | "arc" | "chapter";
    title: string;
    summary: string | null;
    status: "planned" | "in_progress" | "done";
    sortOrder: number;
    metadata: Record<string, unknown> | null;
  }): { id: string; title: string };
  update(
    id: string,
    patch: Record<string, unknown>,
  ): { id: string; title: string };
  listAll(): Array<{ id: string; level: string; title: string }>;
}

export interface BookMetaToolsDeps {
  bookMetaRepo: BookMetaRepoLike;
  charactersRepo: CharactersRepoLike;
  outlineRepo: OutlineRepoLike;
  rulesMdPath: string; // 完整文件路径,Task 1.1 paths.ts 提供
}

export function makeBookMetaTools(
  deps: BookMetaToolsDeps,
): Record<string, Tool> {
  return {
    set_book_meta: tool({
      description:
        "设置或更新本书的基础元信息(title / premise / tone / genre / lengthTarget)。partial 合并,只更新传入的字段。",
      parameters: z.object({
        title: z.string().min(1).optional().describe("书名"),
        premise: z.string().optional().describe("一句话故事前提"),
        tone: z
          .string()
          .optional()
          .describe("调性,如 '热血' / '清冷' / '悬疑'"),
        genre: z
          .string()
          .optional()
          .describe("题材或类型,按用户原话或书籍实际设定记录"),
        lengthTarget: z
          .string()
          .optional()
          .describe("篇幅预期,如 '短篇' / '长篇' / '50 万字'"),
      }),
      execute: async (args) => {
        const updated: Record<string, string> = {};
        for (const [k, v] of Object.entries(args)) {
          if (v !== undefined && v !== null) {
            deps.bookMetaRepo.set(k, String(v));
            updated[k] = String(v);
          }
        }
        return { updated };
      },
    }),

    create_character: tool({
      description:
        "创建一个角色。role 必须是 protagonist(主角)/ antagonist(反派)/ supporting(配角)之一。",
      parameters: z.object({
        name: z.string().min(1).describe("角色名"),
        role: z
          .enum(["protagonist", "antagonist", "supporting"])
          .describe("角色定位"),
        background: z.string().optional().describe("背景"),
        motivation: z.string().optional().describe("驱动力"),
        languageHabits: z.string().optional().describe("语言习惯"),
      }),
      execute: async (args) => {
        const baseData: Record<string, unknown> = {};
        if (args.background) baseData.background = args.background;
        if (args.motivation) baseData.motivation = args.motivation;
        if (args.languageHabits) baseData.languageHabits = args.languageHabits;
        const c = deps.charactersRepo.create({
          name: args.name,
          role: args.role,
          baseData,
          currentState: {},
        });
        return { id: c.id, name: c.name };
      },
    }),

    update_character: tool({
      description: "更新已有角色的字段(部分字段)。",
      parameters: z.object({
        id: z.string().describe("角色 ID"),
        name: z.string().optional(),
        role: z.enum(["protagonist", "antagonist", "supporting"]).optional(),
        background: z.string().optional(),
        motivation: z.string().optional(),
        languageHabits: z.string().optional(),
      }),
      execute: async (args) => {
        const existing = deps.charactersRepo.get(args.id);
        if (!existing) throw new Error(`角色不存在:${args.id}`);
        const patch: Record<string, unknown> = {};
        if (args.name) patch.name = args.name;
        if (args.role) patch.role = args.role;
        const baseDataPatch: Record<string, unknown> = {};
        if (args.background !== undefined)
          baseDataPatch.background = args.background;
        if (args.motivation !== undefined)
          baseDataPatch.motivation = args.motivation;
        if (args.languageHabits !== undefined)
          baseDataPatch.languageHabits = args.languageHabits;
        if (Object.keys(baseDataPatch).length) patch.baseData = baseDataPatch;
        const r = deps.charactersRepo.update(args.id, patch);
        return { id: r.id, name: r.name };
      },
    }),

    create_outline_node: tool({
      description:
        "创建一个大纲节点。写作计划优先创建 chapter(章)节点,并在标题中写明章号;volume 只作分组,arc 只作可选弧线分组,不能替代章级计划。",
      parameters: z.object({
        level: z.enum(["volume", "arc", "chapter"]).describe("层级:chapter 是写作时精确注入的本章大纲;volume/arc 仅用于组织结构"),
        title: z.string().min(1).describe("节点标题。chapter 节点请使用明确章号,如'第1章 雨夜来信'"),
        summary: z.string().optional().describe("节点摘要。chapter 节点必须写清本章事件、出场角色、冲突/推进点、结尾落点"),
        parentId: z.string().nullable().optional(),
        sortOrder: z.number().int().optional(),
      }),
      execute: async (args) => {
        const sortOrder =
          args.sortOrder ??
          deps.outlineRepo.listAll().filter((n) => n.level === args.level)
            .length;
        const node = deps.outlineRepo.create({
          parentId: args.parentId ?? null,
          level: args.level,
          title: args.title,
          summary: args.summary ?? null,
          status: "planned",
          sortOrder,
          metadata: null,
        });
        return { id: node.id, title: node.title };
      },
    }),

    update_outline_node: tool({
      description: "更新已有大纲节点。",
      parameters: z.object({
        id: z.string(),
        title: z.string().optional(),
        summary: z.string().optional(),
        status: z.enum(["planned", "in_progress", "done"]).optional(),
      }),
      execute: async (args) => {
        const patch: Record<string, unknown> = {};
        if (args.title !== undefined) patch.title = args.title;
        if (args.summary !== undefined) patch.summary = args.summary;
        if (args.status !== undefined) patch.status = args.status;
        const r = deps.outlineRepo.update(args.id, patch);
        return { id: r.id, title: r.title };
      },
    }),

    set_rules_md: tool({
      description:
        "设置或更新 rules.md(写作规则文件,会被传给所有写作/审查 prompt)。",
      parameters: z.object({
        content: z.string().describe("完整 markdown 内容"),
      }),
      execute: async ({ content }) => {
        fs.mkdirSync(path.dirname(deps.rulesMdPath), { recursive: true });
        fs.writeFileSync(deps.rulesMdPath, content, "utf-8");
        return { bytes: Buffer.byteLength(content, "utf-8") };
      },
    }),
  };
}
