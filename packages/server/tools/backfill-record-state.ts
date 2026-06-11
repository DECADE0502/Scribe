/**
 * 一次性回填脚本:对已有章节执行 章末状态记录 pass(spec §6.3)。
 * 用法:pnpm exec tsx tools/backfill-record-state.ts <bookId> [章号...]
 * 不传章号则回填全部章节。
 */
import { resolveAppPaths } from "../src/config/paths.js";
import { loadSecrets } from "../src/config/secrets.js";
import { loadConfig } from "../src/config/load.js";
import { createModelManager } from "../src/ai/model-manager.js";
import { createBookRegistry } from "../src/http/book-registry.js";
import {
  recordChapterState,
  buildArchiveSummary,
} from "../src/ai/orchestrator/record-state.js";

const bookId = process.argv[2];
if (!bookId) {
  console.error("用法:tsx tools/backfill-record-state.ts <bookId> [章号...]");
  process.exit(1);
}

const paths = resolveAppPaths({ env: process.env });
const config = loadConfig(paths.configJson);
const secrets = loadSecrets(paths.secretsEnv);
const modelManager = createModelManager({
  apiKey: secrets.DEEPSEEK_API_KEY ?? null,
  writeModelId: config.writeModelId,
  auditModelId: config.auditModelId,
});
const model = modelManager.getAuditModel();
if (!model) {
  console.error("未配置 API Key");
  process.exit(1);
}

const registry = createBookRegistry({ paths });
const handle = registry.open(bookId);

const chapterNos =
  process.argv.length > 3
    ? process.argv.slice(3).map(Number)
    : handle.chaptersRepo.list().map((c) => c.chapterNo);

for (const chapterNo of chapterNos) {
  const chapter = handle.chapterFiles.read(chapterNo);
  if (!chapter) {
    console.error(`第 ${chapterNo} 章正文不存在,跳过`);
    continue;
  }
  console.log(`\n===== 第 ${chapterNo} 章状态记录开始(${chapter.content.length} 字)=====`);
  const archiveSummary = buildArchiveSummary({
    genreSections: handle.genreSectionsRepo.listSections().map((section) => ({
      section,
      items: handle.genreSectionsRepo.listItems(section.id),
    })),
    characters: handle.charactersRepo.list(),
    activeForeshadowing: handle.foreshadowingRepo.list("active"),
  });
  let text = "";
  for await (const ev of recordChapterState(
    {
      model,
      stateDeps: {
        charactersRepo: handle.charactersRepo,
        foreshadowingRepo: handle.foreshadowingRepo,
        timelineRepo: handle.timelineRepo,
        chapterNo,
      },
      genreDeps: {
        repo: handle.genreSectionsRepo,
        charactersRepo: handle.charactersRepo,
      },
    },
    { chapterNo, chapterContent: chapter.content, archiveSummary },
  )) {
    if (ev.type === "tool_call_start") console.log(`  → ${ev.toolName}`, JSON.stringify(ev.args).slice(0, 160));
    if (ev.type === "tool_call_end") console.log(`  ✓ ${ev.toolName}`, JSON.stringify(ev.result).slice(0, 120));
    if (ev.type === "text_delta") text += ev.delta;
    if (ev.type === "error") console.error(`  ✗ 错误:${ev.message}`);
  }
  if (text.trim()) console.log(`  总结:${text.trim()}`);
}

registry.closeAll();
console.log("\n回填完成");
