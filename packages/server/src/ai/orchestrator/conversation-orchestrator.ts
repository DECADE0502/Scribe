import type { CoreMessage, LanguageModel } from "ai";
import type { SseEvent } from "@scribe/shared";
import { parseSlashCommand, SLASH_COMMANDS } from "@scribe/shared";
import type { BookHandle } from "../../http/book-registry.js";
import { streamLlm } from "../llm-call.js";
import { prependDeepestPrompt } from "../prompts/deepest-prompt.js";
import { writeWithAudit } from "./write-with-audit.js";
import { auditChapter } from "./audit-chapter.js";
import { persistAuditResult } from "./audit-persist.js";
import { recordChapterState, buildArchiveSummary } from "./record-state.js";
import { recallChapters } from "../context-builder/recall.js";
import {
  buildBookPromptContext,
  buildChapterWriteMessages,
  enrichUserIntentWithOutline,
} from "../context-builder/book-context.js";
import { makeGenreSectionTools } from "../tools/genre-section-tools.js";
import { makeBookTools } from "../tools/book-tools.js";
import { classifyIntent, type IntentCategory } from "./intent.js";

/** 明确的写作意图关键词:命中即直接当 writing_intent,免一次分类往返,也避免分类器误判 */
const WRITE_HINT = /(写下一章|写第.{0,3}章|续写|接着写|继续写|往下写|write\s+next)/i;
const REWRITE_HINT = /(重写|重新写|改写|rewrite)/i;

function parseChineseChapterNumber(raw: string): number | undefined {
  const text = raw.trim();
  if (/^\d+$/.test(text)) return Number(text);
  const digits: Record<string, number> = {
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  if (text === "十") return 10;
  const tenIndex = text.indexOf("十");
  if (tenIndex >= 0) {
    const left = text.slice(0, tenIndex);
    const right = text.slice(tenIndex + 1);
    const tens = left ? digits[left] : 1;
    const ones = right ? digits[right] : 0;
    if (tens === undefined || ones === undefined) return undefined;
    return tens * 10 + ones;
  }
  let result = 0;
  for (const char of text) {
    const digit = digits[char];
    if (digit === undefined) return undefined;
    result = result * 10 + digit;
  }
  return result || undefined;
}

function parseRewriteTargetChapter(message: string): number | undefined {
  if (!REWRITE_HINT.test(message)) return undefined;
  const match = message.match(/(?:重写|重新写|改写|rewrite)\s*(?:第)?\s*([0-9]+|[零〇一二两三四五六七八九十]{1,6})\s*章?/i);
  if (!match) return undefined;
  const parsed = parseChineseChapterNumber(match[1]!);
  return parsed && parsed >= 1 ? parsed : undefined;
}

const DELETE_HINT = /(删除|删掉|去掉|清空|清除|delete|remove)/i;
const DELETE_ALL_HINT = /(所有章节|全部章节|所有章|全部章|all\s*chapters)/i;

/** 解析"删除第 N 章"的目标章号；"删除所有章节"返回 1（回档到书初） */
function parseDeleteTargetChapter(message: string): number | undefined {
  if (!DELETE_HINT.test(message)) return undefined;
  if (DELETE_ALL_HINT.test(message)) return 1;
  const match = message.match(/(?:删除|删掉|去掉)\s*(?:第)?\s*([0-9]+|[零〇一二两三四五六七八九十]{1,6})\s*章?/i);
  if (!match) return undefined;
  const parsed = parseChineseChapterNumber(match[1]!);
  return parsed && parsed >= 1 ? parsed : undefined;
}

/** 把一段已成形的静态文本作为单个 text_delta 发出(避免逐字符刷屏)。 */
async function* cannedText(text: string): AsyncIterable<SseEvent> {
  yield { type: "text_delta", delta: text };
  yield { type: "done" };
}

export interface ConversationOrchestratorDeps {
  handle: BookHandle;
  /** 写作模型 */
  model: LanguageModel;
  /** 审查 / 分类用的便宜模型 */
  auditModel: LanguageModel;
  auditModelId: string;
  abortSignal?: AbortSignal;
  /** 用户最深处提示词,原文拼到最前端 */
  deepestPrompt?: string;
}

export interface ConversationInput {
  message: string;
  history?: CoreMessage[];
}

const CHAT_SYSTEM = `你是 Scribe，一个对话式中文长篇小说创作助手。你能看到这本书的设定、角色、大纲、伏笔、时间线和已有章节。

你的职责是理解用户的创作需求，然后直接调用工具执行操作，不要只口头描述。

你有完整的工具库，可以：
- 查看和修改书的设定（前提/调性/题材/书名）：update_book_meta
- 查看和修改大纲：list_outline / add_outline_node / update_outline_node / delete_outline_node
- 查看和管理角色：list_characters / create_character / update_character / delete_character
- 查看和管理伏笔：list_foreshadowing / create_foreshadowing / pay_foreshadowing / delete_foreshadowing
- 查看时间线：list_timeline
- 检索历史章节：recall_chapters
- 查看书状态：get_book_status
- 管理通用记录（世界规则、关系、线索等）：create_record_collection / upsert_record_item 等通用记录工具

注意：写下一章、重写章节、删除章节、审查章节这些操作不需要你调用工具，系统会自动识别这些意图并执行完整流程。你只需要简短回应用户即可。

操作原则：
1. 用户说改什么就调对应工具改，改完简短确认即可，不要重复用户的话
2. 用户问问题时，先调工具查到事实再回答，不要编造
3. 用简洁贴近中文的表达，不要写长篇大论的解释`;

/** 组装某章的状态记录 pass(写完一章后落地题材条目/角色/伏笔/时间线)。 */
async function* recordStateForChapter(
  deps: ConversationOrchestratorDeps,
  chapterNo: number,
  qualityGateResult?: { passed: boolean; blockingIssues: string[] },
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
      deepestPrompt: deps.deepestPrompt,
    },
    {
      chapterNo,
      chapterContent: chapter.content,
      archiveSummary,
      qualityGateResult: qualityGateResult
        ? { passed: qualityGateResult.passed, blockingIssues: qualityGateResult.blockingIssues }
        : undefined,
    },
  )) {
    if (ev.type === "error") { ok = false; break; }
    if (ev.type === "tool_call_start" || ev.type === "tool_call_end") yield ev;
  }
  yield { type: "tool_call_end", toolName: "record_chapter_state", result: { success: ok } };
}

