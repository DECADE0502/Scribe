import * as fs from "node:fs";
import * as path from "node:path";
import { resolveAppPaths } from "../src/config/paths.js";
import { loadConfig } from "../src/config/load.js";
import { loadSecrets } from "../src/config/secrets.js";
import { createModelManager } from "../src/ai/model-manager.js";
import { createBookRegistry } from "../src/http/book-registry.js";
import { createApp } from "../src/http/server.js";
import { runAutoMode } from "../src/ai/orchestrator/auto-mode.js";
import {
  buildBookPromptContext,
  buildChapterAuditContext,
  buildChapterWriteMessages,
} from "../src/ai/context-builder/book-context.js";
import { buildArchiveSummary, recordChapterState } from "../src/ai/orchestrator/record-state.js";
import type { SseEvent } from "@scribe/shared";

const chapterCount = Math.max(1, Number(process.argv[2] ?? 10));
const paths = resolveAppPaths({ env: process.env });
fs.mkdirSync(paths.booksDir, { recursive: true });
const config = loadConfig(paths.configJson);
const secrets = loadSecrets(paths.secretsEnv);
const apiKey =
  config.provider === "mimo"
    ? secrets.MIMO_API_KEY ?? secrets.DEEPSEEK_API_KEY ?? null
    : secrets.DEEPSEEK_API_KEY ?? secrets.MIMO_API_KEY ?? null;
const models = createModelManager({
  provider: config.provider,
  apiKey,
  writeModelId: config.writeModelId,
  auditModelId: config.auditModelId,
  masterPrompt: config.masterPrompt,
});
const model = models.getModel();
const auditModel = models.getAuditModel();
if (!model || !auditModel) {
  throw new Error(`No usable model configured. provider=${config.provider}`);
}

