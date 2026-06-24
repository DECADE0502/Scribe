import type { CoreMessage } from "ai";
import type { AgentRunRequest } from "@scribe/shared";
import { generateLlmText } from "../llm-call.js";
import type { TaskContract } from "./executor-agent.js";

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  cachedTokens?: number;
  reasoningTokens?: number;
}

export interface MainAgentDeps {
  model: unknown;
  generateText?: (input: {
    model: unknown;
    messages: CoreMessage[];
    abortSignal?: AbortSignal;
  }) => Promise<{ text: string; usage?: LlmUsage }>;
  abortSignal?: AbortSignal;
  bookContext?: string;
}

export interface MainOutput {
  reply: string;
  draft?: string;
  usage?: LlmUsage;
  taskContract: TaskContract;
}

export type MainAgentInput =
  | string
  | Pick<AgentRunRequest, "message" | "source" | "executionMode" | "target">;

interface ModelDecision {
  intent?: string;
  reply?: string;
  draft?: string;
  affectedEntities?: unknown;
  assetChanges?: unknown;
  targetChapterNo?: unknown;
  chapterTitle?: unknown;
  chapterPlan?: unknown;
  acceptanceCriteria?: unknown;
}

const ALLOWED_INTENTS = new Set([
  "query_only",
  "write_chapter",
  "update_outline",
  "update_character",
  "update_worldbook",
  "asset_audit",
]);

export async function analyzeIntent(
  deps: MainAgentDeps,
  input: MainAgentInput,
): Promise<MainOutput> {
  const message = typeof input === "string" ? input : input.message;
  const source = typeof input === "string" ? undefined : input.source;
  const target = typeof input === "string" ? undefined : input.target;
  const executionMode = typeof input === "string" ? undefined : input.executionMode;
  const userInstruction = message.trim();
  const fallback = makeQueryOnly(
    userInstruction,
    source,
    target,
    executionMode,
    "无法确认执行意图，本轮仅作为对话记录，不执行写作或资产变更。",
  );

  let result: { text: string; usage?: LlmUsage };
  try {
    const messages = buildIntentMessages(userInstruction, source, target, deps.bookContext);
    result = deps.generateText
      ? await deps.generateText({ model: deps.model, messages, abortSignal: deps.abortSignal })
      : await generateLlmText({
        model: deps.model as never,
        messages,
        abortSignal: deps.abortSignal,
      });
  } catch {
    return fallback;
  }

  const decision = parseDecision(result.text);
  if (!decision?.intent || !ALLOWED_INTENTS.has(decision.intent)) {
    return { ...fallback, usage: result.usage };
  }

  if (decision.intent === "query_only") {
    return {
      ...makeQueryOnly(
        userInstruction,
        source,
        target,
        executionMode,
        textOrDefault(decision.reply, "收到，本轮仅记录为对话，不执行资产变更。"),
      ),
      usage: result.usage,
    };
  }

  const affectedEntities = Array.isArray(decision.affectedEntities)
    ? decision.affectedEntities.filter((item): item is string =>
      typeof item === "string" && item.trim().length > 0)
    : [];
  const assetChanges = normalizeAssetChanges(decision.assetChanges);
  const targetChapterNo = typeof decision.targetChapterNo === "number"
    ? Math.floor(decision.targetChapterNo)
    : target?.chapterNo;
  const draft = typeof decision.draft === "string" && decision.draft.trim()
    ? decision.draft
    : undefined;

  const taskContract: TaskContract = {
    intent: decision.intent,
    userInstruction,
    affectedEntities,
    assetChanges,
    source,
    target,
    executionMode,
    targetChapterNo,
    chapterTitle: typeof decision.chapterTitle === "string" ? decision.chapterTitle : undefined,
    chapterPlan: typeof decision.chapterPlan === "string" ? decision.chapterPlan : undefined,
    acceptanceCriteria: Array.isArray(decision.acceptanceCriteria)
      ? decision.acceptanceCriteria.filter((item): item is string => typeof item === "string")
      : [],
    draft,
  };

  return {
    reply: textOrDefault(decision.reply, "已完成意图识别，准备进入执行阶段。"),
    draft,
    usage: result.usage,
    taskContract,
  };
}

function makeQueryOnly(
  userInstruction: string,
  source: AgentRunRequest["source"] | undefined,
  target: AgentRunRequest["target"] | undefined,
  executionMode: AgentRunRequest["executionMode"] | undefined,
  reply: string,
): MainOutput {
  return {
    reply,
    taskContract: {
      intent: "query_only",
      userInstruction,
      affectedEntities: [],
      source,
      target,
      executionMode,
    },
  };
}

function buildIntentMessages(
  userInstruction: string,
  source: AgentRunRequest["source"] | undefined,
  target: AgentRunRequest["target"] | undefined,
  bookContext: string | undefined,
): CoreMessage[] {
  return [
    {
      role: "system",
      content: [
        "You are the main agent for a novel-writing project.",
        "Classify the user's intent by reasoning over the full request and project context.",
        "Do not use keyword, regex, or slash-command shortcuts to trigger writing.",
        "Only return a non-query intent when the user clearly asks for execution.",
        "Allowed intent values: query_only, write_chapter, update_outline, update_character, update_worldbook, asset_audit.",
        "Return exactly one JSON object. Do not use Markdown.",
        "Fields: intent, reply, draft, affectedEntities, assetChanges, targetChapterNo, chapterTitle, chapterPlan, acceptanceCriteria.",
        "For tool updates, prefer assetChanges with explicit content instead of bare affectedEntities.",
        "assetChanges items: {type:'character',name,role,baseData,currentState} | {type:'outline',title,level,summary,parentId,sortOrder} | {type:'worldbook',title,content,keys}.",
        "If you write prose, put the full hidden draft in draft. Keep reply short and do not duplicate the draft.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        bookContext ? `# Book Context\n${bookContext}` : "",
        "# User Request",
        JSON.stringify({ userInstruction, source, target }),
      ].filter(Boolean).join("\n\n"),
    },
  ];
}

function parseDecision(text: string): ModelDecision | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return undefined;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    return parsed as ModelDecision;
  } catch {
    return undefined;
  }
}

function textOrDefault(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function normalizeAssetChanges(value: unknown): TaskContract["assetChanges"] {
  if (!Array.isArray(value)) return undefined;
  const changes: NonNullable<TaskContract["assetChanges"]> = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    if (item.type === "character" && typeof item.name === "string") {
      changes.push({
        type: "character",
        name: item.name,
        role: typeof item.role === "string" ? item.role : undefined,
        baseData: isRecord(item.baseData) ? item.baseData : undefined,
        currentState: isRecord(item.currentState) ? item.currentState : undefined,
      });
    } else if (item.type === "outline" && typeof item.title === "string") {
      changes.push({
        type: "outline",
        title: item.title,
        level: item.level === "volume" || item.level === "arc" || item.level === "chapter"
          ? item.level
          : undefined,
        summary: typeof item.summary === "string" ? item.summary : undefined,
        parentId: typeof item.parentId === "string" || item.parentId === null ? item.parentId : undefined,
        sortOrder: typeof item.sortOrder === "number" ? item.sortOrder : undefined,
      });
    } else if (item.type === "worldbook" && typeof item.title === "string" && typeof item.content === "string") {
      changes.push({
        type: "worldbook",
        title: item.title,
        content: item.content,
        keys: Array.isArray(item.keys)
          ? item.keys.filter((key): key is string => typeof key === "string")
          : undefined,
      });
    }
  }
  return changes.length > 0 ? changes : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
