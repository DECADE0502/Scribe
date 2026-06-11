import type { CoreMessage, LanguageModel } from "ai";
import type { SseEvent } from "@scribe/shared";
import { parseSlashCommand, SLASH_COMMANDS } from "@scribe/shared";
import type { BookHandle } from "../../http/book-registry.js";
import { streamLlm } from "../llm-call.js";
import { writeWithAudit } from "./write-with-audit.js";
import { auditChapter } from "./audit-chapter.js";
import { persistAuditResult } from "./audit-persist.js";
import { recordChapterState, buildArchiveSummary } from "./record-state.js";
import { recallChapters } from "../context-builder/recall.js";
import {
  buildBookPromptContext,
  buildChapterWriteMessages,
} from "../context-builder/book-context.js";
import { makeGenreSectionTools } from "../tools/genre-section-tools.js";
import { makeStateTools } from "../tools/state-tools.js";
import { classifyIntent, type IntentCategory } from "./intent.js";

export interface ConversationOrchestratorDeps {
  handle: BookHandle;
  /** 写作模型 */
  model: LanguageModel;
  /** 审查 / 分类用的便宜模型 */
  auditModel: LanguageModel;
  auditModelId: string;
  abortSignal?: AbortSignal;
}

export interface ConversationInput {
  message: string;
  history?: CoreMessage[];
}

const CHAT_SYSTEM = `你是 Scribe,一个对话式中文长篇小说创作助手。你能看到这本书已有的设定与前情。
用简洁贴近中文的表达回答。当用户想新增或修改题材资料(功法/道具/势力/地点等)时,直接调用工具落地到资料库,不要只口头描述。`;

/** 组装某章的状态记录 pass(写完一章后落地题材条目/角色/伏笔/时间线)。 */
async function* recordStateForChapter(
  deps: ConversationOrchestratorDeps,
  chapterNo: number,
): AsyncIterable<SseEvent> {
  const { handle } = deps;
  const chapter = handle.chapterFiles.read(chapterNo);
  if (!chapter) return;
  const archiveSummary = buildArchiveSummary({
    genreSections: handle.genreSectionsRepo.listSections().map((section) => ({
      section,
      items: handle.genreSectionsRepo.listItems(section.id),
    })),
    characters: handle.charactersRepo.list(),
    activeForeshadowing: handle.foreshadowingRepo.list("active"),
  });
  yield { type: "tool_call_start", toolName: "record_chapter_state", args: { chapterNo } };
  let ok = true;
  for await (const ev of recordChapterState(
    {
      model: deps.auditModel,
      stateDeps: {
        charactersRepo: handle.charactersRepo,
        foreshadowingRepo: handle.foreshadowingRepo,
        timelineRepo: handle.timelineRepo,
        chapterNo,
      },
      genreDeps: { repo: handle.genreSectionsRepo, charactersRepo: handle.charactersRepo },
      abortSignal: deps.abortSignal,
    },
    { chapterNo, chapterContent: chapter.content, archiveSummary },
  )) {
    if (ev.type === "error") { ok = false; break; }
    if (ev.type === "tool_call_start" || ev.type === "tool_call_end") yield ev;
  }
  yield { type: "tool_call_end", toolName: "record_chapter_state", result: { success: ok } };
}

/** 写/重写一章并审查 + 记录状态。chapterNo 缺省时写下一章。 */
async function* writeChapterFlow(
  deps: ConversationOrchestratorDeps,
  chapterNo: number,
  userIntent: string,
): AsyncIterable<SseEvent> {
  const { handle } = deps;
  const promptCtx = buildBookPromptContext(handle);
  let chapterFailed = false;
  for await (const ev of writeWithAudit(
    {
      model: deps.model,
      auditModel: deps.auditModel,
      auditModelId: deps.auditModelId,
      chaptersRepo: handle.chaptersRepo,
      chapterFiles: handle.chapterFiles,
    },
    {
      chapterNo,
      userIntent,
      prebuiltMessages: buildChapterWriteMessages(handle, chapterNo, userIntent).messages,
      auditCtx: promptCtx.auditCtx,
      enableRepair: true,
      abortSignal: deps.abortSignal,
    },
  )) {
    if (ev.type === "done") continue; // 末尾统一收尾
    if (ev.type === "error") { yield ev; chapterFailed = true; break; }
    yield ev;
  }
  if (chapterFailed) return;
  yield* recordStateForChapter(deps, chapterNo);
}

