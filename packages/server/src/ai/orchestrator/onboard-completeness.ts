import type { BookSnapshot } from "../context-builder/snapshot.js";

export interface CompletenessResult {
  ok: boolean;
  missing: string[];
}

export function isOnboardComplete(snapshot: BookSnapshot): CompletenessResult {
  const missing: string[] = [];

  // 1. 题材
  if (!snapshot.meta.genre) missing.push("题材");

  // 2. 至少一个主角
  if (!snapshot.characters.some((c) => c.role === "protagonist")) {
    missing.push("主角");
  }

  // 3. 至少一个一级大纲(volume 或 arc)
  if (
    !snapshot.outline.some((n) => n.level === "volume" || n.level === "arc")
  ) {
    missing.push("一级大纲");
  }

  // 4. 调性 / 篇幅 / premise 至少给到两项
  // 注:lengthTarget 不在 BookMeta 类型里(snapshot.meta 只有 title/premise/tone/genre),
  // 这里只能从 tone / premise 中数 extras。需要 lengthTarget 时由调用方决定是否扩展 BookSnapshot。
  let extras = 0;
  if (snapshot.meta.tone) extras += 1;
  if (snapshot.meta.premise) extras += 1;
  if (extras < 2) missing.push("调性/篇幅/premise(至少两项)");

  return { ok: missing.length === 0, missing };
}

/**
 * 用于嵌入 prompt 的中文提示文本。
 * 当 missing 为空时返回收尾提示。
 */
export function formatCompletenessHint(result: CompletenessResult): string {
  if (result.ok) {
    return "已完整,可以收尾(请输出'基础设定好了,要不要现在开始写第一章?')";
  }
  return `还差以下信息:${result.missing.join("、")}`;
}
