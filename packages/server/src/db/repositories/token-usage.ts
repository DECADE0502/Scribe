import type { Database } from "better-sqlite3";
import { type TaskType, type TokenUsageRecord } from "@scribe/shared";

export type RecordTokenUsageInput = Omit<TokenUsageRecord, "id" | "createdAt">;

export interface ChapterSum {
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
}

export interface TaskTypeSum {
  taskType: TaskType;
  costUsd: number;
}

export function createTokenUsageRepo(db: Database) {
  return {
    record(input: RecordTokenUsageInput): void {
      const now = Date.now();
      db.prepare(
        `INSERT INTO token_usage(task_type,model,prompt_tokens,completion_tokens,cached_tokens,reasoning_tokens,cost_usd,chapter_no,created_at)
                  VALUES(?,?,?,?,?,?,?,?,?)`
      ).run(
        input.taskType,
        input.model,
        input.promptTokens,
        input.completionTokens,
        input.cachedTokens,
        input.reasoningTokens,
        input.costUsd,
        input.chapterNo,
        now
      );
    },
    sumByChapter(chapterNo: number): ChapterSum {
      const r = db
        .prepare(
          `SELECT
              COALESCE(SUM(prompt_tokens), 0)     AS prompt_tokens,
              COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
              COALESCE(SUM(cost_usd), 0)          AS cost_usd
            FROM token_usage
            WHERE chapter_no=?`
        )
        .get(chapterNo) as
        | { prompt_tokens: number; completion_tokens: number; cost_usd: number }
        | undefined;
      return {
        promptTokens: r?.prompt_tokens ?? 0,
        completionTokens: r?.completion_tokens ?? 0,
        costUsd: r?.cost_usd ?? 0,
      };
    },
    sumByTaskType(): TaskTypeSum[] {
      const rows = db
        .prepare(
          `SELECT task_type, COALESCE(SUM(cost_usd), 0) AS cost_usd
             FROM token_usage
            GROUP BY task_type`
        )
        .all() as { task_type: TaskType; cost_usd: number }[];
      return rows.map((r) => ({ taskType: r.task_type, costUsd: r.cost_usd }));
    },
    totalCost(): number {
      const r = db
        .prepare("SELECT COALESCE(SUM(cost_usd), 0) AS total FROM token_usage")
        .get() as { total: number } | undefined;
      return r?.total ?? 0;
    },
    /** 按模型聚合(用量明细页) */
    sumByModel(): Array<{ model: string; costUsd: number; promptTokens: number; completionTokens: number }> {
      const rows = db
        .prepare(
          `SELECT model,
                  COALESCE(SUM(cost_usd), 0)          AS cost_usd,
                  COALESCE(SUM(prompt_tokens), 0)     AS prompt_tokens,
                  COALESCE(SUM(completion_tokens), 0) AS completion_tokens
             FROM token_usage
            GROUP BY model`
        )
        .all() as Array<{ model: string; cost_usd: number; prompt_tokens: number; completion_tokens: number }>;
      return rows.map(r => ({
        model: r.model, costUsd: r.cost_usd,
        promptTokens: r.prompt_tokens, completionTokens: r.completion_tokens,
      }));
    },
    /** 按章节聚合(含 NULL 章节,即对话等无章任务) */
    sumAllChapters(): Array<{ chapterNo: number | null; costUsd: number }> {
      const rows = db
        .prepare(
          `SELECT chapter_no, COALESCE(SUM(cost_usd), 0) AS cost_usd
             FROM token_usage
            GROUP BY chapter_no
            ORDER BY chapter_no`
        )
        .all() as Array<{ chapter_no: number | null; cost_usd: number }>;
      return rows.map(r => ({ chapterNo: r.chapter_no, costUsd: r.cost_usd }));
    },
    /** 最近 N 条明细 */
    listRecent(limit: number): TokenUsageRecord[] {
      const rows = db
        .prepare("SELECT * FROM token_usage ORDER BY created_at DESC, id DESC LIMIT ?")
        .all(limit) as Array<Record<string, unknown>>;
      return rows.map(r => ({
        id: Number(r.id),
        taskType: r.task_type as TaskType,
        model: String(r.model),
        promptTokens: Number(r.prompt_tokens),
        completionTokens: Number(r.completion_tokens),
        cachedTokens: Number(r.cached_tokens),
        reasoningTokens: Number(r.reasoning_tokens),
        costUsd: Number(r.cost_usd),
        chapterNo: r.chapter_no == null ? null : Number(r.chapter_no),
        createdAt: Number(r.created_at),
      }));
    },
    /** 最近 N 条 write 任务的平均 token(预算估算用) */
    recentWriteAverage(limit = 5): { promptTokens: number; completionTokens: number } | undefined {
      const r = db
        .prepare(
          `SELECT AVG(prompt_tokens) AS p, AVG(completion_tokens) AS c, COUNT(*) AS n
             FROM (SELECT prompt_tokens, completion_tokens FROM token_usage
                    WHERE task_type='write' ORDER BY created_at DESC LIMIT ?)`
        )
        .get(limit) as { p: number | null; c: number | null; n: number } | undefined;
      if (!r || r.n === 0) return undefined;
      return { promptTokens: Math.round(r.p ?? 0), completionTokens: Math.round(r.c ?? 0) };
    },

    /** 删 fromChapterNo 及之后所有章的成本记录，返回被删的总成本 */
    deleteFromChapter(fromChapterNo: number): number {
      const r = db
        .prepare("SELECT COALESCE(SUM(cost_usd), 0) AS total FROM token_usage WHERE chapter_no >= ?")
        .get(fromChapterNo) as { total: number } | undefined;
      const cost = r?.total ?? 0;
      db.prepare("DELETE FROM token_usage WHERE chapter_no >= ?").run(fromChapterNo);
      return cost;
    },
  };
}
