import * as fs from "node:fs";
import * as path from "node:path";

export interface ChapterFilesLike {
  list(): Array<{ chapterNo: number; title: string; content: string }>;
}

export type ExportRange = "all" | { chapter: number };

export interface ExportOptions {
  format: "txt" | "md";
  range: ExportRange;
}

/** 简易去 markdown:剥标题井号、粗体斜体星号、行内代码,保留正文 */
export function stripMd(md: string): string {
  return md
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^[-*]\s+/gm, "");
}

function rangeLabel(range: ExportRange): string {
  return range === "all" ? "全书" : `第${range.chapter}章`;
}

export function exportChapters(
  deps: { chapterFiles: ChapterFilesLike; exportsDir: string },
  bookTitle: string,
  opts: ExportOptions,
): { path: string; filename: string; bytes: number } {
  const list = deps.chapterFiles.list();
  const filtered = opts.range === "all"
    ? list
    : list.filter(ch => ch.chapterNo === (opts.range as { chapter: number }).chapter);
  if (filtered.length === 0) throw new Error("没有可导出的章节");

  const buffer: string[] = [];
  if (opts.format === "md") buffer.push(`# ${bookTitle}\n`);
  else buffer.push(`${bookTitle}\n`);
  for (const ch of filtered) {
    if (opts.format === "md") {
      buffer.push(`\n## 第 ${ch.chapterNo} 章 ${ch.title}\n\n${ch.content}\n`);
    } else {
      buffer.push(`\n第 ${ch.chapterNo} 章 ${ch.title}\n\n${stripMd(ch.content)}\n`);
    }
  }
  const filename = `${bookTitle}-${rangeLabel(opts.range)}.${opts.format}`;
  const fullPath = path.posix.join(deps.exportsDir, filename);
  fs.mkdirSync(deps.exportsDir, { recursive: true });
  const text = buffer.join("");
  fs.writeFileSync(fullPath, text, "utf-8");
  return { path: fullPath, filename, bytes: Buffer.byteLength(text, "utf-8") };
}
