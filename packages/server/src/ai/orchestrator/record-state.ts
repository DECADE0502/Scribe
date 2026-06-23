import type { LanguageModel } from "ai";
import type { SseEvent } from "@scribe/shared";
import {
  resolveDisplayFieldNames,
  resolveIdentityFieldNames,
  resolveItemIdentityKey,
  resolveItemLabel,
  resolveItemSearchText,
  type GenreFieldRole,
} from "@scribe/shared";
import { streamLlm } from "../llm-call.js";
import { prependDeepestPrompt } from "../prompts/deepest-prompt.js";
import { makeStateTools, type StateToolsDeps } from "../tools/state-tools.js";
import { makeGenreSectionTools, type GenreToolsDeps } from "../tools/genre-section-tools.js";
import { compressArc, compressVolume } from "./compress-arc.js";

export const RECORD_STATE_PROMPT = `你是 Scribe 的设定记录员。刚写完一章,你的任务是把本章新出现/变化的信息记录进结构化档案,供后续章节保持一致性。

你将收到:本章正文、当前已记录的档案概要(通用记录集合/角色/伏笔)。

请按需调用工具,逐项记录:
1. **新角色**(create_character):本章出现、但"当前档案概要"的角色清单里**还没有**的角色(配角/反派/盟友等),先创建。只建有名字、有实质戏份的;一次性龙套不必建。
2. **角色状态**(update_character_state):角色的位置、能力、持有物、心境、关系等发生重要变化时更新(新建的角色也补上当前状态)。
3. **角色出场**(add_character_appearance):每个在本章有实质戏份的角色(含新建的)记一条本章概括。
4. **通用记录集合**:
   - 本章出现了需要长期保持一致的新对象、规则、资源、关系、线索或状态时,先判断现有集合是否能表达。
   - 能表达:调用 upsert_record_item 写入或更新条目。
   - 如果已有集合不能表达新信息:先 create_record_collection 或 update_record_collection_schema,再 upsert_record_item。
   - create_record_collection 时必须声明 identityFields/displayFields/searchFields;字段只使用通用 role(identity/label/summary/description/status/rank/relation/tag/evidence)。
   - 本地工具会按 identityFields 去重,不要为了同一对象重复创建条目。
   - 当两个通用记录条目之间出现长期关系时,优先使用 schema 中 role=relation 的字段并调用 link_record_items。若没有合适 relation 字段,先 update_record_collection_schema 添加通用 relation 字段,再 link。不要把关系含义写成本地逻辑;关系语义只存在于集合名、字段名和 AI 写入的数据里。
5. **伏笔**(add_foreshadowing / pay_foreshadowing):本章埋下或回收的悬念。**注意主动回收**:本章若揭晓/兑现了某条活跃伏笔,务必用 pay_foreshadowing 标记,别让它一直挂着。
6. **时间线**(add_timeline_event):本章 1-3 个关键事件。

纪律(防止档案暴涨,务必遵守):
- 只记录本章**确实出现**的内容,不要脑补未出现的设定
- **克制建档**:每章最多新建 2-3 个角色、最多新埋 2 条伏笔。只为有实质戏份的关键人物建档,路人/一次性配角一律不建;每个悬念/疑问不要都登记成伏笔,只登记后续真的会回收的核心伏笔。(工具有每章上限,超额会被拒绝——这是提醒你优先取舍,而不是凑满。)
- **更新优先于新建**:已存在的角色用 update_character_state,不要重复 create_character。
- 通用记录条目一律用 upsert_record_item 交给本地按 identityFields 去重
- 全部记录完后,输出一行中文总结(记录了几条什么)`;

export interface RecordStateDeps {
  model: LanguageModel;
  stateDeps: StateToolsDeps;
  genreDeps: GenreToolsDeps;
  abortSignal?: AbortSignal;
  /** 用户最深处提示词,原文拼到最前端 */
  deepestPrompt?: string;
  /** 可选:记录状态时若有工具调用失败,写一条 reader issue 警告(可信报告,不阻断章节) */
  readerIssuesRepo?: {
    create(input: { chapterNo: number; type: "continuity"; severity: "warning"; note: string }): unknown;
  };
  /** 可选:outline 仓库,供 arc/volume 边界检测与 summary 写入 */
  outlineRepo?: {
    findChapterNode(chapterNo: number): { id: string; parentId: string | null; metadata: Record<string, unknown> | null } | undefined;
    get(id: string): { id: string; parentId: string | null; level: string; title: string; summary: string | null } | undefined;
    listChildren(parentId: string | null): Array<{ id: string; level: string; title: string; summary: string | null; metadata: Record<string, unknown> | null }>;
    updateSummary(id: string, summary: string | null): void;
  };
  /** 可选:章节摘要仓库,供取该 arc 的小总结做压缩 */
  chaptersRepo?: { listSummaries(): Array<{ chapterNo: number; oneLiner: string; paragraph: string }> };
}

export interface RecordStateInput {
  chapterNo: number;
  chapterContent: string;
  /** 当前档案概要(板块 schema + 已有条目名 + 角色 + 活跃伏笔),由调用方组装 */
  archiveSummary: string;
  /** If present and failed, durable state recording must not run. */
  qualityGateResult?: { passed: boolean; blockingIssues: string[] };
}

