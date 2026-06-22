import { tool, type Tool } from "ai";
import { z } from "zod";
import type { BookHandle } from "../../http/book-registry.js";

/**
 * 查询工具库。只提供读取/检索工具，不提供写入工具。
 * 写入工具统一用 book-meta-tools（set_book_meta / create_character / create_outline_node 等）
 * 和 genre-section-tools / worldbook-tools，避免名字分裂。
 */

export interface BookToolsDeps {
  handle: BookHandle;
}

/** 重流程 action 标记。agenticChat 检测到后 break streamLlm，执行对应流程。 */
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

    list_worldbook: tool({
      description: "查看世界书条目。用户问'世界观是什么''有哪些世界设定'之类时调用。",
      parameters: z.object({
        enabledOnly: z.boolean().optional().describe("只看启用的条目"),
      }),
      execute: async (args) => {
        const entries = handle.worldbookRepo.list(args);
        return {
          entries: entries.map(e => ({
            id: e.id, title: e.title, content: e.content,
            enabled: e.enabled, constant: e.constant,
            keys: e.keys, category: e.category,
          })),
        };
      },
    }),
  };
}

/**
 * 重流程 trigger 工具。只在 onboard 完成后才暴露给 AI。
 * 返回 action 标记，agenticChatWithTriggers 检测后立即执行对应重流程。
 */
export function makeTriggerTools(deps: BookToolsDeps): Record<string, Tool> {
  return {
    write_next_chapter: tool({
      description:
        "开始写下一章的完整流程（写正文→审查→记录状态）。当用户明确要求写下一章、继续写、接着写、推进剧情时调用此工具。不要在用户只是讨论设定、大纲、角色时调用。",
      parameters: z.object({
        userIntent: z.string().describe("本章写作意图/要写什么，从用户消息中提取。如果用户只说'写下一章'没有具体意图，传空字符串"),
      }),
      execute: async ({ userIntent }) => ({
        __action: "write_next_chapter" as const,
        userIntent,
      }),
    }),

    rewrite_chapter: tool({
      description:
        "重写指定章节。当用户明确要求重写/改写某一章时调用。",
      parameters: z.object({
        chapterNo: z.number().int().min(1).describe("要重写的章节号"),
        userIntent: z.string().describe("重写意图/改进方向"),
      }),
      execute: async ({ chapterNo, userIntent }) => ({
        __action: "rewrite_chapter" as const,
        chapterNo,
        userIntent,
      }),
    }),

    delete_chapters: tool({
      description:
        "删除章节（回档语义：删第 N 章及之后所有章）。当用户明确要求删除章节、回档时调用。",
      parameters: z.object({
        fromChapterNo: z.number().int().min(1).describe("从第几章开始删（含该章）"),
      }),
      execute: async ({ fromChapterNo }) => ({
        __action: "delete_chapters" as const,
        fromChapterNo,
      }),
    }),

    audit_chapter: tool({
      description:
        "审查指定章节质量。当用户明确要求审查、检查某一章时调用。",
      parameters: z.object({
        chapterNo: z.number().int().min(1).describe("要审查的章节号"),
      }),
      execute: async ({ chapterNo }) => ({
        __action: "audit_chapter" as const,
        chapterNo,
      }),
    }),
  };
}
