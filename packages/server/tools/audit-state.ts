/** 自查脚本:打印一本书已记录的全部结构化状态。 */
import { resolveAppPaths } from "../src/config/paths.js";
import { createBookRegistry } from "../src/http/book-registry.js";

const bookId = process.argv[2]!;
const paths = resolveAppPaths({ env: process.env });
const registry = createBookRegistry({ paths });
const h = registry.open(bookId);

const book = registry.booksRepo.get(bookId);
console.log(`书名:${book?.title}  最大章号:${h.chaptersRepo.maxChapterNo()}`);

console.log("\n=== 题材板块 ===");
for (const s of h.genreSectionsRepo.listSections()) {
  const items = h.genreSectionsRepo.listItems(s.id);
  console.log(`\n【${s.name}】${items.length} 条`);
  for (const it of items) {
    console.log("  -", JSON.stringify(it.data));
  }
}

console.log("\n=== 角色 ===");
for (const c of h.charactersRepo.list()) {
  console.log(`\n${c.name}(${c.role})`);
  console.log("  currentState:", JSON.stringify(c.currentState));
  for (const a of c.appearances ?? []) {
    console.log(`  出场[第${a.chapterNo}章]:`, (a as any).brief ?? JSON.stringify(a));
  }
}

console.log("\n=== 伏笔 ===");
for (const f of h.foreshadowingRepo.list()) {
  console.log(`  [${f.status}] ${f.label}`);
}

console.log("\n=== 时间线 ===");
for (const t of h.timelineRepo.listAll()) {
  console.log(`  (${t.storyTime ?? "?"}) ${t.event}`);
}

registry.closeAll();
