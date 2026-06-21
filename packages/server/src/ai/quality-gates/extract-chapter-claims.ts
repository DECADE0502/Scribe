import type { HardFactClaimOutput } from "@scribe/shared";
import type { HardFactClaim, HardFactValue } from "./hard-facts.js";

/**
 * 把 audit 输出的 hardFacts(经 zod 校验的 HardFactClaimOutput[])
 * 转成 pipeline 使用的 HardFactClaim[]。
 *
 * AI 提取的声明 source 固定为 "chapter_claim"，confidence 0.8
 * (低于 prior_state 的 1.0，这样在比较时 prior 优先)。
 */
export function extractClaimsFromAudit(
  auditHardFacts: HardFactClaimOutput[],
  chapterNo: number,
): HardFactClaim[] {
  return auditHardFacts.map((claim) => ({
    entity: claim.entity,
    attribute: claim.attribute,
    value: coerceHardFactValue(claim.value),
    factType: claim.factType,
    scope: claim.scope,
    source: "chapter_claim" as const,
    evidence: claim.evidence,
    confidence: 0.8,
    chapterNo,
    operation: claim.operation,
    cause: claim.cause,
  }));
}

function coerceHardFactValue(
  value: HardFactClaimOutput["value"],
): HardFactValue {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  // 对象形式 { quantity, unit?, raw? }
  return {
    quantity: value.quantity,
    unit: value.unit,
    raw: value.raw,
  };
}

/**
 * 确定性提取：对 priorFacts 里的每个已知属性，在正文中搜索该属性的当前值。
 *
 * 不依赖任何题材词汇，纯靠 entity 名 + attribute 名的文本匹配 + 数字模式。
 * 找到与 priorFact 不同的值时生成 currentClaim（cause 为空，触发矛盾检测）。
 */
export function extractChapterClaimsFromText(
  text: string,
  priorFacts: HardFactClaim[],
  chapterNo: number,
): HardFactClaim[] {
  const claims: HardFactClaim[] = [];
  const seen = new Set<string>();

  for (const prior of priorFacts) {
    const key = `${prior.entity}::${prior.attribute}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // 在正文中搜索包含 entity 名的段落/句子
    const sentences = findSentencesWithEntity(text, prior.entity);
    if (sentences.length === 0) continue;

    // 在这些句子里搜索 attribute 名附近的数值
    const extractedValue = findValueNearAttribute(sentences, prior.attribute, prior.entity);
    if (extractedValue === undefined) continue;

    // 如果提取到的值与 prior 相同，不生成 claim（无变化）
    if (valuesEqual(extractedValue, prior.value)) continue;

    // 检查句子里是否有变化原因关键词
    const { operation, cause } = detectOperationAndCause(sentences.join(" "));

    claims.push({
      entity: prior.entity,
      attribute: prior.attribute,
      value: extractedValue,
      factType: prior.factType,
      scope: prior.scope,
      source: "chapter_claim" as const,
      evidence: sentences[0]!.slice(0, 200),
      confidence: 0.9, // 确定性提取，高置信度
      chapterNo,
      operation,
      cause,
    });
  }

  return claims;
}

function findSentencesWithEntity(text: string, entity: string): string[] {
  if (!entity.trim()) return [];
  // 按句号/换行分割
  const sentences = text
    .split(/(?<=[。！？!?\n])|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return sentences.filter((s) => s.includes(entity));
}

/**
 * 在句子中搜索 attribute 名附近的数值。
 *
 * 支持的格式（完全不依赖具体属性名）：
 * - "HP：73" / "HP: 73" / "HP=73"
 * - "捕捉球：2（基础款）"
 * - "精神力（SP）：73/100"
 * - "金币：500"
 * - "HP：100/100"
 */
function findValueNearAttribute(
  sentences: string[],
  attribute: string,
  entity: string,
): HardFactValue | undefined {
  if (!attribute.trim()) return undefined;

  // 构建搜索 pattern：attribute 名后面跟 : ： = 然后是数字
  // 同时支持 entity 名在前或 attribute 名独立出现
  const attrEscaped = escapeRegex(attribute);

  for (const sentence of sentences) {
    // 模式1: attribute 后面跟冒号/等号再跟数字 (如 "HP：73" 或 "SP: 100/100")
    const pattern1 = new RegExp(
      `${attrEscaped}[\\s]*[：:=＝][\\s]*(\\d+(?:\\.\\d+)?)(?:\\s*/\\s*(\\d+(?:\\.\\d+)?))?`,
      "i",
    );
    const match1 = sentence.match(pattern1);
    if (match1) {
      const num = Number(match1[1]);
      // 如果有分母（如 73/100），只取分子作为当前值
      return { quantity: num, raw: match1[0] };
    }

    // 模式2: "attribute + 数字"（无标点分隔，如 "HP73"）
    const pattern2 = new RegExp(`${attrEscaped}(\\d+(?:\\.\\d+)?)`, "i");
    const match2 = sentence.match(pattern2);
    if (match2) {
      return { quantity: Number(match2[1]), raw: match2[0] };
    }
  }

  // 如果 attribute 是字符串类型（如 location），尝试找 "attribute：xxx" 的字符串值
  for (const sentence of sentences) {
    const pattern3 = new RegExp(
      `${attrEscaped}[\\s]*[：:=＝][\\s]*([^\\s，。！？\\n]{1,30})`,
      "i",
    );
    const match3 = sentence.match(pattern3);
    if (match3 && isNaN(Number(match3[1]))) {
      return match3[1]!;
    }
  }

  return undefined;
}

function detectOperationAndCause(
  text: string,
): { operation?: HardFactClaim["operation"]; cause?: string } {
  // 通用变化动词（不硬编码题材词汇）
  const decreasePatterns = [
    /消耗[了]?(?:\d+)?/,
    /损[失耗]/,
    /用[了去](?:\d+)?/,
    /减[少]/,
    /扣[除减]/,
    /花[费了]/,
    /掉[了]/,
    /碎[裂了]/,
    /失去/,
    /cost|consumed|lost|decreased/i,
  ];
  const increasePatterns = [
    /获[得取]/,
    /增[加]/,
    /恢[复]/,
    /补[充充回]/,
    /得到/,
    /赚[到取]/,
    /gained|increased|restored|recovered/i,
  ];
  const setPatterns = [
    /变[成为了]/,
    /改[成变]/,
    /设[定为]/,
    /变成/,
    /changed to|set to/i,
  ];

  for (const pattern of decreasePatterns) {
    if (pattern.test(text)) {
      return { operation: "decrease", cause: pattern.source };
    }
  }
  for (const pattern of increasePatterns) {
    if (pattern.test(text)) {
      return { operation: "increase", cause: pattern.source };
    }
  }
  for (const pattern of setPatterns) {
    if (pattern.test(text)) {
      return { operation: "set", cause: pattern.source };
    }
  }

  return {};
}

function valuesEqual(a: HardFactValue, b: HardFactValue): boolean {
  if (typeof a === "object" && a !== null && "quantity" in a &&
      typeof b === "object" && b !== null && "quantity" in b) {
    return a.quantity === b.quantity;
  }
  if (typeof a === "number" && typeof b === "number") return a === b;
  return String(a) === String(b);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
