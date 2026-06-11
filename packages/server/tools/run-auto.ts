/**
 * 端到端跑通验证:用与 HTTP /auto 路由完全相同的编排(runAutoMode)自动写 N 章。
 * 不经 HTTP,避免请求超时;直连模型+DB+文件,验证 写→审→记录状态→落盘→成本 全链路。
 * 用法:pnpm exec tsx tools/run-auto.ts <bookId> <N>
 */
import { resolveAppPaths } from "../src/config/paths.js";
import { loadConfig } from "../src/config/load.js";
import { loadSecrets } from "../src/config/secrets.js";
import { createModelManager } from "../src/ai/model-manager.js";
import { createBookRegistry } from "../src/http/book-registry.js";
import { runAutoMode } from "../src/ai/orchestrator/auto-mode.js";
import {
  buildBookPromptContext,
  buildChapterWriteMessages,
} from "../src/ai/context-builder/book-context.js";
import { recordChapterState, buildArchiveSummary } from "../src/ai/orchestrator/record-state.js";
import { computeUsageCost } from "../src/ai/usage-tracker.js";
import type { SseEvent } from "@scribe/shared";

const bookId = process.argv[2]!;
const N = Number(process.argv[3] ?? 14);
if (!bookId) { console.error("用法:tsx tools/run-auto.ts <bookId> <N>"); process.exit(1); }

const paths = resolveAppPaths({ env: process.env });
const config = loadConfig(paths.configJson);
const secrets = loadSecrets(paths.secretsEnv);
const mm = createModelManager({
  apiKey: secrets.DEEPSEEK_API_KEY ?? null,
  writeModelId: config.writeModelId,
  auditModelId: config.auditModelId,
});
const model = mm.getModel();
const auditModel = mm.getAuditModel();
if (!model || !auditModel) { console.error("未配置 API Key"); process.exit(1); }
const writeModelInfo = mm.getWriteModelInfo();
const auditModelInfo = mm.getAuditModelInfo();

const registry = createBookRegistry({ paths });
const handle = registry.open(bookId);
const promptCtx = buildBookPromptContext(handle);
const controller = new AbortController();

let totalCost = 0;
const log = (s: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);

function makeRecordState(chapterNo: number): AsyncIterable<SseEvent> {
  const chapter = handle.chapterFiles.read(chapterNo);
  if (!chapter) return (async function* () {})();
  const archiveSummary = buildArchiveSummary({
    genreSections: handle.genreSectionsRepo.listSections().map((section) => ({
      section, items: handle.genreSectionsRepo.listItems(section.id),
    })),
    characters: handle.charactersRepo.list(),
    activeForeshadowing: handle.foreshadowingRepo.list("active"),
  });
  const inner = recordChapterState(
    {
      model: auditModel!,
      stateDeps: {
        charactersRepo: handle.charactersRepo,
        foreshadowingRepo: handle.foreshadowingRepo,
        timelineRepo: handle.timelineRepo,
        chapterNo,
      },
      genreDeps: { repo: handle.genreSectionsRepo, charactersRepo: handle.charactersRepo },
      abortSignal: controller.signal,
    },
    { chapterNo, chapterContent: chapter.content, archiveSummary },
  );
  return (async function* () {
    for await (const ev of inner) {
      if (ev.type === "usage") {
        totalCost += computeUsageCost(auditModelInfo, ev.promptTokens, ev.completionTokens, ev.cachedTokens ?? 0);
      }
      yield ev;
    }
  })();
}

async function main() {
  log(`开始自动写作:book=${bookId} N=${N} 写=${writeModelInfo.id} 审=${auditModelInfo.id}`);
  log(`起始最大章号=${handle.chaptersRepo.maxChapterNo()}`);
  let curChapter = 0;
  let recordCalls = 0;

  for await (const ev of runAutoMode(
    {
      model: model!, auditModel: auditModel!, auditModelId: auditModelInfo.id,
      chaptersRepo: handle.chaptersRepo, chapterFiles: handle.chapterFiles,
      maxChapterNo: () => handle.chaptersRepo.maxChapterNo(),
      getVerdict: (no) => handle.chaptersRepo.getAudit(no)?.verdict,
      budgetLimitUsd: 50, // 验证用,放宽
      writeModelInfo, auditModelInfo, abortSignal: controller.signal,
      recordState: makeRecordState,
      buildWriteMessages: (chapterNo) => buildChapterWriteMessages(handle, chapterNo, "").messages,
    },
    { n: N, writeCtx: promptCtx.writeCtx, auditCtx: promptCtx.auditCtx },
  )) {
    switch (ev.type) {
      case "auto_status":
        if (ev.currentChapter && ev.currentChapter !== curChapter) {
          curChapter = ev.currentChapter;
          log(`▶ 开始写第 ${curChapter} 章(剩 ${ev.remaining})`);
        }
        if (ev.state !== "writing" && ev.state !== "planning") log(`状态:${ev.state} 已完成 ${ev.doneChapters.length} 章`);
        break;
      case "tool_call_end":
        if (ev.toolName === "chapter_audit") {
          const r = ev.result as any;
          log(`  ✓ 审查:verdict=${r?.verdict} 问题数=${r?.issuesCount}`);
        } else if (ev.toolName === "record_chapter_state") {
          recordCalls++;
          log(`  ✓ 章末状态记录完成(${(ev.result as any)?.success ? "成功" : "降级"})`);
        } else if (ev.toolName?.startsWith("add_") || ev.toolName?.startsWith("update_") || ev.toolName?.startsWith("pay_")) {
          // 记录工具的具体落地(简洁)
        }
        break;
      case "usage":
        totalCost += computeUsageCost(writeModelInfo, ev.promptTokens, ev.completionTokens, ev.cachedTokens ?? 0);
        break;
      case "error":
        log(`✗ 错误[${ev.errorClass}]:${ev.message}`);
        break;
    }
  }

  log(`完成。当前最大章号=${handle.chaptersRepo.maxChapterNo()} 记录状态次数=${recordCalls} 估算成本≈$${totalCost.toFixed(4)}`);
  registry.closeAll();
}

main().catch((e) => { console.error("运行失败:", e); process.exit(1); });
