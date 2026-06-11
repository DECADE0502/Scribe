/**
 * 用 MiMo 端到端跑一本新书:配置 provider → 新建书 → 对话式 onboard(测工具调用)
 * → /auto 写 N 章。验证换供应商后全链路质量。
 * 用法:pnpm exec tsx tools/run-mimo-book.ts <N>
 */
import { resolveAppPaths } from "../src/config/paths.js";
import { loadConfig, saveConfig } from "../src/config/load.js";
import { saveSecret } from "../src/config/secrets.js";
import { createModelManager } from "../src/ai/model-manager.js";
import { createBookRegistry } from "../src/http/book-registry.js";
import { runAutoMode } from "../src/ai/orchestrator/auto-mode.js";
import { runNewBookConversation } from "../src/ai/orchestrator/new-book.js";
import { loadBookSnapshot } from "../src/ai/context-builder/snapshot.js";
import { isOnboardComplete, formatCompletenessHint } from "../src/ai/orchestrator/onboard-completeness.js";
import {
  buildBookPromptContext, buildChapterWriteMessages,
} from "../src/ai/context-builder/book-context.js";
import { recordChapterState, buildArchiveSummary } from "../src/ai/orchestrator/record-state.js";
import type { SseEvent } from "@scribe/shared";
import type { CoreMessage } from "ai";

const MIMO_KEY = "tp-cofcn0eod0a5zwy05edxqa7lqrpw4foo7a1znp6ifzsnejpo";
const N = Number(process.argv[2] ?? 12);
const log = (s: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);

const paths = resolveAppPaths({ env: process.env });
// 配置切到 MiMo(持久化,服务器重启后也用 MiMo)
saveSecret(paths.secretsEnv, "MIMO_API_KEY", MIMO_KEY);
const cfg = loadConfig(paths.configJson);
saveConfig(paths.configJson, { ...cfg, provider: "mimo", writeModelId: "mimo-v2.5-pro", auditModelId: "mimo-v2.5-pro" });

const mm = createModelManager({ provider: "mimo", apiKey: MIMO_KEY, writeModelId: "mimo-v2.5-pro", auditModelId: "mimo-v2.5-pro" });
const model = mm.getModel()!;
const auditModel = mm.getAuditModel()!;
const writeModelInfo = mm.getWriteModelInfo();
const auditModelInfo = mm.getAuditModelInfo();

const registry = createBookRegistry({ paths });
const controller = new AbortController();

const SEED = `我想写一部都市异能小说。主角叫陈默,28岁,普通城市白领,意外觉醒了"回溯"异能——能让自己周围的时间倒流10秒,但每次都会短暂头痛。
背景设定在现代都市江城,暗中有一个管理异能者的秘密组织"观测局",与之对立的"裂隙会"在制造异能犯罪牟利。
基调:悬疑、快节奏、带爽感。篇幅约30万字。
大纲方向:第一卷"觉醒与隐藏",陈默藏住能力卷入一桩命案;第二卷"加入观测局",调查连环异能案;第三卷"裂隙真相",揭开裂隙会阴谋与自己的身世。
请把设定建好:题材板块按都市异能设计(比如 异能能力、组织势力、关键道具、金钱/资源等),建好主角陈默的角色卡,并搭出一级大纲(三卷)。`;

function snapshot() {
  const h = registry.open(bookId);
  return loadBookSnapshot(bookId, {
    charactersRepo: h.charactersRepo, outlineRepo: h.outlineRepo, foreshadowingRepo: h.foreshadowingRepo,
    chaptersRepo: h.chaptersRepo, genreSectionsRepo: h.genreSectionsRepo, bookMetaRepo: h.bookMetaRepo,
  }, { rulesMd: h.rulesMdPath });
}

let bookId = "";

function makeRecordState(chapterNo: number): AsyncIterable<SseEvent> {
  const h = registry.open(bookId);
  const chapter = h.chapterFiles.read(chapterNo);
  if (!chapter) return (async function* () {})();
  const archiveSummary = buildArchiveSummary({
    genreSections: h.genreSectionsRepo.listSections().map((s) => ({ section: s, items: h.genreSectionsRepo.listItems(s.id) })),
    characters: h.charactersRepo.list(),
    activeForeshadowing: h.foreshadowingRepo.list("active"),
  });
  return recordChapterState(
    { model: auditModel, stateDeps: { charactersRepo: h.charactersRepo, foreshadowingRepo: h.foreshadowingRepo, timelineRepo: h.timelineRepo, chapterNo }, genreDeps: { repo: h.genreSectionsRepo, charactersRepo: h.charactersRepo }, abortSignal: controller.signal },
    { chapterNo, chapterContent: chapter.content, archiveSummary },
  );
}

