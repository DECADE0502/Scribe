import { generateText, type LanguageModel } from "ai";

/**
 * 意图分类(spec §7.3)。每条非斜杠消息进 server 后先分类,决定路由:
 * - chitchat        闲聊 / 情绪表达       → 带书设定的普通对话
 * - writing_intent  想推进剧情 / 写下一章 → 触发写章
 * - revise_intent   想改某段(无选区)    → 提示去编辑器选段,或按描述改当前章
 * - query           询问设定 / 前情       → 带书设定+召回的问答
 * - genre_section_op 想加/改通用记录资料  → 带记录工具的对话(AI 落地到右栏)
 * - other           兜底                  → 普通对话
 * command_explicit 由 parseSlashCommand 在分类前判定,不走本分类器。
 */
export type IntentCategory =
  | "chitchat"
  | "writing_intent"
  | "revise_intent"
  | "query"
  | "genre_section_op"
  | "command_explicit"
  | "delete_intent"
  | "agentic"
  | "other";

export interface IntentAnalysis {
  category: IntentCategory;
  chapterCount?: number;
  targetChapter?: number;
  /** 本次分类调用的 token 用量(全量计费用) */
  usage?: { promptTokens: number; completionTokens: number; cachedTokens: number; reasoningTokens: number };
}

const VALID: IntentCategory[] = [
  "chitchat",
  "writing_intent",
  "revise_intent",
  "query",
  "genre_section_op",
  "command_explicit",
  "delete_intent",
  "agentic",
  "other",
];

const CLASSIFY_PROMPT = `你是意图分类器。判断用户这句话属于下面哪一类,只输出类别英文标识(单个词,不要解释、不要标点):

- writing_intent:想继续写、推进剧情、写下一章、"接着写"、描述接下来发生什么
- revise_intent:想修改/重写已有的某段或某章内容
- query:在询问故事设定、人物、前情、之前写了什么
- genre_section_op:想新增或修改需要长期保持一致的记录资料、设定条目、世界规则、关系或线索
- chitchat:闲聊、情绪表达、与创作无关或泛泛而谈
- other:无法归类

只输出:writing_intent | revise_intent | query | genre_section_op | chitchat | other`;

/**
 * 用便宜模型做一次极短分类。任何异常/不可解析都安全回退到 chitchat,
 * 保证对话永远能继续(分类失败不该阻断用户)。
 */
export async function classifyIntent(
  model: LanguageModel,
  message: string,
  abortSignal?: AbortSignal,
): Promise<IntentCategory> {
  try {
    const result = await generateText({
      model,
      messages: [
        { role: "system", content: CLASSIFY_PROMPT },
        { role: "user", content: message },
      ],
      abortSignal,
    });
    const raw = result.text.trim().toLowerCase();
    const hit = VALID.find((v) => raw.includes(v));
    return hit ?? "chitchat";
  } catch {
    return "chitchat";
  }
}

const ANALYZE_PROMPT = `你是小说创作项目的意图检验 agent。请把用户指令转成严格 JSON，不要输出解释。

JSON 字段:
- category: writing_intent | revise_intent | delete_intent | query | genre_section_op | chitchat | other
- chapterCount: 可选数字。用户要求写多章时填写；没有明确数量时省略。
- targetChapter: 可选数字。用户要求重写、删除、审查某章时填写；没有明确目标时省略。

规则:
- 写下一章、继续写、写多章、推进剧情 => writing_intent
- 重写、改写已有章节 => revise_intent
- 删除、清空章节 => delete_intent
- 审查、检查、评价章节质量，或询问设定/前情 => query
- 新增或修改长期资料、设定条目、角色、大纲、世界规则、线索 => genre_section_op
- 只输出 JSON，例如 {"category":"writing_intent","chapterCount":3}`;

export async function analyzeIntent(
  model: LanguageModel,
  message: string,
  abortSignal?: AbortSignal,
): Promise<IntentAnalysis> {
  try {
    const result = await generateText({
      model,
      messages: [
        { role: "system", content: ANALYZE_PROMPT },
        { role: "user", content: message },
      ],
      abortSignal,
    });
    const parsed = JSON.parse(result.text.trim()) as Partial<IntentAnalysis>;
    const category = parsed.category && VALID.includes(parsed.category)
      ? parsed.category
      : "chitchat";
    return {
      category,
      chapterCount: normalizePositiveInt(parsed.chapterCount, 10),
      targetChapter: normalizePositiveInt(parsed.targetChapter),
      usage: {
        promptTokens: result.usage.promptTokens ?? 0,
        completionTokens: result.usage.completionTokens ?? 0,
        cachedTokens: 0,
        reasoningTokens: 0,
      },
    };
  } catch {
    return { category: await classifyIntent(model, message, abortSignal) };
  }
}

function normalizePositiveInt(value: unknown, max?: number): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) return undefined;
  return max ? Math.min(value, max) : value;
}