/** 闲聊 / 问答 / 题材操作:带书设定上下文 + 题材/状态工具的对话。 */
async function* chatWithContext(
  deps: ConversationOrchestratorDeps,
  input: ConversationInput,
  withTools: boolean,
): AsyncIterable<SseEvent> {
  const { handle } = deps;
  const promptCtx = buildBookPromptContext(handle);
  const recent = handle.chaptersRepo
    .listSummaries()
    .slice(-3)
    .map((s) => `第${s.chapterNo}章:${s.oneLiner}`)
    .join("\n");
  const contextBlock = [
    promptCtx.writeCtx.premise ? `# 故事设定\n${promptCtx.writeCtx.premise}` : "",
    promptCtx.writeCtx.characters ? `# 角色\n${promptCtx.writeCtx.characters}` : "",
    recent ? `# 最近章节\n${recent}` : "",
  ].filter(Boolean).join("\n\n");

  const tools = withTools
    ? {
        ...makeGenreSectionTools({ repo: handle.genreSectionsRepo, charactersRepo: handle.charactersRepo }),
      }
    : undefined;

  const messages: CoreMessage[] = [
    { role: "system", content: CHAT_SYSTEM },
    ...(contextBlock ? [{ role: "system" as const, content: contextBlock }] : []),
    ...(input.history ?? []),
    { role: "user", content: input.message },
  ];
  yield* streamLlm({ model: deps.model, messages, tools, maxSteps: withTools ? 12 : 1, abortSignal: deps.abortSignal });
}

function helpText(): string {
  return ["可用命令:", ...SLASH_COMMANDS.map((c) => `${c.aliases.join(" / ")} — ${c.help}`)].join("\n");
}

async function* recallFlow(
  deps: ConversationOrchestratorDeps,
  keyword: string,
): AsyncIterable<SseEvent> {
  const all = deps.handle.chaptersRepo.listSummaries();
  const max = deps.handle.chaptersRepo.maxChapterNo();
  const hits = recallChapters({
    allSummaries: all,
    currentChapterNo: max + 1,
    intentCharacters: keyword ? [keyword] : deps.handle.charactersRepo.list().map((c) => c.name),
    intentForeshadowing: keyword ? [keyword] : deps.handle.foreshadowingRepo.list("active").map((f) => f.label),
    topK: 5,
  });
  const text = hits.length
    ? [`找到 ${hits.length} 个相关章节:`, ...hits.map((s) => `· 第${s.chapterNo}章 ${s.oneLiner}`)].join("\n")
    : `没有找到与「${keyword || "当前线索"}」相关的历史章节。`;
  for (const ch of text) yield { type: "text_delta", delta: ch };
  yield { type: "done" };
}

async function* auditFlow(
  deps: ConversationOrchestratorDeps,
  chapterNo: number,
): AsyncIterable<SseEvent> {
  const { handle } = deps;
  const chapter = handle.chapterFiles.read(chapterNo);
  if (!chapter) {
    for (const ch of `第 ${chapterNo} 章还没有正文,无法审查。`) yield { type: "text_delta", delta: ch };
    yield { type: "done" };
    return;
  }
  const promptCtx = buildBookPromptContext(handle);
  yield { type: "tool_call_start", toolName: "chapter_audit", args: { chapterNo } };
  try {
    const result = await auditChapter(
      { model: deps.auditModel, abortSignal: deps.abortSignal },
      { chapterNo, chapterContent: chapter.content, ...promptCtx.auditCtx },
    );
    persistAuditResult(handle.chaptersRepo, chapterNo, result, deps.auditModelId);
    yield {
      type: "tool_call_end", toolName: "chapter_audit",
      result: { verdict: result.output.verdict, issuesCount: result.output.issues.length, summary: result.output.summary },
    };
    const lines = [
      `第 ${chapterNo} 章审查结论:${result.output.verdict}`,
      ...result.output.issues.map((i) => `· [${i.severity}] ${i.dimension}:${i.note}`),
    ].join("\n");
    for (const ch of lines) yield { type: "text_delta", delta: ch };
    yield { type: "done" };
  } catch (e) {
    yield { type: "error", errorClass: "audit_failed", message: `审查失败:${(e as Error).message}` };
  }
}

