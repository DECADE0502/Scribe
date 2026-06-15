import type { LanguageModel } from "ai";
import type { SseEvent } from "@scribe/shared";
import { resolveItemLabel } from "@scribe/shared";
import { streamLlm } from "../llm-call.js";
import { prependDeepestPrompt } from "../prompts/deepest-prompt.js";
import { makeStateTools, type StateToolsDeps } from "../tools/state-tools.js";
import { makeGenreSectionTools, type GenreToolsDeps } from "../tools/genre-section-tools.js";

export const RECORD_STATE_PROMPT = `你是 Scribe 的设定记录员。刚写完一章,你的任务是把本章新出现/变化的信息记录进结构化档案,供后续章节保持一致性。

你将收到:本章正文、当前已记录的档案概要(板块/角色/伏笔)。

请按需调用工具,逐项记录:
1. **新角色**(create_character):本章出现、但"当前档案概要"的角色清单里**还没有**的角色(配角/反派/盟友等),先创建。只建有名字、有实质戏份的;一次性龙套不必建。
2. **角色状态**(update_character_state):角色的位置/修为/持有物/心境发生重要变化时更新(新建的角色也补上当前状态)。
3. **角色出场**(add_character_appearance):每个在本章有实质戏份的角色(含新建的)记一条本章概括。
4. **题材板块条目**(add_genre_section_item):本章出现的功法、法器、丹药、势力、境界、异能等,板块里没有就添加。data 字段必须符合该板块的 schema(概要里有列出)。
5. **伏笔**(add_foreshadowing / pay_foreshadowing):本章埋下或回收的悬念。**注意主动回收**:本章若揭晓/兑现了某条活跃伏笔,务必用 pay_foreshadowing 标记,别让它一直挂着。
6. **时间线**(add_timeline_event):本章 1-3 个关键事件。

纪律:
- 只记录本章**确实出现**的内容,不要脑补未出现的设定
- 已记录过的条目/角色不要重复添加(概要里列了已有的)
- 全部记录完后,输出一行中文总结(记录了几条什么)`;

export interface RecordStateDeps {
  model: LanguageModel;
  stateDeps: StateToolsDeps;
  genreDeps: GenreToolsDeps;
  abortSignal?: AbortSignal;
  /** 用户最深处提示词,原文拼到最前端 */
  deepestPrompt?: string;
}

export interface RecordStateInput {
  chapterNo: number;
  chapterContent: string;
  /** 当前档案概要(板块 schema + 已有条目名 + 角色 + 活跃伏笔),由调用方组装 */
  archiveSummary: string;
}

export async function* recordChapterState(
  deps: RecordStateDeps,
  input: RecordStateInput,
): AsyncIterable<SseEvent> {
  const tools = {
    ...makeStateTools(deps.stateDeps),
    ...makeGenreSectionTools(deps.genreDeps),
  };
  const userMsg = [
    `## 第 ${input.chapterNo} 章正文`,
    input.chapterContent,
    "",
    "## 当前档案概要",
    input.archiveSummary,
  ].join("\n");

  yield* streamLlm({
    model: deps.model,
    messages: prependDeepestPrompt([
      { role: "system", content: RECORD_STATE_PROMPT },
      { role: "user", content: userMsg },
    ], deps.deepestPrompt),
    tools,
    maxSteps: 16,
    abortSignal: deps.abortSignal,
  });
}

/** 组装档案概要(给 record prompt 用) */
export interface ArchiveSummarySources {
  genreSections: Array<{
    section: { name: string; schema: Array<{ name: string; type: unknown; required?: boolean }> };
    items: Array<{ data: Record<string, unknown> }>;
  }>;
  characters: Array<{ name: string; currentState: Record<string, unknown> }>;
  activeForeshadowing: Array<{ label: string }>;
}

export function buildArchiveSummary(src: ArchiveSummarySources): string {
  const parts: string[] = [];
  parts.push("### 题材板块(schema 与已有条目)");
  for (const { section, items } of src.genreSections) {
    const schemaDesc = section.schema
      .map(f => `${f.name}${f.required ? "*" : ""}:${typeof f.type === "string" ? f.type : "enum"}`)
      .join(", ");
    const itemNames = items
      .map(i => resolveItemLabel(section.schema, i.data, "?"))
      .join("、");
    parts.push(`- ${section.name}(字段:${schemaDesc})已有:${itemNames || "(空)"}`);
  }
  parts.push("### 角色与当前状态");
  for (const c of src.characters) {
    parts.push(`- ${c.name}:${JSON.stringify(c.currentState)}`);
  }
  parts.push("### 活跃伏笔");
  parts.push(src.activeForeshadowing.map(f => f.label).join("、") || "(无)");
  return parts.join("\n");
}
