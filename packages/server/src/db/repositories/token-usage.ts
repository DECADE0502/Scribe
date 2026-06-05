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
  };
}