/**
 * 对话总入口(spec §7.3 意图识别 + §7.4 斜杠命令路由)。
 * 1) 斜杠命令 → command_explicit,确定性分派
 * 2) 自然语言 → 意图分类 → 分派
 * 每一步先 yield 一个 intent 事件,前端可展示"识别到的意图"。
 */
export async function* runConversation(
  deps: ConversationOrchestratorDeps,
  input: ConversationInput,
): AsyncIterable<SseEvent> {
  const parsed = parseSlashCommand(input.message);

  if (parsed.kind === "command") {
    yield { type: "intent", category: "command_explicit", command: parsed.id };
    const maxNo = deps.handle.chaptersRepo.maxChapterNo();
    switch (parsed.id) {
      case "write":
        yield* writeChapterFlow(deps, maxNo + 1, parsed.args);
        yield { type: "done" };
        return;
      case "rewrite": {
        const target = maxNo >= 1 ? maxNo : 1;
        yield* writeChapterFlow(deps, target, `重写第 ${target} 章,改进质量。${parsed.args}`);
        yield { type: "done" };
        return;
      }
      case "audit":
        yield* auditFlow(deps, maxNo >= 1 ? maxNo : 1);
        return;
      case "recall":
        yield* recallFlow(deps, parsed.args);
        return;
      case "note": {
        deps.handle.conversationsRepo.append({ role: "user", content: parsed.args, metadata: { kind: "note" } });
        for (const ch of `已记下便签:${parsed.args}`) yield { type: "text_delta", delta: ch };
        yield { type: "done" };
        return;
      }
      case "revise":
        for (const ch of "改写选中段请在中栏编辑器里选中文字后操作(选中后会弹出改写工具条)。") {
          yield { type: "text_delta", delta: ch };
        }
        yield { type: "done" };
        return;
      case "help":
        for (const ch of helpText()) yield { type: "text_delta", delta: ch };
        yield { type: "done" };
        return;
      case "auto":
        // /auto 由前端直连 /auto 端点;走到这里说明是异常入口,给出提示
        for (const ch of "自动写作请用 /auto N(例如 /auto 5),它会在顶部进度条里运行。") {
          yield { type: "text_delta", delta: ch };
        }
        yield { type: "done" };
        return;
    }
  }

  // 自然语言:意图分类后分派
  const intent: IntentCategory = await classifyIntent(deps.auditModel, input.message, deps.abortSignal);
  yield { type: "intent", category: intent };

  switch (intent) {
    case "writing_intent":
      yield* writeChapterFlow(deps, deps.handle.chaptersRepo.maxChapterNo() + 1, input.message);
      yield { type: "done" };
      return;
    case "query":
      yield* chatWithContext(deps, input, false);
      return;
    case "genre_section_op":
      yield* chatWithContext(deps, input, true);
      return;
    case "revise_intent":
      for (const ch of "想改已写的内容?在中栏编辑器选中那段文字会弹出改写工具条;或用 /rewrite 重写整章。") {
        yield { type: "text_delta", delta: ch };
      }
      yield { type: "done" };
      return;
    case "chitchat":
    case "other":
    default:
      // 即便分类不准,也带上书的设定上下文回答,避免"失忆式"闲聊
      yield* chatWithContext(deps, input, false);
      return;
  }
}
