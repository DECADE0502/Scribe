import { tool, type Tool } from "ai";
import { z } from "zod";

/** 最小依赖接口(与真实 repo 结构兼容) */
export interface StateCharactersRepoLike {
  list(): Array<{ id: string; name: string; currentState: Record<string, unknown> }>;
  update(id: string, patch: Record<string, unknown>): unknown;
  addAppearance(id: string, appearance: { chapterNo: number; brief: string }): unknown;
  create(input: {
    name: string;
    role: "protagonist" | "antagonist" | "supporting";
    baseData: Record<string, unknown>;
    currentState: Record<string, unknown>;
  }): { id: string; name: string };
}

export interface StateForeshadowingRepoLike {
  list(filterStatus?: "active" | "paid" | "dropped"): Array<{ id: string; label: string }>;
  create(input: {
    label: string;
    description: string | null;
    plantedChapter: number | null;
    paidChapter: number | null;
    status: "active" | "paid" | "dropped";
    relatedCharacters: string[];
  }): unknown;
  pay(id: string, paidChapter: number): unknown;
}

export interface StateTimelineRepoLike {
  create(input: {
    chapterNo: number;
    storyTime: string;
    event: string;
    participants: string[];
  }): unknown;
}

export interface StateToolsDeps {
  charactersRepo: StateCharactersRepoLike;
  foreshadowingRepo: StateForeshadowingRepoLike;
  timelineRepo: StateTimelineRepoLike;
  /** 当前章节号(工具内部用,LLM 不必传) */
  chapterNo: number;
}

function findCharacter(deps: StateToolsDeps, name: string) {
  const c = deps.charactersRepo.list().find(x => x.name === name);
  if (!c) throw new Error(`角色不存在:${name}(请先用 create_character 创建)`);
  return c;
}

const stateRecordSchema = z.union([z.record(z.unknown()), z.string()]);

function parseStateRecord(value: z.infer<typeof stateRecordSchema>): Record<string, unknown> {
  if (typeof value !== "string") return value;
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {}
  throw new Error("state 必须是对象,或可解析为对象的 JSON 字符串");
}

/** 章末状态记录工具集(spec §6.3):角色状态 / 出场 / 伏笔 / 时间线 */
export function makeStateTools(deps: StateToolsDeps): Record<string, Tool> {
  return {
    create_character: tool({
      description: "登记本章新出现、且档案里还没有的角色(配角/反派/盟友等)。仅在该角色名不在现有角色列表时调用;已存在的不要重复创建。创建后可再用 add_character_appearance 记录其本章戏份。",
      parameters: z.object({
        name: z.string().describe("角色名"),
        role: z.enum(["protagonist", "antagonist", "supporting"]).describe("定位:主角/反派/配角,拿不准用 supporting"),
        background: z.string().optional().describe("一句话背景/身份"),
        motivation: z.string().optional().describe("动机/目标(如已知)"),
        languageHabits: z.string().optional().describe("说话/行为习惯(如已知)"),
      }),
      execute: async ({ name, role, background, motivation, languageHabits }) => {
        const existing = deps.charactersRepo.list().find(x => x.name === name);
        if (existing) return { skipped: "角色已存在", name };
        const baseData: Record<string, unknown> = {};
        if (background) baseData.background = background;
        if (motivation) baseData.motivation = motivation;
        if (languageHabits) baseData.languageHabits = languageHabits;
        const c = deps.charactersRepo.create({ name, role, baseData, currentState: {} });
        return { created: c.name, role };
      },
    }),

    update_character_state: tool({
      description: "更新角色的当前状态(位置/伤势/心境/能力/持有物/关系等),merge 到现有状态。本章中角色发生重要变化时调用。",
      parameters: z.object({
        name: z.string().describe("角色名"),
        state: stateRecordSchema.describe("状态字段,如 {位置:'某地',能力:'已知能力',持有:'关键物品'}。若模型误传 JSON 字符串,本地会解析。"),
      }),
      execute: async ({ name, state }) => {
        const c = findCharacter(deps, name);
        const parsedState = parseStateRecord(state);
        const merged = { ...c.currentState, ...parsedState };
        deps.charactersRepo.update(c.id, { currentState: merged });
        return { updated: name, state: merged };
      },
    }),

    add_character_appearance: tool({
      description: "记录角色在本章出场(一句话概括做了什么)。每个在本章有实质戏份的角色都应记录。",
      parameters: z.object({
        name: z.string().describe("角色名"),
        brief: z.string().describe("本章中该角色的一句话概括"),
      }),
      execute: async ({ name, brief }) => {
        const c = findCharacter(deps, name);
        deps.charactersRepo.addAppearance(c.id, { chapterNo: deps.chapterNo, brief });
        return { recorded: name, chapterNo: deps.chapterNo };
      },
    }),

    add_foreshadowing: tool({
      description: "登记本章新埋下的伏笔(未来需要回收的悬念/线索)。",
      parameters: z.object({
        label: z.string().describe("简短标签,如 '黑剑碎片来历'"),
        description: z.string().optional().describe("伏笔说明"),
        relatedCharacters: z.array(z.string()).optional().describe("关联角色名"),
      }),
      execute: async ({ label, description, relatedCharacters }) => {
        const existing = deps.foreshadowingRepo.list().find(f => f.label === label);
        if (existing) return { skipped: "同名伏笔已存在", label };
        deps.foreshadowingRepo.create({
          label,
          description: description ?? null,
          plantedChapter: deps.chapterNo,
          paidChapter: null,
          status: "active",
          relatedCharacters: relatedCharacters ?? [],
        });
        return { planted: label, chapterNo: deps.chapterNo };
      },
    }),

    pay_foreshadowing: tool({
      description: "标记某伏笔在本章被回收(揭晓/兑现)。",
      parameters: z.object({
        label: z.string().describe("已登记的伏笔标签"),
      }),
      execute: async ({ label }) => {
        const f = deps.foreshadowingRepo.list("active").find(x => x.label === label);
        if (!f) throw new Error(`活跃伏笔不存在:${label}`);
        deps.foreshadowingRepo.pay(f.id, deps.chapterNo);
        return { paid: label, chapterNo: deps.chapterNo };
      },
    }),

    add_timeline_event: tool({
      description: "记录本章的关键事件到时间线(故事内时间 + 事件 + 参与角色)。每章 1-3 条。",
      parameters: z.object({
        storyTime: z.string().describe("故事内时间,如 '当夜' '次日清晨' '三日后'"),
        event: z.string().describe("事件一句话"),
        participants: z.array(z.string()).optional().describe("参与角色名"),
      }),
      execute: async ({ storyTime, event, participants }) => {
        deps.timelineRepo.create({
          chapterNo: deps.chapterNo,
          storyTime,
          event,
          participants: participants ?? [],
        });
        return { recorded: event };
      },
    }),
  };
}
