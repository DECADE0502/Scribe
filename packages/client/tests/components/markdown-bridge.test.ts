import { describe, it, expect } from "vitest";
import { mdToHtml, htmlToMd } from "../../src/components/editor/markdown-bridge.js";

const normalize = (s: string) => s.replace(/\s+/g, " ").trim();

describe("markdown-bridge", () => {
  it("md → html:标题与段落", () => {
    const html = mdToHtml("# 第一章\n\n雾气浸透山道。");
    expect(html).toContain("<h1>第一章</h1>");
    expect(html).toContain("<p>雾气浸透山道。</p>");
  });

  it("html → md:粗体与斜体", () => {
    const md = htmlToMd("<p><strong>重</strong>与<em>轻</em></p>");
    expect(md).toContain("**重**");
    expect(md).toContain("_轻_");
  });

  it("往返一致:标题/段落/粗体/列表", () => {
    const src = "# 标题\n\n正文**加粗**与普通。\n\n- 甲\n- 乙";
    const roundTripped = htmlToMd(mdToHtml(src));
    expect(normalize(roundTripped)).toContain("# 标题");
    expect(normalize(roundTripped)).toContain("**加粗**");
    expect(normalize(roundTripped)).toContain("- 甲");
    expect(normalize(roundTripped)).toContain("- 乙");
  });

  it("空字符串安全", () => {
    expect(htmlToMd(mdToHtml(""))).toBe("");
  });
});
