import { randomUUID } from "node:crypto";
import type { StagedChange } from "./workflow-staging.js";

export interface ExecutorDeps {
  model: unknown;
  handle: {
    bookId: string;
    charactersRepo?: { list(): Array<{ name: string; id: string }> };
    outlineRepo?: { listAll(): Array<{ title: string }> };
  };
}

export interface TaskContract {
  intent: string;
  userInstruction: string;
  affectedEntities: string[];
  targetChapterNo?: number;
  chapterPlan?: string;
}

export interface ExecutionPlan {
  steps: StagedChange[];
  summary: string;
}

export async function runExecutor(
  deps: ExecutorDeps,
  task: TaskContract,
): Promise<ExecutionPlan> {
  if (task.intent === "query_only") {
    return { steps: [], summary: "查询操作,无需执行" };
  }

  const steps: StagedChange[] = [];
  const existingChars = new Set(
    (deps.handle.charactersRepo?.list() ?? []).map((c) => c.name),
  );

  for (const entity of task.affectedEntities) {
    if (!existingChars.has(entity)) {
      steps.push({
        id: randomUUID(),
        type: "character_upsert",
        payload: { name: entity, role: "supporting", baseData: {}, currentState: {} },
      });
    }
  }

  const summary = steps.length === 0
    ? "无需变更(实体已存在或已去重)"
    : `计划创建 ${steps.length} 个实体`;

  return { steps, summary };
}
