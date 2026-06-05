import type { ModelInfo, TaskType } from "@scribe/shared";

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
  const p = i.model.pricing;
  if (!p) return 0;
  const nonCachedPrompt = Math.max(0, i.promptTokens - i.cachedTokens);
  const inputCost = (nonCachedPrompt / 1e6) * p.input;
  const cachedCost = (i.cachedTokens / 1e6) * (p.cachedInput ?? p.input);
  const outputCost = (i.completionTokens / 1e6) * p.output;
  return inputCost + cachedCost + outputCost;
}
