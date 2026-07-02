import { z } from "zod";
import { streamLlm, generateLlmText } from "../llm-call.js";
import { buildChapterWriteMessages } from "../context-builder/book-context.js";
import type { TaskContext, TaskDef, TaskStreamEvent } from "./types.js";

const MIN_DRAFT_CHARS = 500;

const ExtractSchema = z.object({
  characters: z.array(z.object({
    name: z.string(), role: z.enum(["protagonist", "supporting", "antagonist", "minor"]).default("supporting"),
    baseData: z.record(z.unknown()).default({}),
    currentState: z.record(z.unknown()).default({}),
  })).default([]),
  foreshadowing: z.array(z.object({
    label: z.string(), description: z.string().default(""),
    plantedChapter: z.number().int(), status: z.enum(["planted", "hinted", "resolved"]).default("planted"),
    relatedCharacters: z.array(z.string()).default([]),
  })).default([]),
  timeline: z.array(z.object({
    chapterNo: z.number().int(),
    storyTime: z.string(),
    event: z.string(),
    participants: z.array(z.string()).default([]),
  })).default([]),
});
type Extracted = z.infer<typeof ExtractSchema>;
/** 抽取步骤的输入形状:字段可省略,由 ExtractSchema 在 parse() 里补默认值。 */
type ExtractedInput = z.input<typeof ExtractSchema>;

export interface WriteChapterParsed extends Extracted {
  chapterNo: number;
  title: string;
  content: string;
}

interface WriteChapterDeps {
  streamProse?: (ctx: TaskContext) => AsyncIterable<string>;
  extractStructured?: (ctx: TaskContext, prose: string) => Promise<ExtractedInput>;
}

/**
 * 名称/标签归一化:去首尾空白 + 内部空白折叠为单空格。
 * 与 state-tools.ts 里的同名 helper 保持语义一致(那边是模块私有,不导出,
 * 这里 inline 一份以避免耦合 tools 层)。dedup 匹配和落库前清理都用它。
 */
function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/**
 * "minor" 不是 Character.role 的合法值(CharacterSchema 只接受
 * protagonist/antagonist/supporting/null)。抽取模型可能产出 "minor",
 * 这里落库前把它归一化,避免下次读取角色列表时 zod parse 炸掉。
 */
function normalizeCharacterRole(
  role: Extracted["characters"][number]["role"],
): "protagonist" | "antagonist" | "supporting" | undefined {
  return role === "minor" ? "supporting" : role;
}

/**
 * 抽取模型产出的伏笔状态词("planted"/"hinted"/"resolved")与领域模型的
 * ForeshadowingStatusSchema("active"/"paid"/"dropped")不是同一套值域。
 * foreshadowingRepo.create() 写入时不做 zod 校验(裸 INSERT),但下次
 * list() 读取时会用 ForeshadowingSchema.parse() 校验 status,不归一化的话
 * 首次写入 "planted" 就会让后续所有伏笔读取炸掉。
 */
function normalizeForeshadowingStatus(
  status: Extracted["foreshadowing"][number]["status"],
): "active" | "paid" | "dropped" {
  return status === "resolved" ? "paid" : "active";
}

