import type { LanguageModel } from "ai";
import { generateLlmText } from "../llm-call.js";
import { prependDeepestPrompt } from "../prompts/deepest-prompt.js";

export const COMPRESS_ARC_PROMPT = `你是 Scribe 的弧总结编辑。把以下若干章的小总结揉成 1-2 段(中文,~200-400 字)的弧总结,覆盖:
- 本弧主线推进
- 关键事件与转折
- 留给后续的悬念/伏笔(必须明示哪些活跃)
- 主要角色弧内变化
- 视角与文风延续要点(若与全书契约不一致,标出)

直接输出弧总结,不要前言。`;

export const COMPRESS_VOLUME_PROMPT = `你是 Scribe 的卷总结编辑。把以下若干弧的弧总结揉成 3-5 段(中文,~600-1200 字)的卷总结。覆盖整卷主线、核心人物变化、本卷未结尾的伏笔承接、视角文风延续。直接输出卷总结,不要前言。`;

export async function compressArc(opts: {
  model: LanguageModel;
  abortSignal?: AbortSignal;
  deepestPrompt?: string;
  chapterSummaries: Array<{ chapterNo: number; oneLiner: string; paragraph: string }>;
}): Promise<string> {
  const userMsg = [
    "## 本弧章节小总结",
    ...opts.chapterSummaries.map(
      (s) => `### 第 ${s.chapterNo} 章 — ${s.oneLiner}\n${s.paragraph}`,
    ),
  ].join("\n");
  const result = await generateLlmText({
    model: opts.model,
    messages: prependDeepestPrompt(
      [
        { role: "system", content: COMPRESS_ARC_PROMPT },
        { role: "user", content: userMsg },
      ],
      opts.deepestPrompt,
    ),
    abortSignal: opts.abortSignal,
    providerOptions: { deepseek: { thinking: { type: "disabled" } } },
  });
  return result.text;
}

export async function compressVolume(opts: {
  model: LanguageModel;
  abortSignal?: AbortSignal;
  deepestPrompt?: string;
  arcSummaries: Array<{ nodeTitle: string; text: string }>;
}): Promise<string> {
  const userMsg = [
    "## 本卷各弧总结",
    ...opts.arcSummaries.map((a) => `### ${a.nodeTitle}\n${a.text}`),
  ].join("\n");
  const result = await generateLlmText({
    model: opts.model,
    messages: prependDeepestPrompt(
      [
        { role: "system", content: COMPRESS_VOLUME_PROMPT },
        { role: "user", content: userMsg },
      ],
      opts.deepestPrompt,
    ),
    abortSignal: opts.abortSignal,
    providerOptions: { deepseek: { thinking: { type: "disabled" } } },
  });
  return result.text;
}