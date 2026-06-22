import * as fs from "node:fs";
import * as path from "node:path";
import matter from "gray-matter";
import { writeFileAtomic } from "./atomic-write.js";

export interface ChapterRecord {
  chapterNo: number;
  title: string;
  content: string;
  versionNo: number;
  wordCount: number;
  updatedAt: number;
}

export interface SaveInput {
  chapterNo: number;
  title: string;
  content: string;
  versionNo: number;
}

const pad = (n: number) => String(n).padStart(4, "0");

export function createChapterFiles(chaptersDir: string) {
  fs.mkdirSync(chaptersDir, { recursive: true });
  const filePath = (n: number) => path.posix.join(chaptersDir, `${pad(n)}.md`);
  const countWords = (s: string) =>
    (s.match(/[一-龥]/g)?.length ?? 0) +
    (s.match(/[A-Za-z]+/g)?.length ?? 0);

  const api = {
    save(input: SaveInput) {
      const fm = {
        title: input.title,
        version: input.versionNo,
        wordCount: countWords(input.content),
        updatedAt: Date.now(),
      };
      const md = matter.stringify(input.content, fm);
      writeFileAtomic(filePath(input.chapterNo), md);
    },
    read(no: number): ChapterRecord | undefined {
      const fp = filePath(no);
      if (!fs.existsSync(fp)) return undefined;
      const { data, content } = matter(fs.readFileSync(fp, "utf-8"));
      return {
        chapterNo: no,
        title: String(data.title ?? ""),
        content: content.replace(/^\n+/, ""),
        versionNo: Number(data.version ?? 1),
        wordCount: Number(data.wordCount ?? countWords(content)),
        updatedAt: Number(data.updatedAt ?? 0),
      };
    },
    list(): ChapterRecord[] {
      if (!fs.existsSync(chaptersDir)) return [];
      const files = fs
        .readdirSync(chaptersDir)
        .filter((f) => /^\d{4}\.md$/.test(f))
        .sort();
      return files
        .map((f) => api.read(Number(f.slice(0, 4)))!)
        .filter(Boolean);
    },
    delete(no: number) {
      const fp = filePath(no);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    },
  };

  return api;
}