async function onboard() {
  const h = registry.open(bookId);
  const history: CoreMessage[] = [];
  const turns = ["__seed__", "请把缺失的设定补全(尤其一级大纲三卷、主角卡),建好后说一句开始写。", "继续补全所有缺失项。"];
  for (let i = 0; i < turns.length; i++) {
    const message = i === 0 ? SEED : turns[i]!;
    const comp = isOnboardComplete(snapshot());
    if (comp.ok) { log(`onboard 完成(第 ${i} 轮前已齐):${JSON.stringify(comp)}`); return; }
    log(`onboard 第 ${i + 1} 轮(还差:${comp.missing.join("、") || "—"})`);
    let assistantText = "";
    const toolNames: string[] = [];
    for await (const ev of runNewBookConversation(
      { model, toolDeps: { bookMetaToolsDeps: { bookMetaRepo: h.bookMetaRepo, charactersRepo: h.charactersRepo, outlineRepo: h.outlineRepo, rulesMdPath: h.rulesMdPath }, genreToolsDeps: { repo: h.genreSectionsRepo, charactersRepo: h.charactersRepo } }, abortSignal: controller.signal, maxSteps: 20 },
      { history, message, completenessHint: formatCompletenessHint(comp) },
    )) {
      if (ev.type === "text_delta") assistantText += ev.delta;
      if (ev.type === "tool_call_start") toolNames.push(ev.toolName);
    }
    log(`  调用工具 ${toolNames.length} 次:${[...new Set(toolNames)].join(", ")}`);
    history.push({ role: "user", content: message }, { role: "assistant", content: assistantText || "(已操作)" });
  }
  log(`onboard 结束,完成度:${JSON.stringify(isOnboardComplete(snapshot()))}`);
}

async function autoWrite() {
  const h = registry.open(bookId);
  const promptCtx = buildBookPromptContext(h);
  let cur = 0;
  for await (const ev of runAutoMode(
    {
      model, auditModel, auditModelId: auditModelInfo.id,
      chaptersRepo: h.chaptersRepo, chapterFiles: h.chapterFiles,
      maxChapterNo: () => h.chaptersRepo.maxChapterNo(),
      getVerdict: (no) => h.chaptersRepo.getAudit(no)?.verdict,
      budgetLimitUsd: 999, writeModelInfo, auditModelInfo, abortSignal: controller.signal,
      recordState: makeRecordState,
      buildWriteMessages: (chapterNo) => buildChapterWriteMessages(h, chapterNo, "").messages,
    },
    { n: N, writeCtx: promptCtx.writeCtx, auditCtx: promptCtx.auditCtx },
  )) {
    if (ev.type === "auto_status" && ev.currentChapter && ev.currentChapter !== cur) { cur = ev.currentChapter; log(`▶ 写第 ${cur} 章(剩 ${ev.remaining})`); }
    if (ev.type === "auto_status" && ev.state !== "writing" && ev.state !== "planning") log(`状态:${ev.state} 完成 ${ev.doneChapters.length} 章`);
    if (ev.type === "tool_call_end" && ev.toolName === "chapter_audit") log(`  ✓ 审查 verdict=${(ev.result as any)?.verdict}`);
    if (ev.type === "tool_call_end" && ev.toolName === "record_chapter_state") log(`  ✓ 状态记录(${(ev.result as any)?.success ? "成功" : "降级"})`);
    if (ev.type === "error") log(`✗ 错误[${ev.errorClass}]:${ev.message}`);
  }
}

async function main() {
  const book = registry.booksRepo.create({ title: "回溯者", genre: "都市异能" });
  bookId = book.id;
  log(`新建书 id=${bookId} 标题=回溯者 provider=mimo 模型=${writeModelInfo.id}`);
  await onboard();
  log(`=== 开始自动写作 ${N} 章 ===`);
  await autoWrite();
  log(`完成。bookId=${bookId} 最大章号=${registry.open(bookId).chaptersRepo.maxChapterNo()}`);
  registry.closeAll();
}
main().catch((e) => { console.error("失败:", e); process.exit(1); });
