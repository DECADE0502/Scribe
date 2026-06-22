import type { ModelInfo, TaskType } from "@scribe/shared";

/**
 * Token 用量追踪 + 成本计算。
 *
 * 不变量(important):
 * - `reasoningTokens` 是 `completionTokens` 的子集(DeepSeek V4 等 reasoning 模型 API 返回时,
 *   completion_tokens 已包含 reasoning_tokens),仅用于审计/可视化,**不参与成本计算**。
 * - 若将来接入"reasoning 单独计费"的 provider(eg 某些第三方代理),需要新增 reasoningOutput
 *   字段到 ModelInfo.pricing,并在此处单独折算,届时本约束作废。
 */

interface RecordInput {
  bookId: string;
  taskType: TaskType;
  model: ModelInfo;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  reasoningTokens?: number;
  chapterNo?: number;
}

interface TokenUsageRepoLike {
  record(input: {
    taskType: TaskType;
    model: string;
    promptTokens: number;
    completionTokens: number;
    cachedTokens: number;
    reasoningTokens: number;
    costUsd: number;
    chapterNo: number | null;
  }): void;
}

interface BooksRepoLike {
  addCost(bookId: string, deltaUsd: number): void;
}

export function createUsageTracker(opts: {
  tokenUsageRepo: TokenUsageRepoLike;
  booksRepo: BooksRepoLike;
}) {
  return {
    async record(input: RecordInput): Promise<void> {
      const cost = computeCost(input);
      opts.tokenUsageRepo.record({
        taskType: input.taskType,
        model: input.model.id,
        promptTokens: input.promptTokens,
        completionTokens: input.completionTokens,
        cachedTokens: input.cachedTokens,
        reasoningTokens: input.reasoningTokens ?? 0,
        costUsd: cost,
        chapterNo: input.chapterNo ?? null,
      });
      opts.booksRepo.addCost(input.bookId, cost);
    },
  };
}

function computeCost(i: RecordInput): number {
  return computeUsageCost(i.model, i.promptTokens, i.completionTokens, i.cachedTokens);
}

/**
 * 计算一次调用的美元成本,缓存命中部分按 cachedInput 价(DeepSeek 缓存命中显著更便宜)。
 * 供 auto/conversation 路由直接计费时复用,保持与 usage-tracker 一致的口径。
 */
export function computeUsageCost(
  model: ModelInfo,
  promptTokens: number,
  completionTokens: number,
  cachedTokens: number,
): number {
  const p = model.pricing;
  if (!p) return 0;
  const nonCachedPrompt = Math.max(0, promptTokens - cachedTokens);
  const inputCost = (nonCachedPrompt / 1e6) * p.input;
  const cachedCost = (cachedTokens / 1e6) * (p.cachedInput ?? p.input);
  const outputCost = (completionTokens / 1e6) * p.output;
  return inputCost + cachedCost + outputCost;
}

/**
 * 全量计费包装:透传一个 SSE 事件流,沿途把每个 `usage` 事件落库 + 累计成本。
 * 任何产生 LLM 调用的路由都可以用它包一层,确保 token 用量不漏记。
 * modelInfo 缺失(无价格表)时仍记录 token,只是 costUsd=0。
 */
export async function* withUsageRecording<T>(
  stream: AsyncIterable<T>,
  deps: {
    tokenUsageRepo: TokenUsageRepoLike;
    booksRepo: BooksRepoLike;
    bookId: string;
    modelInfo: ModelInfo | undefined;
    taskType: TaskType;
    chapterNo?: number | null;
  },
): AsyncIterable<T> {
  for await (const ev of stream) {
    const e = ev as unknown as {
      type?: string;
      promptTokens?: number;
      completionTokens?: number;
      cachedTokens?: number;
      reasoningTokens?: number;
    };
    if (e?.type === "usage") {
      const prompt = e.promptTokens ?? 0;
      const completion = e.completionTokens ?? 0;
      const cached = e.cachedTokens ?? 0;
      const cost = deps.modelInfo
        ? computeUsageCost(deps.modelInfo, prompt, completion, cached)
        : 0;
      deps.tokenUsageRepo.record({
        taskType: deps.taskType,
        model: deps.modelInfo?.id ?? "unknown",
        promptTokens: prompt,
        completionTokens: completion,
        cachedTokens: cached,
        reasoningTokens: e.reasoningTokens ?? 0,
        costUsd: cost,
        chapterNo: deps.chapterNo ?? null,
      });
      deps.booksRepo.addCost(deps.bookId, cost);
    }
    yield ev;
  }
}
