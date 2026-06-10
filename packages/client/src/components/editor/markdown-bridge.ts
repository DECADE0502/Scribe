import { marked } from "marked";
import TurndownService from "turndown";

const td = new TurndownService({ headingStyle: "atx", bulletListMarker: "-" });

export function mdToHtml(md: string): string {
  return marked.parse(md, { async: false }) as string;
}

export function htmlToMd(html: string): string {
  return td.turndown(html);
}
