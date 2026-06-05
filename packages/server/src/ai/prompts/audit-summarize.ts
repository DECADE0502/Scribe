import {
  ChapterAuditOutputSchema,
  type ChapterAuditOutput,
} from "@scribe/shared";

export const AUDIT_SUMMARIZE_PROMPT = `你是 Scribe 的章末审读员,同时负责生成本章摘要。
你将收到:
1) 本书 premise + tone + rules.md
2) 主要角色卡 + 活跃伏笔列表
3) 本章正文
4) 本章计划(若有)

请只输出一个 JSON,字段如下(严格不要多余文字、不要 Markdown 包裹):

{
  "verdict": "ok" | "warning" | "critical",
  "issues": [
    {
      "dimension": "setting_consistency"|"character_behavior"|"pacing"
                  |"narrative_coherence"|"foreshadowing"|"hook_strength"|"aesthetic_quality",
      "severity": "ok"|"warning"|"critical",
      "score": 0-10,
      "excerpt": "原文片段(可选)",
      "note": "中文说明问题或亮点"
    }
  ],
  "summary": {
    "oneLiner": "15-30 字一句话章节摘要",
    "paragraph": "200-500 字段落摘要,服务于后续章节的上下文召回",
    "keyEvents": [
      { "event": "事件描述", "characters": ["角色名"], "foreshadowingRefs": ["伏笔标签"] }
    ]
  }
}

判断 verdict 的规则:任一 issue 为 critical → critical;否则任一 warning → warning;全部 ok → ok。
七个维度都要给出 score 和 note(没问题就 note "无明显问题")。`;

/**
 * 解析 LLM 输出的章末审查 JSON,返回结构化对象。
 *
 * 容错:
 * - 自动剥去 ```json ... ``` 或 ``` ... ``` 围栏
 * - 自动剥去前后空白
 * - JSON 解析失败 → 抛错(中文消息)
 * - Schema 校验失败 → 抛错(zod 默认消息)
 */
export function parseAuditOutput(raw: string): ChapterAuditOutput {
  let text = raw.trim();
  // 剥 ```json ... ``` 围栏
  const fenceMatch = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (fenceMatch) text = fenceMatch[1]!.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`审查输出 JSON 解析失败: ${(e as Error).message}`);
  }
  return ChapterAuditOutputSchema.parse(parsed);
}