/**
 * 写/重写一章并审查 + 记录状态。
 * mode="rewrite":带上该章现有正文,要求改进重写,落盘 source=ai_rewrite。
 */
async function* writeChapterFlow(
  deps: ConversationOrchestratorDeps,
  chapterNo: number,
  userIntent: string,
  mode: "write" | "rewrite" = "write",
): AsyncIterable<SseEvent> {
  const { handle } = deps;
  const promptCtx = buildBookPromptContext(handle);

  // 查找本章对应的大纲节点，把大纲摘要拼进 userIntent
  const fullUserIntent = enrichUserIntentWithOutline(handle.outlineRepo, chapterNo, userIntent);

  let taskInstruction: string | undefined;
  if (mode === "rewrite") {
    const current = handle.chapterFiles.read(chapterNo);
    taskInstruction = [
      `# 任务`,
      `重写第 ${chapterNo} 章并改进质量(承接前文、修正问题、提升文笔)。${fullUserIntent}`.trim(),
      `直接输出改写后的正文,不要标题、不要前言、不要解释。`,
      "",
      `# 当前正文(待改进)`,
      current?.content ?? "(无现有正文,按新章处理)",
    ].join("\n");
  }

  let chapterFailed = false;
  /** 从 writeWithAudit 事件流里捕获的硬事实闸门结果 */
  let hardFactGateResult: { passed: boolean; blockingIssues: string[] } | undefined;
  for await (const ev of writeWithAudit(
    {
      model: deps.model,
      auditModel: deps.auditModel,
      auditModelId: deps.auditModelId,
      chaptersRepo: handle.chaptersRepo,
      chapterFiles: handle.chapterFiles,
      readerIssuesRepo: handle.readerIssuesRepo,
    },
    {
      chapterNo,
      userIntent: fullUserIntent,
      prebuiltMessages: buildChapterWriteMessages(handle, chapterNo, fullUserIntent, taskInstruction).messages,
      source: mode === "rewrite" ? "ai_rewrite" : "ai_write",
      auditCtx: promptCtx.auditCtx,
      enableRepair: true,
      broadcastHardFactGate: true,
      abortSignal: deps.abortSignal,
      deepestPrompt: deps.deepestPrompt,
    },
  )) {
    if (ev.type === "done") continue; // 末尾统一收尾
    if (ev.type === "error") { yield ev; chapterFailed = true; break; }
    // 捕获硬事实闸门结果
    if (ev.type === "tool_call_end" && ev.toolName === "hard_fact_gate") {
      const result = ev.result as { passed?: boolean; blockingIssues?: string[] };
      hardFactGateResult = {
        passed: result.passed ?? true,
        blockingIssues: result.blockingIssues ?? [],
      };
    }
    yield ev;
  }
  if (chapterFailed) return;
  yield* recordStateForChapter(deps, chapterNo, hardFactGateResult);
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

  const messages: CoreMessage[] = prependDeepestPrompt([
    { role: "system", content: CHAT_SYSTEM },
    ...(contextBlock ? [{ role: "system" as const, content: contextBlock }] : []),
    ...(input.history ?? []),
    { role: "user", content: input.message },
  ], deps.deepestPrompt);
  yield* streamLlm({ model: deps.model, messages, tools, maxSteps: withTools ? 12 : 1, abortSignal: deps.abortSignal });
}

