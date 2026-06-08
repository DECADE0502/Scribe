export function estimateTokens(text: string): number {
  if (!text) return 0;
  const chineseChars = text.match(/[一-龥]/g)?.length ?? 0;
  const englishWords = text.match(/[A-Za-z0-9]+/g) ?? [];
  const englishCharCount = englishWords.reduce((acc, w) => acc + w.length, 0);
  const englishTokens = Math.ceil(englishCharCount / 4);
  // 其它字符 (符号/空白) 按 1/3 折算, 这是经验估算
  const otherChars = Math.max(
    0,
    text.length - chineseChars - englishCharCount
  );
  const otherTokens = Math.ceil(otherChars * 0.3);
  return Math.ceil(chineseChars * 1.5 + englishTokens + otherTokens);
}

export interface Section {
  id: string;
  priority: number;
  text: string;
}

export interface FitOptions {
  budgetTokens: number;
  truncate?: (s: Section, maxTokens: number) => Section;
}

export interface FitResult {
  kept: Section[];
  dropped: Section[];
  usedTokens: number;
}

export function fitWithinBudget(
  sections: Section[],
  opts: FitOptions
): FitResult {
  const sorted = [...sections].sort((a, b) => b.priority - a.priority);
  const kept: Section[] = [];
  const dropped: Section[] = [];
  let used = 0;
  for (const s of sorted) {
    const tk = estimateTokens(s.text);
    if (used + tk <= opts.budgetTokens) {
      kept.push(s);
      used += tk;
    } else if (opts.truncate && opts.budgetTokens - used > 200) {
      const trimmed = opts.truncate(s, opts.budgetTokens - used);
      kept.push(trimmed);
      used += estimateTokens(trimmed.text);
    } else {
      dropped.push(s);
    }
  }
  return { kept, dropped, usedTokens: used };
}

/**
 * 默认裁剪策略: 按字符比例截断到目标 token 数附近, 保留头部.
 * - 在末尾追加省略号 ("…(因预算截断)") 提示
 */
export function defaultTruncate(s: Section, maxTokens: number): Section {
  // 估算当前每个字符大约多少 token, 粗略地按比例计算允许的字符数
  const currentTokens = estimateTokens(s.text);
  if (currentTokens <= maxTokens) return s;
  const ratio = maxTokens / currentTokens;
  const targetChars = Math.max(0, Math.floor(s.text.length * ratio * 0.95)); // 留 5% 余量给省略提示
  const truncated = s.text.slice(0, targetChars) + "\n\n…(因预算截断)";
  return { ...s, text: truncated };
}
