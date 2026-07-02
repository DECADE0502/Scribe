import { z } from "zod";
import { streamLlm, generateLlmText } from "../llm-call.js";
import { prependDeepestPrompt } from "../prompts/deepest-prompt.js";
import type { TaskContext, TaskDef, TaskStreamEvent } from "./types.js";

const ExtractSchema = z.object({
  title: z.string().default(""),
  premise: z.string().default(""),
  characters: z.array(z.object({
    name: z.string(),
    role: z.enum(["protagonist", "supporting", "antagonist", "minor"]).default("supporting"),
    baseData: z.record(z.unknown()).default({}),
    currentState: z.record(z.unknown()).default({}),
  })).default([]),
  outline: z.array(z.object({
    title: z.string(),
    level: z.enum(["volume", "arc", "chapter"]).default("volume"),
    summary: z.string().default(""),
    parentId: z.string().nullable().default(null),
  })).default([]),
  worldbook: z.array(z.object({
    title: z.string(),
    content: z.string(),
    keys: z.array(z.string()).default([]),
  })).default([]),
});
type Extracted = z.infer<typeof ExtractSchema>;
/** 抽取步骤的输入形状：字段可省略，由 ExtractSchema 在 parse() 里补默认值（与 write-chapter.ts 同一套路）。 */
type ExtractedInput = z.input<typeof ExtractSchema>;

export interface OnboardParsed extends Extracted { reply: string; }

interface OnboardDeps {
  streamReply?: (ctx: TaskContext) => AsyncIterable<string>;
  extractStructured?: (ctx: TaskContext, reply: string) => Promise<ExtractedInput>;
}

/**
 * 名称/标题归一化：去首尾空白 + 内部空白折叠为单空格。
 * 与 write-chapter.ts::normalizeText 语义一致，这里 inline 一份避免跨任务耦合。
 */
function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/**
 * "minor" 不是 Character.role 的合法值（CharacterSchema 只接受
 * protagonist/antagonist/supporting/null）。与 write-chapter.ts::normalizeCharacterRole
 * 同一处理，这里 inline 一份避免跨任务耦合。
 */
function normalizeCharacterRole(
  role: Extracted["characters"][number]["role"],
): "protagonist" | "antagonist" | "supporting" | undefined {
  return role === "minor" ? "supporting" : role;
}

function makeTask(deps: OnboardDeps = {}): TaskDef<OnboardParsed> & { withDeps: (d: OnboardDeps) => TaskDef<OnboardParsed> } {
  const streamReply = deps.streamReply ?? defaultStreamReply;
  const extractStructured = deps.extractStructured ?? defaultExtractStructured;

  const task: TaskDef<OnboardParsed> & { withDeps: (d: OnboardDeps) => TaskDef<OnboardParsed> } = {
    name: "onboard",
    mutates: true,
    async *stream(ctx): AsyncIterable<TaskStreamEvent> {
      for await (const chunk of streamReply(ctx)) if (chunk) yield { type: "text_delta", delta: chunk };
    },
    async parse(ctx, streamedText) {
      const reply = streamedText.trim();
      const rawExtracted = await extractStructured(ctx, reply);
      const extracted = ExtractSchema.parse(rawExtracted);
      return { reply, ...extracted };
    },
    apply(ctx, parsed) {
      const { handle } = ctx;
      // dispatch.ts 把 parsed 当 unknown 传递，apply() 可能被裸对象调用（测试即如此），
      // 对数组字段做 nullish 兜底，避免个别字段缺失时炸掉整个 apply（同 write-chapter.ts 套路）。
      const title = normalizeText(parsed.title ?? "");
      const premise = normalizeText(parsed.premise ?? "");
      const runDb = handle.workspaceDb.transaction(() => {
        // bookMetaRepo 是 get(key)/set(key,value) 的 KV store，没有 upsert()
        // （见 packages/server/src/db/repositories/book-meta.ts）。
        if (title) handle.bookMetaRepo.set("title", title);
        if (premise) handle.bookMetaRepo.set("premise", premise);

        // 角色：name 用 normalizeText dedup，与 write-chapter.ts 一致；
        // onboard 阶段角色是全新建档，已存在同名则跳过（不覆盖，避免踩掉后续章节已产生的 currentState）。
        const existingChars = handle.charactersRepo.list();
        for (const c of parsed.characters ?? []) {
          const cleanName = normalizeText(c.name ?? "");
          if (!cleanName) continue;
          const exists = existingChars.find((x: any) => normalizeText(x.name) === cleanName);
          if (!exists) {
            handle.charactersRepo.create({
              name: cleanName,
              role: normalizeCharacterRole(c.role) ?? null,
              baseData: c.baseData ?? {},
              currentState: c.currentState ?? {},
            });
          }
        }

        // 大纲：onboard 只产出首层节点（通常是卷级），按抽取顺序追加到已有节点之后。
        // 若书里已有 outline 节点，直接用 idx 会撞车 / 排到已有节点前，
        // 因此 sortOrder 从 (max(现有 sortOrder) + 1) 起算，退化时用 length 兜底。
        const existingOutline = handle.outlineRepo.listAll();
        const baseSortOrder = existingOutline.length
          ? Math.max(...existingOutline.map((n: any) => n.sortOrder ?? 0)) + 1
          : 0;
        const outlineList = parsed.outline ?? [];
        outlineList.forEach((o, idx) => {
          handle.outlineRepo.create({
            parentId: o.parentId ?? null,
            level: o.level ?? "volume",
            title: normalizeText(o.title ?? ""),
            summary: o.summary ?? "",
            status: "planned",
            sortOrder: baseSortOrder + idx,
            metadata: null,
          });
        });

        // 世界书：title 用 normalizeText dedup。
        const existingWb = handle.worldbookRepo.list();
        for (const w of parsed.worldbook ?? []) {
          const cleanTitle = normalizeText(w.title ?? "");
          if (!cleanTitle) continue;
          const exists = existingWb.find((x: any) => normalizeText(x.title) === cleanTitle);
          if (!exists) {
            handle.worldbookRepo.create({
              title: cleanTitle,
              content: w.content ?? "",
              keys: w.keys ?? [],
              enabled: true,
              activation: "triggered",
              constant: false,
              priority: 0,
              insertionDepth: 0,
              recursive: false,
              recursionLimit: 0,
              metadata: { source: "onboard" },
            });
          }
        }
      });
      runDb();
    },
    withDeps: (d) => makeTask(d),
  };
  return task;
}