/**
 * Agentic 对话：把用户的自然语言消息 + 完整工具库 + 书上下文丢给 AI，
 * 让 AI 自己理解需求、自己决定调什么工具。maxSteps 多步执行让 AI 可以
 * 连续调用多个工具（先查再改、先看大纲再展开等）。
 *
 * 重流程（写章/删章/审查）不走这里——它们在 runConversation 里走确定性
 * 快路径，因为需要流式 yield SSE 事件给前端展示进度，不能在 tool execute
 * 里跑。agenticChat 只管轻量操作：改设定/大纲/角色/伏笔/通用记录/查询。
 */
async function* agenticChat(
  deps: ConversationOrchestratorDeps,
  input: ConversationInput,
): AsyncIterable<SseEvent> {
  const { handle } = deps;
  const promptCtx = buildBookPromptContext(handle);
  const recent = handle.chaptersRepo
    .listSummaries()
    .slice(-5)
    .map((s) => `第${s.chapterNo}章: ${s.oneLiner}`)
    .join("\n");
  const outline = handle.outlineRepo.listAll();
  const outlineBrief = outline.length
    ? outline.map(n => `  [${n.level}] ${n.title}${n.status === "done" ? " ✓" : n.status === "in_progress" ? " …" : ""}`).join("\n")
    : "(大纲为空)";
  const characters = handle.charactersRepo.list();
  const charBrief = characters.length
    ? characters.map(c => `${c.name}(${c.role ?? "未定"})`).join("、")
    : "(无角色)";
  const foreshadowing = handle.foreshadowingRepo.list("active");
  const fsBrief = foreshadowing.length
    ? foreshadowing.map(f => `${f.label}(第${f.plantedChapter ?? "?"}章埋下)`).join("、")
    : "(无活跃伏笔)";

  const contextBlock = [
    `# 当前书状态`,
    `章节数: ${handle.chaptersRepo.maxChapterNo()}`,
    promptCtx.writeCtx.premise ? `设定: ${promptCtx.writeCtx.premise}` : "设定: (未设定)",
    `调性: ${handle.bookMetaRepo.get("tone") ?? "(未设定)"}`,
    `角色: ${charBrief}`,
    `大纲:\n${outlineBrief}`,
    `活跃伏笔: ${fsBrief}`,
    recent ? `最近章节:\n${recent}` : "最近章节: (无)",
  ].join("\n");

  // 合并所有工具：书操作 + 通用记录操作（不含重流程 trigger）
  const tools = {
    ...makeBookTools({ handle }),
    ...makeGenreSectionTools({ repo: handle.genreSectionsRepo, charactersRepo: handle.charactersRepo }),
  };

  const messages: CoreMessage[] = prependDeepestPrompt([
    { role: "system", content: CHAT_SYSTEM },
    { role: "system", content: contextBlock },
    ...(input.history ?? []),
    { role: "user", content: input.message },
  ], deps.deepestPrompt);

  yield* streamLlm({ model: deps.model, messages, tools, maxSteps: 12, abortSignal: deps.abortSignal });
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
  yield* cannedText(text);
}

