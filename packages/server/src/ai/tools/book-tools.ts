import { tool, type Tool } from "ai";
import { z } from "zod";
import type { BookHandle } from "../../http/book-registry.js";

/**
 * 完整的书操作工具库。给 agentic 对话用——AI 自己看消息 + 工具描述，
 * 自己决定调什么。不再靠意图分类器硬路由。
 *
 * 分两类：
 * 1. 轻量 tool — 直接操作 DB，返回结果给 AI，AI 继续对话
 * 2. trigger tool — 返回 { __action, ... } 标记，agenticChat 在 streamLlm
 *    结束后检查标记并执行重流程（写章/删章/审查），因为重流程需要
 *    流式 yield SSE 事件给前端展示进度，不能在 tool execute 里跑。
 */

export interface BookToolsDeps {
  handle: BookHandle;
}

/** 重流程 action 标记，agenticChat 检查这个来决定是否触发重流程 */
export interface TriggerAction {
  __action: "write_next_chapter" | "rewrite_chapter" | "delete_chapters" | "audit_chapter";
  [key: string]: unknown;
}

const RecordSchema = z.preprocess((v) => {
  if (typeof v === "string") { try { return JSON.parse(v); } catch { return v; } }
  return v;
}, z.record(z.unknown()));

export function makeBookTools(deps: BookToolsDeps): Record<string, Tool> {
  const { handle } = deps;

  return {

    // ========== 状态查询 ==========

    get_book_status: tool({
      description:
        "查看当前书的整体状态：章节数、最新章摘要、角色列表、大纲概览、活跃伏笔。用户问'现在写到哪了''有哪些角色'之类时调用。",
      parameters: z.object({}),
      execute: async () => {
        const maxNo = handle.chaptersRepo.maxChapterNo();
        const summaries = handle.chaptersRepo.listSummaries();
        const recent = summaries.slice(-3).map(s =>
          `第${s.chapterNo}章: ${s.oneLiner}`).join("\n");
        const characters = handle.charactersRepo.list().map(c =>
          `${c.name}(${c.role ?? "未定"})`).join("、") || "无";
        const outline = handle.outlineRepo.listAll();
        const outlineBrief = outline.length
          ? outline.map(n => `${n.level === "chapter" ? "  " : ""}${n.title}${n.status === "done" ? " ✓" : n.status === "in_progress" ? " …" : ""}`).join("\n")
          : "无";
        const foreshadowing = handle.foreshadowingRepo.list("active").map(f => f.label).join("、") || "无";
        const meta = handle.bookMetaRepo.list();
        const premise = meta.find(m => m.key === "premise")?.value ?? "未设定";
        const tone = meta.find(m => m.key === "tone")?.value ?? "未设定";
        const genre = meta.find(m => m.key === "genre")?.value ?? "未设定";
        return {
          chapters: maxNo,
          recentSummaries: recent || "无",
          characters,
          outline: outlineBrief,
          activeForeshadowing: foreshadowing,
          premise, tone, genre,
        };
      },
    }),

    recall_chapters: tool({
      description:
        "检索与关键词相关的历史章节摘要。用户问'前面有没有提到XXX''XXX在第几章'之类时调用。",
      parameters: z.object({
        keyword: z.string().describe("检索关键词（角色名、事件、地点等）"),
      }),
      execute: async ({ keyword }) => {
        const all = handle.chaptersRepo.listSummaries();
        const hits = all.filter(s =>
          s.oneLiner.includes(keyword) ||
          s.paragraph.includes(keyword) ||
          s.keyEvents.some(e => e.event.includes(keyword)));
        return {
          found: hits.length,
          chapters: hits.map(s => ({ chapterNo: s.chapterNo, oneLiner: s.oneLiner })),
        };
      },
    }),

    // ========== 书设定 (meta) ==========

    update_book_meta: tool({
      description:
        "修改书的设定。用户说'主题改为XXX''调性改成XXX''题材换成XXX''书名改为XXX'之类时调用。只传需要改的字段。",
      parameters: z.object({
        premise: z.string().optional().describe("故事前提/主题"),
        tone: z.string().optional().describe("叙事调性"),
        genre: z.string().optional().describe("题材类型"),
        title: z.string().optional().describe("书名"),
      }),
      execute: async (args) => {
        const updated: string[] = [];
        if (args.premise !== undefined) { handle.bookMetaRepo.set("premise", args.premise); updated.push("前提"); }
        if (args.tone !== undefined) { handle.bookMetaRepo.set("tone", args.tone); updated.push("调性"); }
        if (args.genre !== undefined) { handle.bookMetaRepo.set("genre", args.genre); updated.push("题材"); }
        if (args.title !== undefined) {
          // title 存在 library DB 的 books 表
          handle.bookMetaRepo.set("title", args.title);
          updated.push("书名");
        }
        return { updated: updated, success: true };
      },
    }),

    // ========== 大纲 ==========

    list_outline: tool({
      description: "查看完整大纲树。用户问'大纲是什么''有哪些章节规划'之类时调用。",
      parameters: z.object({}),
      execute: async () => {
        const nodes = handle.outlineRepo.listAll();
        return {
          nodes: nodes.map(n => ({
            id: n.id, parentId: n.parentId, level: n.level,
            title: n.title, summary: n.summary, status: n.status,
          })),
        };
      },
    }),

    add_outline_node: tool({
      description:
        "向大纲添加节点。用户说'大纲加一个XXX''展开第X卷''规划接下来几章'之类时调用。写作计划优先添加 chapter 节点,chapter 标题需带明确章号;volume/arc 只作结构分组。parentId 传 null 表示顶层节点。",
      parameters: z.object({
        parentId: z.string().nullable().optional().describe("父节点 ID；顶层传 null"),
        title: z.string().describe("节点标题。chapter 节点请写明确章号,如'第3章 雪夜重逢'"),
        summary: z.string().nullable().optional().describe("节点摘要/内容描述。chapter 节点要写清本章事件、出场角色、冲突/推进点、结尾落点"),
        level: z.enum(["volume", "arc", "chapter"]).describe("层级:chapter 是写作时精确注入的本章大纲;volume/arc 仅用于组织结构"),
        status: z.enum(["planned", "in_progress", "done"]).optional().describe("状态，默认 planned"),
      }),
      execute: async (args) => {
        const parentId = args.parentId ?? null;
        const siblings = handle.outlineRepo.listChildren(parentId);
        const node = handle.outlineRepo.create({
          parentId,
          level: args.level,
          title: args.title,
          summary: args.summary ?? null,
          status: args.status ?? "planned",
          sortOrder: siblings.length,
          metadata: null,
        });
        return { created: true, id: node.id, title: node.title };
      },
    }),

    update_outline_node: tool({
      description:
        "修改大纲节点。用户说'把第X卷改成XXX''大纲里那个节点改一下'之类时调用。只传需要改的字段。",
      parameters: z.object({
        id: z.string().describe("要修改的节点 ID"),
        title: z.string().optional(),
        summary: z.string().nullable().optional(),
        status: z.enum(["planned", "in_progress", "done"]).optional(),
      }),
      execute: async (args) => {
        const node = handle.outlineRepo.update(args.id, {
          ...(args.title !== undefined && { title: args.title }),
          ...(args.summary !== undefined && { summary: args.summary }),
          ...(args.status !== undefined && { status: args.status }),
        });
        return { updated: true, id: node.id, title: node.title };
      },
    }),

    delete_outline_node: tool({
      description: "删除大纲节点。用户说'大纲里删掉那个节点'之类时调用。",
      parameters: z.object({
        id: z.string().describe("要删除的节点 ID"),
      }),
      execute: async ({ id }) => {
        handle.outlineRepo.delete(id);
        return { deleted: true, id };
      },
    }),

    // ========== 角色 ==========

    list_characters: tool({
      description: "查看所有角色。用户问'有哪些角色''XXX是什么人'之类时调用。",
      parameters: z.object({}),
      execute: async () => {
        const chars = handle.charactersRepo.list();
        return {
          characters: chars.map(c => ({
            id: c.id, name: c.name, role: c.role,
            currentState: c.currentState,
            appearances: c.appearances,
          })),
        };
      },
    }),

    create_character: tool({
      description:
        "创建角色。用户说'加一个角色叫XXX''主角设定是XXX'之类时调用。",
      parameters: z.object({
        name: z.string().describe("角色名"),
        role: z.enum(["protagonist", "antagonist", "supporting"]).optional().describe("角色定位"),
        baseData: RecordSchema.optional().describe("角色基础设定（外貌、性格、背景等）"),
        currentState: RecordSchema.optional().describe("角色当前状态（位置、持有物等）"),
      }),
      execute: async (args) => {
        const c = handle.charactersRepo.create({
          name: args.name,
          role: args.role ?? null,
          baseData: args.baseData ?? {},
          currentState: args.currentState ?? {},
        });
        return { created: true, id: c.id, name: c.name };
      },
    }),

    update_character: tool({
      description:
        "修改角色。用户说'把XXX的设定改一下''XXX的位置改成王城'之类时调用。只传需要改的字段。",
      parameters: z.object({
        id: z.string().describe("角色 ID"),
        name: z.string().optional(),
        role: z.enum(["protagonist", "antagonist", "supporting"]).nullable().optional(),
        baseData: RecordSchema.optional().describe("合并到现有 baseData"),
        currentState: RecordSchema.optional().describe("合并到现有 currentState"),
      }),
      execute: async (args) => {
        const current = handle.charactersRepo.get(args.id);
        if (!current) return { success: false, error: `角色不存在: ${args.id}` };
        const next: Record<string, unknown> = { updatedAt: Date.now() };
        if (args.name !== undefined) next.name = args.name;
        if (args.role !== undefined) next.role = args.role;
        if (args.baseData !== undefined) next.baseData = { ...current.baseData, ...args.baseData };
        if (args.currentState !== undefined) next.currentState = { ...current.currentState, ...args.currentState };
        const c = handle.charactersRepo.update(args.id, next);
        return { updated: true, id: c.id, name: c.name };
      },
    }),

    delete_character: tool({
      description: "删除角色。用户说'删掉角色XXX'之类时调用。",
      parameters: z.object({ id: z.string().describe("角色 ID") }),
      execute: async ({ id }) => {
        handle.charactersRepo.delete(id);
        return { deleted: true, id };
      },
    }),

    // ========== 伏笔 ==========

    list_foreshadowing: tool({
      description: "查看伏笔列表。用户问'有哪些伏笔''XXX伏笔兑现了吗'之类时调用。",
      parameters: z.object({
        status: z.enum(["active", "paid", "dropped"]).optional().describe("按状态过滤，不传则全部"),
      }),
      execute: async (args) => {
        const list = handle.foreshadowingRepo.list(args.status);
        return {
          foreshadowing: list.map(f => ({
            id: f.id, label: f.label, description: f.description,
            plantedChapter: f.plantedChapter, paidChapter: f.paidChapter,
            status: f.status, relatedCharacters: f.relatedCharacters,
          })),
        };
      },
    }),

    create_foreshadowing: tool({
      description:
        "登记新伏笔。用户说'加一个伏笔XXX''这里埋一条线索'之类时调用。",
      parameters: z.object({
        label: z.string().describe("伏笔标签/名称"),
        description: z.string().nullable().optional().describe("伏笔描述"),
        plantedChapter: z.number().int().nullable().optional().describe("埋下章节号"),
        relatedCharacters: z.array(z.string()).optional().describe("关联角色名列表"),
      }),
      execute: async (args) => {
        const f = handle.foreshadowingRepo.create({
          label: args.label,
          description: args.description ?? null,
          plantedChapter: args.plantedChapter ?? null,
          paidChapter: null,
          status: "active",
          relatedCharacters: args.relatedCharacters ?? [],
        });
        return { created: true, id: f.id, label: f.label };
      },
    }),

    pay_foreshadowing: tool({
      description:
        "标记伏笔已兑现。用户说'XXX伏笔在第X章兑现了'之类时调用。",
      parameters: z.object({
        id: z.string().describe("伏笔 ID"),
        paidChapter: z.number().int().describe("兑现章节号"),
      }),
      execute: async ({ id, paidChapter }) => {
        const f = handle.foreshadowingRepo.pay(id, paidChapter);
        return { paid: true, id: f.id, label: f.label, paidChapter };
      },
    }),

    delete_foreshadowing: tool({
      description: "删除伏笔。用户说'删掉那条伏笔'之类时调用。",
      parameters: z.object({ id: z.string().describe("伏笔 ID") }),
      execute: async ({ id }) => {
        handle.foreshadowingRepo.delete(id);
        return { deleted: true, id };
      },
    }),

    // ========== 时间线 ==========

    list_timeline: tool({
      description: "查看时间线事件。用户问'时间线是什么''之前发生了什么'之类时调用。",
      parameters: z.object({
        chapterNo: z.number().int().optional().describe("按章节过滤，不传则全部"),
      }),
      execute: async (args) => {
        const events = args.chapterNo !== undefined
          ? handle.timelineRepo.listByChapter(args.chapterNo)
          : handle.timelineRepo.listAll();
        return {
          events: events.map(e => ({
            chapterNo: e.chapterNo, storyTime: e.storyTime,
            event: e.event, participants: e.participants,
          })),
        };
      },
    }),
  };
}
