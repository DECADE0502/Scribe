import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createChapterFiles } from "../../../src/fs/chapter-files.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scribe-test-"));
});

describe("chapter files", () => {
  it("save 写入 0001.md 含 frontmatter,read 解析回正文 + 元", () => {
    const cf = createChapterFiles(tmp);
    cf.save({ chapterNo: 1, title: "初见", content: "# 初见\n\n云雾间...", versionNo: 1 });
    expect(fs.existsSync(path.join(tmp, "0001.md"))).toBe(true);
    const r = cf.read(1);
    expect(r?.title).toBe("初见");
    expect(r?.versionNo).toBe(1);
    expect(r?.content).toContain("云雾间");
    expect(r?.wordCount).toBeGreaterThan(0);
  });
  it("read 不存在的章节返回 undefined", () => {
    expect(createChapterFiles(tmp).read(99)).toBeUndefined();
  });
  it("list 返回所有 .md 章节号升序", () => {
    const cf = createChapterFiles(tmp);
    cf.save({ chapterNo: 2, title: "B", content: "二", versionNo: 1 });
    cf.save({ chapterNo: 1, title: "A", content: "一", versionNo: 1 });
    expect(cf.list().map(c => c.chapterNo)).toEqual([1, 2]);
  });
  it("delete 删除文件", () => {
    const cf = createChapterFiles(tmp);
    cf.save({ chapterNo: 1, title: "T", content: "正文", versionNo: 1 });
    cf.delete(1);
    expect(cf.read(1)).toBeUndefined();
  });
});
