import { generateText, type LanguageModel } from "ai";

/**
 * 意图分类(spec §7.3)。每条非斜杠消息进 server 后先分类,决定路由:
 * - chitchat        闲聊 / 情绪表达       → 带书设定的普通对话
 * - writing_intent  想推进剧情 / 写下一章 → 触发写章
 * - revise_intent   想改某段(无选区)    → 提示去编辑器选段,或按描述改当前章
 * - query           询问设定 / 前情       → 带书设定+召回的问答
 * - genre_section_op 想加/改题材资料      → 带题材工具的对话(AI 落地到右栏)
 * - other           兜底                  → 普通对话
 * command_explicit 由 parseSlashCommand 在分类前判定,不走本分类器。
 */
export type IntentCategory =
  | "chitchat"
  | "writing_intent"
  | "revise_intent"
  | "query"
  | "genre_section_op"
  | "other";

const VALID: IntentCategory[] = [
  "chitchat",
  "writing_intent",
  "revise_intent",
  "query",
  "genre_section_op",
  "other",
];

const CLASSIFY_PROMPT = `你是意图分类器。判断用户这句话属于下面哪一类,只输出类别英文标识(单个词,不要解释、不要标点):

- writing_intent:想继续写、推进剧情、写下一章、"接着写"、描述接下来发生什么
- revise_intent:想修改/重写已有的某段或某章内容
- query:在询问故事设定、人物、前情、之前写了什么
- genre_section_op:想新增或修改题材资料(功法/道具/势力/地点等设定条目)
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