function shouldCountSuccessfulUpsert(ev: SseEvent): boolean {
  if (ev.type !== "tool_call_end" || ev.toolName !== "upsert_record_item") return false;
  const result = ev.result as { success?: unknown } | undefined;
  return result?.success !== false;
}

async function* runRecordPass(
  deps: RecordStateDeps,
  tools: ReturnType<typeof makeStateTools> & ReturnType<typeof makeGenreSectionTools>,
  messages: Parameters<typeof streamLlm>[0]["messages"],
): AsyncGenerator<SseEvent, { hadError: boolean; hadSuccessfulUpsert: boolean; failedTools: number; toolCalls: number; terminal: SseEvent[] }, unknown> {
  let hadError = false;
  let hadSuccessfulUpsert = false;
  let failedTools = 0;
  let toolCalls = 0;
  const terminal: SseEvent[] = [];
  for await (const ev of streamLlm({
    model: deps.model,
    messages: prependDeepestPrompt(messages, deps.deepestPrompt),
    tools,
    maxSteps: 16,
    abortSignal: deps.abortSignal,
    providerOptions: { deepseek: { thinking: { type: "disabled" } } },
  })) {
    if (shouldCountSuccessfulUpsert(ev)) hadSuccessfulUpsert = true;
    if (ev.type === "tool_call_end") {
      toolCalls += 1;
      // withToolErrorRecovery 把工具异常包成 { success:false, error };这里据此统计失败
      const result = ev.result as { success?: unknown } | undefined;
      if (result?.success === false) failedTools += 1;
    }
    if (ev.type === "error") hadError = true;
    if (ev.type === "usage" || ev.type === "done") {
      terminal.push(ev);
    } else {
      yield ev;
    }
  }
  return { hadError, hadSuccessfulUpsert, failedTools, toolCalls, terminal };
}

/**
 * 弧/卷边界检测 + 压缩。若本章是其所在 arc/volume 的末章,且所有子 chapter 都已有
 * ChapterSummary,则跑一趟 LLM 压缩生成 ArcSummary/VolumeSummary 写进 outline_nodes.summary。
 * 失败时写一条 reader_issue 警告,不阻断章节。
 */
async function compressArcBoundary(
  deps: RecordStateDeps,
  input: RecordStateInput,
): Promise<void> {
  if (!deps.outlineRepo || !deps.chaptersRepo) return;
  const chapterNode = deps.outlineRepo.findChapterNode(input.chapterNo);
  if (!chapterNode?.parentId) return;

  const arc = deps.outlineRepo.get(chapterNode.parentId);
  if (!arc || arc.level !== "arc") return;

  // 获取本 arc 所有 chapter 子节点,找出最大章号
  const siblings = deps.outlineRepo.listChildren(arc.id)
    .filter((n) => n.level === "chapter");
  const arcChapterNos = siblings
    .map((n) => (n.metadata as Record<string, unknown> | null)?.chapterNo)
    .filter((no): no is number => typeof no === "number");
  if (arcChapterNos.length === 0) return;
  const maxNo = Math.max(...arcChapterNos);
  if (input.chapterNo !== maxNo) return;

  // 所有 chapter 是否都有 ChapterSummary?
  const allSummariesMap = new Map(
    deps.chaptersRepo.listSummaries().map((s) => [s.chapterNo, s]),
  );
  const allDone = arcChapterNos.every((no) => allSummariesMap.has(no));
  if (!allDone) return;

  try {
    const arcSummary = await compressArc({
      model: deps.model,
      abortSignal: deps.abortSignal,
      deepestPrompt: deps.deepestPrompt,
      chapterSummaries: arcChapterNos
        .sort((a, b) => a - b)
        .map((no) => {
          const s = allSummariesMap.get(no)!;
          return { chapterNo: no, oneLiner: s.oneLiner, paragraph: s.paragraph };
        }),
    });
    deps.outlineRepo.updateSummary(arc.id, arcSummary);

    // Volume 边界检测:若 volume 的所有 arc 都有 summary,进一步压成 VolumeSummary
    await compressVolumeBoundary(deps, input, arc, arcSummary);
  } catch (e) {
    deps.readerIssuesRepo?.create({
      chapterNo: input.chapterNo,
      type: "continuity",
      severity: "warning",
      note: `弧总结压缩失败:${(e as Error).message};弧 ${arc.title} 暂无 summary。`,
    });
  }
}