async function* auditFlow(
  deps: ConversationOrchestratorDeps,
  chapterNo: number,
): AsyncIterable<SseEvent> {
  const { handle } = deps;
  const chapter = handle.chapterFiles.read(chapterNo);
  if (!chapter) {
    yield* cannedText(`第 ${chapterNo} 章还没有正文,无法审查。`);
    return;
  }
  const promptCtx = buildBookPromptContext(handle);
  yield { type: "tool_call_start", toolName: "chapter_audit", args: { chapterNo } };
  try {
    const result = await auditChapter(
      { model: deps.auditModel, abortSignal: deps.abortSignal, deepestPrompt: deps.deepestPrompt },
      { chapterNo, chapterContent: chapter.content, ...promptCtx.auditCtx },
    );
    persistAuditResult(
      handle.chaptersRepo,
      chapterNo,
      result,
      deps.auditModelId,
      handle.readerIssuesRepo,
    );
    yield {
      type: "tool_call_end", toolName: "chapter_audit",
      result: { verdict: result.output.verdict, issuesCount: result.output.issues.filter((i) => i.severity !== "ok").length, summary: result.output.summary },
    };
    const lines = [
      `第 ${chapterNo} 章审查结论:${result.output.verdict}`,
      ...result.output.issues.map((i) => `· [${i.severity}] ${i.dimension}:${i.note}`),
    ].join("\n");
    yield { type: "text_delta", delta: lines };
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
        const target = parseRewriteTargetChapter(parsed.args) ?? (maxNo >= 1 ? maxNo : 1);
        yield* writeChapterFlow(deps, target, parsed.args, "rewrite");
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
        yield* cannedText(`已记下便签:${parsed.args}`);
        return;
      }
      case "revise":
        yield* cannedText("改写选中段请在中栏编辑器里选中文字后操作(选中后会弹出改写工具条)。");
        return;
      case "help":
        yield* cannedText(helpText());
        return;
      case "auto":
        // /auto 由前端直连 /auto 端点;走到这里说明是异常入口,给出提示
        yield* cannedText("自动写作请用 /auto N(例如 /auto 5),它会在顶部进度条里运行。");
        return;
    }
  }

  // 自然语言:确定性快路径兜住重流程（写章/重写/删章/审查），
  // 这些需要流式 SSE 进度，不能在 tool execute 里跑。
  // 其余全部走 agenticChat 让 AI 自己理解需求 + 调轻量工具。

  // 重写指定章（必须在 WRITE_HINT 之前检查，否则"重写第一章"会被 WRITE_HINT 匹配）
  const rewriteTarget = parseRewriteTargetChapter(input.message);
  if (rewriteTarget !== undefined) {
    yield { type: "intent", category: "revise_intent" };
    yield* writeChapterFlow(deps, rewriteTarget, input.message, "rewrite");
    yield { type: "done" };
    return;
  }

  // 写下一章
  if (WRITE_HINT.test(input.message)) {
    yield { type: "intent", category: "writing_intent" };
    yield* writeChapterFlow(deps, deps.handle.chaptersRepo.maxChapterNo() + 1, input.message);
    yield { type: "done" };
    return;
  }

  // 删除章节（回档语义）
  const deleteTarget = parseDeleteTargetChapter(input.message);
  if (deleteTarget !== undefined) {
    yield { type: "intent", category: "delete_intent" };
    const { deleteChaptersFrom } = await import("./delete-chapter.js");
    const result = deleteChaptersFrom(deps.handle, deleteTarget);
    if (result.deletedChapters.length === 0) {
      yield* cannedText(`没有第 ${deleteTarget} 章或更后的章节，无需删除。`);
    } else {
      const range = result.deletedChapters[0] === result.deletedChapters[result.deletedChapters.length - 1]
        ? `第 ${result.deletedChapters[0]} 章`
        : `第 ${result.deletedChapters[0]} 章到第 ${result.deletedChapters[result.deletedChapters.length - 1]} 章`;
      let msg = `已删除${range}及所有关联记录（摘要、版本、审查、时间线、读者问题、伏笔、角色出场）。`;
      if (result.affectedCharacterNames.length > 0) {
        msg += `\n注意：${result.affectedCharacterNames.join("、")} 的状态是累积写入的，无法自动回滚到删章前。请到侧栏手动核对。`;
      }
      yield* cannedText(msg);
    }
    yield { type: "done" };
    return;
  }

  // 审查指定章
  const auditMatch = input.message.match(/(?:审查|审查一下|检查|看看|评价).*(?:第\s*([0-9]+)\s*章)/i);
  if (auditMatch) {
    const no = Number(auditMatch[1]);
    if (no >= 1) {
      yield { type: "intent", category: "query" as IntentCategory };
      yield* auditFlow(deps, no);
      return;
    }
  }

  // 其余所有自然语言 → agentic 对话（AI 自己理解需求，自己调轻量工具）
  yield { type: "intent", category: "agentic" as IntentCategory };
  yield* agenticChat(deps, input);
}