async function* defaultStreamReply(ctx: TaskContext): AsyncIterable<string> {
  const messages = [
    {
      role: "system" as const,
      content: [
        "你是小说初始化助手,协助用户搭建新书设定。",
        "对话中主动提炼主角/世界观/大纲要素,并在回复里总结你理解到的东西。",
        "输出中文对话,不要输出 JSON。",
      ].join("\n"),
    },
    { role: "user" as const, content: ctx.request.message },
  ];
  for await (const ev of streamLlm({
    model: ctx.writeModel,
    messages: prependDeepestPrompt(messages, ctx.deepestPrompt),
    abortSignal: ctx.abortSignal,
  })) {
    if (ev.type === "text_delta") yield ev.delta;
    else if (ev.type === "usage") {
      ctx.onUsage?.({
        promptTokens: ev.promptTokens,
        completionTokens: ev.completionTokens,
        cachedTokens: ev.cachedTokens,
        reasoningTokens: ev.reasoningTokens,
        modelRole: "write",
      });
    } else if (ev.type === "error") {
      // streamLlm 只 yield error 不抛;转 throw 让 dispatch 走 stream_failed。
      throw new Error(ev.message);
    }
  }
}

async function defaultExtractStructured(ctx: TaskContext, reply: string): Promise<ExtractedInput> {
  const prompt = [
    "You are extracting structured novel setup from a conversation.",
    "Return ONLY valid JSON (no markdown), matching:",
    "{ title, premise, characters:[{name,role,baseData,currentState}], outline:[{title,level,summary,parentId}], worldbook:[{title,content,keys}] }",
    "Only extract concrete items mentioned. Prefer volume-level outline nodes. Empty arrays are fine.",
  ].join("\n");
  const { text, usage } = await generateLlmText({
    model: ctx.auditModel,
    messages: prependDeepestPrompt([
      { role: "system", content: prompt },
      { role: "user", content: `用户原文:${ctx.request.message}\n\n助手回复:${reply}` },
    ], ctx.deepestPrompt),
    abortSignal: ctx.abortSignal,
  });
  ctx.onUsage?.({ ...usage, modelRole: "audit" });
  const trimmed = text.trim().replace(/^```json\s*|\s*```$/g, "");
  const parsed = ExtractSchema.safeParse(JSON.parse(trimmed));
  if (!parsed.success) throw new Error(`onboard_extract_failed: ${parsed.error.message}`);
  return parsed.data;
}

export const onboardTask = makeTask();