async function compressVolumeBoundary(
  deps: RecordStateDeps,
  input: RecordStateInput,
  arc: { id: string; parentId: string | null; title: string },
  arcSummary: string,
): Promise<void> {
  if (!arc.parentId || !deps.outlineRepo) return;
  const volume = deps.outlineRepo.get(arc.parentId);
  if (!volume || volume.level !== "volume") return;

  const arcs = deps.outlineRepo.listChildren(volume.id)
    .filter((n) => n.level === "arc");
  // 用已写 summary 或刚生成的最新值
  const allArcsDone = arcs.every(
    (a) => a.id === arc.id || !!a.summary,
  );
  if (!allArcsDone) return;

  try {
    const updatedArcs = arcs.map((a) =>
      a.id === arc.id ? { ...a, summary: arcSummary } : a,
    );
    const volSummary = await compressVolume({
      model: deps.model,
      abortSignal: deps.abortSignal,
      deepestPrompt: deps.deepestPrompt,
      arcSummaries: updatedArcs.map((a) => ({
        nodeTitle: a.title,
        text: a.summary!,
      })),
    });
    deps.outlineRepo.updateSummary(volume.id, volSummary);
  } catch (e) {
    deps.readerIssuesRepo?.create({
      chapterNo: input.chapterNo,
      type: "continuity",
      severity: "warning",
      note: `卷总结压缩失败:${(e as Error).message};卷 ${volume.title} 暂无 summary。`,
    });
  }
}

export async function* recordChapterState(
  deps: RecordStateDeps,
  input: RecordStateInput,
): AsyncIterable<SseEvent> {
  if (input.qualityGateResult && !input.qualityGateResult.passed) {
    yield {
      type: "error",
      errorClass: "quality_gate_blocked_state_recording",
      message: [
        "质量门禁未通过,本章不会写入长期记忆。",
        ...input.qualityGateResult.blockingIssues.map((issue) => `- ${issue}`),
      ].join("\n"),
    };
    return;
  }

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

  const baseMessages = [
    { role: "system" as const, content: RECORD_STATE_PROMPT },
    { role: "user" as const, content: userMsg },
  ];
  // 单趟记录:此前"没写 upsert 就把 16 步整轮重跑"会让 record-state 成本/延迟翻倍,
  // 收益却很有限(模型本就被提示要落库)。改为只跑一趟,显著降本提速。
  const first = yield* runRecordPass(deps, tools, baseMessages);
  // 可信报告:有工具失败则写一条 reader issue(不阻断章节,但让失败可见、可在记忆体检中复核)
  if (first.failedTools > 0) {
    try {
      deps.readerIssuesRepo?.create({
        chapterNo: input.chapterNo,
        type: "continuity",
        severity: "warning",
        note: `本章状态记录有 ${first.failedTools}/${first.toolCalls} 个工具调用失败,部分角色/伏笔/记录可能未落库,建议复核。`,
      });
    } catch { /* 写警告失败不致命 */ }
  }
  // 弧/卷边界检测:写完本章小总结后,判断是否是 arc/volume 的末章。
  // 若是且所有子章节都有 summary,跑一趟压缩生成 ArcSummary/VolumeSummary 写进 outline_nodes。
  await compressArcBoundary(deps, input);
  // 计费标注:记录用审查模型,标为 audit + 本章号
  for (const ev of first.terminal) {
    if (ev.type === "usage") {
      yield { ...ev, modelRole: "audit", taskType: "audit", chapterNo: input.chapterNo };
    } else {
      yield ev;
    }
  }
}

/** 组装档案概要(给 record prompt 用) */
export interface ArchiveSummarySources {
  genreSections: Array<{
    section: {
      name: string;
      identityFields?: string[];
      displayFields?: string[];
      searchFields?: string[];
      schema: Array<{ name: string; type: unknown; required?: boolean; role?: GenreFieldRole; isLabel?: boolean }>;
    };
    items: Array<{ data: Record<string, unknown> }>;
  }>;
  characters: Array<{ name: string; currentState: Record<string, unknown> }>;
  activeForeshadowing: Array<{ label: string }>;
}

export function buildArchiveSummary(src: ArchiveSummarySources): string {
  const parts: string[] = [];
  parts.push("### 通用记录集合(schema 与已有条目)");
  for (const { section, items } of src.genreSections) {
    const schemaDesc = section.schema
      .map(f => `${f.name}${f.required ? "*" : ""}:${typeof f.type === "string" ? f.type : "enum"}${f.role ? `(${f.role})` : ""}`)
      .join(", ");
    const identity = resolveIdentityFieldNames(section).join(",") || "(未声明)";
    const display = resolveDisplayFieldNames(section).join(",") || "(未声明)";
    const search = section.searchFields?.join(",") || "(未声明)";
    parts.push(
      `- ${section.name}(identity:${identity}; display:${display}; search:${search}; 字段:${schemaDesc})`,
    );
    if (!items.length) {
      parts.push("  已有:(空)");
    } else {
      parts.push("  已有:");
      for (const item of items) {
        const label = resolveItemLabel(section, item.data, "?");
        const identityKey = resolveItemIdentityKey(section, item.data) ?? "?";
        const searchText = resolveItemSearchText(section, item.data);
        parts.push(`  - ${label} | ${identityKey}${searchText ? ` | ${searchText}` : ""}`);
      }
    }
  }
  parts.push("### 角色与当前状态");
  for (const c of src.characters) {
    parts.push(`- ${c.name}:${JSON.stringify(c.currentState)}`);
  }
  parts.push("### 活跃伏笔");
  parts.push(src.activeForeshadowing.map(f => f.label).join("、") || "(无)");
  return parts.join("\n");
}
