/** 链路质量评测:dump 每个节点对某本书的真实产出,供人工判断质量。 */
import { resolveAppPaths } from "../src/config/paths.js";
import { createBookRegistry } from "../src/http/book-registry.js";

const B = process.argv[2]!;
const r = createBookRegistry({ paths: resolveAppPaths({ env: process.env }) });
const h = r.open(B);

console.log("############ 审查节点质量(逐章 verdict + 7维评分 + issue 内容)############");
const max = h.chaptersRepo.maxChapterNo();
for (let n = 1; n <= max; n++) {
  const a = h.chaptersRepo.getAudit(n);
  if (!a) { console.log(`第${n}章: 无审查记录`); continue; }
  console.log(`\n=== 第${n}章  verdict=${a.verdict} ===`);
  for (const iss of a.issues as any[]) {
    console.log(`  [${iss.severity}|score=${iss.score}] ${iss.dimension}: ${iss.note}`);
  }
}

console.log("\n\n############ 摘要节点质量(逐章一句话/段落/关键事件)############");
for (const s of h.chaptersRepo.listSummaries()) {
  console.log(`\n=== 第${s.chapterNo}章 ===`);
  console.log("一句话:", s.oneLiner);
  console.log("段落:", (s.paragraph || "").slice(0, 200));
  console.log("关键事件:", JSON.stringify((s.keyEvents || []).map((e: any) => ({ ev: e.event?.slice(0,40), 角色: e.characters, 伏笔: e.foreshadowingRefs }))));
}
r.closeAll();