const registry = createBookRegistry({ paths });
const app = createApp({ bookRegistry: registry, appPaths: paths });
const controller = new AbortController();
const log = (message: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${message}`);

const create = await app.request("/api/books", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ title: "宠物捕捉 Demo 长测", genre: "宠物捕捉系统" }),
});
if (create.status !== 201) throw new Error(`create book failed: ${create.status} ${await create.text()}`);
const book = await create.json() as { id: string };
const handle = registry.open(book.id);

handle.bookMetaRepo.set(
  "premise",
  "现代都市宠物捕捉系统长篇。主角林澈在便利店首次看到野生标记，逐步卷入觉醒者、魔界裂隙、天界监察与观测者实验的冲突。重点验证捕捉规则、契约关系、资源状态、任务和记忆连续。",
);
handle.bookMetaRepo.set("tone", "都市奇幻、悬疑推进、轻快但不儿戏、剧情优先、角色有独立动机");
handle.bookMetaRepo.set("genre", "宠物捕捉系统");

handle.charactersRepo.create({
  name: "林澈",
  role: "protagonist",
  baseData: {
    background: "24岁便利店夜班店员，父母早逝，靠兼职和遗产维持生活。",
    motivation: "先活下去并弄清系统真相，随后保护被卷入异常的人。",
    languageHabits: "冷静吐槽，不轻易热血，但关键时刻会做决定。",
  },
  currentState: {
    day: 1,
    time: "上午",
    location: "江城老城区便利店",
    inventory: { normalCaptureBalls: 3, coins: 0, sp: 10 },
    contracts: [],
    activeTask: "确认宠物捕捉系统是否真实",
  },
});

const volume1 = handle.outlineRepo.create({
  parentId: null,
  level: "volume",
  title: "第一卷：系统降临",
  summary: "林澈确认系统真实，完成第一次扫描和捕捉，发现觉醒者社会尚未成形。",
  status: "in_progress",
  sortOrder: 1,
  metadata: {},
});
handle.outlineRepo.create({
  parentId: volume1.id,
  level: "arc",
  title: "便利店的野生标记",
  summary: "第1-3章：便利店和街区异常，首次扫描、捕捉选择、契约后果。",
  status: "planned",
  sortOrder: 2,
  metadata: {},
});
handle.outlineRepo.create({
  parentId: volume1.id,
  level: "arc",
  title: "匿名论坛与裂隙低温",
  summary: "第4-7章：论坛情报真假混杂，城市角落出现魔界裂隙前兆。",
  status: "planned",
  sortOrder: 3,
  metadata: {},
});
handle.outlineRepo.create({
  parentId: volume1.id,
  level: "arc",
  title: "观测者校准",
  summary: "第8-10章：面板黑屏、数字倒流、天界监察痕迹浮现，但不揭底。",
  status: "planned",
  sortOrder: 4,
  metadata: {},
});

function recordState(chapterNo: number): AsyncIterable<SseEvent> {
  const chapter = handle.chapterFiles.read(chapterNo);
  if (!chapter) return (async function* () {})();
  const archiveSummary = buildArchiveSummary({
    genreSections: handle.genreSectionsRepo.listSections().map((section) => ({
      section,
      items: handle.genreSectionsRepo.listItems(section.id),
    })),
    characters: handle.charactersRepo.list(),
    activeForeshadowing: handle.foreshadowingRepo.list("active"),
  });
  return recordChapterState(
    {
      model: auditModel,
      stateDeps: {
        charactersRepo: handle.charactersRepo,
        foreshadowingRepo: handle.foreshadowingRepo,
        timelineRepo: handle.timelineRepo,
        chapterNo,
      },
      genreDeps: { repo: handle.genreSectionsRepo, charactersRepo: handle.charactersRepo },
      abortSignal: controller.signal,
      deepestPrompt: models.getMasterPrompt(),
    },
    { chapterNo, chapterContent: chapter.content, archiveSummary },
  );
}

const promptCtx = buildBookPromptContext(handle);
const reports: Array<{
  chapterNo: number;
  verdict?: string;
  wordCount: number;
  stateRecorded: boolean;
}> = [];

log(`book=${book.id} provider=${config.provider} model=${models.getWriteModelInfo().id} chapters=${chapterCount}`);
for await (const ev of runAutoMode(
  {
    model,
    auditModel,
    auditModelId: models.getAuditModelInfo().id,
    chaptersRepo: handle.chaptersRepo,
    chapterFiles: handle.chapterFiles,
    maxChapterNo: () => handle.chaptersRepo.maxChapterNo(),
    getVerdict: (chapterNo) => handle.chaptersRepo.getAudit(chapterNo)?.verdict,
    budgetLimitUsd: 999,
    writeModelInfo: models.getWriteModelInfo(),
    auditModelInfo: models.getAuditModelInfo(),
    abortSignal: controller.signal,
    deepestPrompt: models.getMasterPrompt(),
    recordState,
    buildWriteMessages: (chapterNo) =>
      buildChapterWriteMessages(handle, chapterNo, `第 ${chapterNo} 章，推进主线并保持捕捉规则、契约、库存、时间连续。`).messages,
    buildAuditCtx: (chapterNo) =>
      buildChapterAuditContext(handle, chapterNo, `第 ${chapterNo} 章质量审查。`).auditCtx,
  },
  { n: chapterCount, writeCtx: promptCtx.writeCtx, auditCtx: promptCtx.auditCtx },
)) {
  if (ev.type === "auto_status" && ev.currentChapter) {
    log(`status=${ev.state} chapter=${ev.currentChapter} remaining=${ev.remaining}`);
  }
  if (ev.type === "tool_call_end" && ev.toolName === "chapter_audit") {
    const result = ev.result as { verdict?: string; issuesCount?: number };
    const chapterNo = handle.chaptersRepo.maxChapterNo();
    log(`audit chapter=${chapterNo} verdict=${result.verdict} issues=${result.issuesCount}`);
  }
  if (ev.type === "tool_call_end" && ev.toolName === "record_chapter_state") {
    const chapterNo = handle.chaptersRepo.maxChapterNo();
    const chapter = handle.chapterFiles.read(chapterNo);
    reports.push({
      chapterNo,
      verdict: handle.chaptersRepo.getAudit(chapterNo)?.verdict,
      wordCount: chapter?.content.length ?? 0,
      stateRecorded: Boolean((ev.result as { success?: boolean })?.success),
    });
    log(`state chapter=${chapterNo} success=${(ev.result as { success?: boolean })?.success}`);
  }
  if (ev.type === "error") {
    log(`error ${ev.errorClass}: ${ev.message}`);
  }
}

const outDir = path.join(process.cwd(), "tmp");
fs.mkdirSync(outDir, { recursive: true });
const reportPath = path.join(outDir, `pet-capture-demo-live-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
const chapters = Array.from({ length: handle.chaptersRepo.maxChapterNo() }, (_, index) => {
  const chapterNo = index + 1;
  const chapter = handle.chapterFiles.read(chapterNo);
  const audit = handle.chaptersRepo.getAudit(chapterNo);
  const summary = handle.chaptersRepo.getSummary(chapterNo);
  return {
    chapterNo,
    audit,
    summary,
    content: chapter?.content ?? "",
  };
});
const output = {
  bookId: book.id,
  chapterCount,
  maxChapterNo: handle.chaptersRepo.maxChapterNo(),
  reports,
  characters: handle.charactersRepo.list(),
  genreSections: handle.genreSectionsRepo.listSections().map((section) => ({
    section,
    items: handle.genreSectionsRepo.listItems(section.id),
  })),
  foreshadowing: handle.foreshadowingRepo.list("active"),
  chapters,
};
fs.writeFileSync(reportPath, JSON.stringify(output, null, 2), "utf-8");
log(`report=${reportPath}`);
registry.closeAll();