function makeTask(deps: WriteChapterDeps = {}): TaskDef<WriteChapterParsed> & { withDeps: (d: WriteChapterDeps) => TaskDef<WriteChapterParsed> } {
  const streamProse = deps.streamProse ?? defaultStreamProse;
  const extractStructured = deps.extractStructured ?? defaultExtractStructured;

  const task: TaskDef<WriteChapterParsed> & { withDeps: (d: WriteChapterDeps) => TaskDef<WriteChapterParsed> } = {
    name: "write-chapter",

    async *stream(ctx: TaskContext): AsyncIterable<TaskStreamEvent> {
      for await (const chunk of streamProse(ctx)) {
        if (chunk) yield { type: "text_delta", delta: chunk };
      }
    },

    async parse(ctx, streamedText): Promise<WriteChapterParsed> {
      const chapterNo = ctx.request.target?.chapterNo;
      if (!chapterNo || chapterNo < 1) throw new Error("bad_chapter_no");
      const trimmed = streamedText.trim();
      if (trimmed.length < MIN_DRAFT_CHARS) {
        throw new Error(`draft_too_short: ${trimmed.length} chars (need ${MIN_DRAFT_CHARS})`);
      }
      const rawExtracted = await extractStructured(ctx, trimmed);
      const extracted = ExtractSchema.parse(rawExtracted);
      return {
        chapterNo,
        title: `第 ${chapterNo} 章`,
        content: trimmed,
        ...extracted,
      };
    },

    apply(ctx, parsed) {
      const { handle } = ctx;
      let savedVersion: number | undefined;
      const runDb = handle.workspaceDb.transaction(() => {
        const saved = handle.chaptersRepo.saveVersion({
          chapterNo: parsed.chapterNo, source: "ai_write", contentMd: parsed.content,
        });
        savedVersion = saved.versionNo;

        // 角色:list() hoist 到循环外;name 用 normalizeText 匹配已有条目。
        // role 一经创建不再由后续章节抽取覆盖(避免主角→配角类漂移)。
        const existingChars = handle.charactersRepo.list();
        for (const c of parsed.characters) {
          const cleanName = normalizeText(c.name ?? "");
          const existing = existingChars.find((x) => normalizeText(x.name) === cleanName);
          if (existing) {
            handle.charactersRepo.update(existing.id, {
              currentState: c.currentState,
              baseData: c.baseData,
            });
          } else {
            handle.charactersRepo.create({
              name: cleanName,
              role: normalizeCharacterRole(c.role) ?? null,
              baseData: c.baseData,
              currentState: c.currentState,
            });
          }
        }

        // 伏笔:label 用 normalizeText dedup,已存在则合并 relatedCharacters + 刷新 status/desc;
        // plantedChapter 一律 clamp 到本章号(抗 LLM 章号漂移)。
        // parsed 上游经 ExtractSchema.parse 补过默认值,但 apply() 允许调用方
        // 传裸对象(dispatch.ts 的 unknown 通道 / 测试直接构造),对 string 字段
        // 做 nullish 兜底,避免个别字段缺失时炸掉整个 apply。
        const existingForeshadowing = handle.foreshadowingRepo.list();
        for (const f of parsed.foreshadowing) {
          const cleanLabel = normalizeText(f.label ?? "");
          const cleanDesc = normalizeText(f.description ?? "");
          const status = normalizeForeshadowingStatus(f.status);
          const relatedCharacters = (f.relatedCharacters ?? []).map(normalizeText);
          const existing = existingForeshadowing.find((x) => normalizeText(x.label) === cleanLabel);
          if (existing) {
            handle.foreshadowingRepo.update(existing.id, {
              description: cleanDesc || existing.description,
              status,
              relatedCharacters: [...new Set([...existing.relatedCharacters, ...relatedCharacters])],
            });
          } else {
            handle.foreshadowingRepo.create({
              label: cleanLabel,
              description: cleanDesc || null,
              plantedChapter: parsed.chapterNo,
              paidChapter: null,
              status,
              relatedCharacters,
            });
          }
        }

        // 时间线:(storyTime, event) dedup;chapterNo 一律 clamp 到本章号。
        const existingTimeline = handle.timelineRepo.listAll();
        for (const t of parsed.timeline) {
          const cleanStoryTime = normalizeText(t.storyTime ?? "");
          const cleanEvent = normalizeText(t.event ?? "");
          const cleanParticipants = (t.participants ?? []).map(normalizeText);
          const dup = existingTimeline.find(
            (x) => normalizeText(x.storyTime) === cleanStoryTime && normalizeText(x.event) === cleanEvent,
          );
          if (!dup) {
            handle.timelineRepo.create({
              chapterNo: parsed.chapterNo,
              storyTime: cleanStoryTime,
              event: cleanEvent,
              participants: cleanParticipants,
            });
          }
        }
      });
      runDb();

      // FS write 在 DB 事务外,失败反向删版本
      try {
        handle.chapterFiles.save({
          chapterNo: parsed.chapterNo, content: parsed.content, title: parsed.title, versionNo: savedVersion!,
        });
      } catch (e) {
        try { handle.chaptersRepo.deleteVersion(parsed.chapterNo, savedVersion!); } catch { /* rollback best-effort */ }
        throw e;
      }
    },

    withDeps(d: WriteChapterDeps) { return makeTask(d); },
  };

  return task;
}

async function* defaultStreamProse(ctx: TaskContext): AsyncIterable<string> {
  const chapterNo = ctx.request.target?.chapterNo;
  if (!chapterNo) throw new Error("bad_chapter_no");
  const { messages } = buildChapterWriteMessages(
    ctx.handle, chapterNo, ctx.request.message, undefined, [],
  );
  for await (const ev of streamLlm({ model: ctx.writeModel, messages, abortSignal: ctx.abortSignal })) {
    if (ev.type === "text_delta") yield ev.delta;
  }
}

async function defaultExtractStructured(ctx: TaskContext, prose: string): Promise<ExtractedInput> {
  const chapterNo = ctx.request.target?.chapterNo ?? 0;
  const prompt = [
    "You are extracting structured state changes from a novel chapter.",
    "Return ONLY a valid JSON object matching this schema exactly (no markdown):",
    "{ characters:[{name,role,baseData,currentState}], foreshadowing:[{label,description,plantedChapter,status,relatedCharacters}], timeline:[{chapterNo,storyTime,event,participants}] }",
    `Current chapterNo: ${chapterNo}. Only extract items actually mentioned in the prose. Empty arrays if none.`,
  ].join("\n");
  const { text } = await generateLlmText({
    model: ctx.auditModel,
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: prose },
    ],
    abortSignal: ctx.abortSignal,
  });
  const trimmed = text.trim().replace(/^```json\s*|\s*```$/g, "");
  const parsed = ExtractSchema.safeParse(JSON.parse(trimmed));
  if (!parsed.success) throw new Error(`extract_parse_failed: ${parsed.error.message}`);
  return parsed.data;
}

export const writeChapterTask = makeTask();
