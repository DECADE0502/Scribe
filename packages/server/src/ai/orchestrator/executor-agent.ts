import { randomUUID } from "node:crypto";
import type { AgentRunRequest } from "@scribe/shared";
import type { StagedChange } from "./workflow-staging.js";

export interface ExecutorDeps {
  model: unknown;
  handle: {
    bookId: string;
    charactersRepo?: { list(): Array<{ name: string; id: string }> };
    outlineRepo?: { listAll(): Array<{ title: string; sortOrder?: number }> };
  };
}

export type AssetChange =
  | {
    type: "character";
    name: string;
    role?: string;
    baseData?: Record<string, unknown>;
    currentState?: Record<string, unknown>;
  }
  | {
    type: "outline";
    title: string;
    level?: "volume" | "arc" | "chapter";
    summary?: string;
    parentId?: string | null;
    sortOrder?: number;
  }
  | {
    type: "worldbook";
    title: string;
    content: string;
    keys?: string[];
  };

export interface TaskContract {
  intent: string;
  userInstruction: string;
  affectedEntities: string[];
  assetChanges?: AssetChange[];
  targetChapterNo?: number;
  chapterTitle?: string;
  chapterPlan?: string;
  acceptanceCriteria?: string[];
  draft?: string;
  source?: AgentRunRequest["source"];
  target?: AgentRunRequest["target"];
  executionMode?: AgentRunRequest["executionMode"];
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
    return { steps: [], summary: "查询对话，无需执行工具变更" };
  }

  if (task.intent === "write_chapter") {
    return planChapterWrite(task);
  }

  if (task.intent === "update_character") {
    return planCharacterUpdate(deps, task);
  }

  if (task.intent === "update_outline") {
    return planOutlineUpdate(deps, task);
  }

  if (task.intent === "update_worldbook") {
    return planWorldbookUpdate(task);
  }

  if (task.intent === "asset_audit") {
    return planAssetAudit(task);
  }

  return {
    steps: [],
    summary: `不支持的意图: ${task.intent}`,
  };
}

function planChapterWrite(task: TaskContract): ExecutionPlan {
  const chapterNo = task.targetChapterNo ?? task.target?.chapterNo;
  const draft = task.draft?.trim();

  if (!chapterNo || chapterNo < 1) {
    return { steps: [], summary: "缺少目标章节编号，未执行写作" };
  }
  if (!draft) {
    return { steps: [], summary: "缺少正文草稿，未执行写作" };
  }

  return {
    steps: [
      {
        id: randomUUID(),
        type: "chapter_version",
        payload: {
          chapterNo,
          title: task.chapterTitle ?? `第 ${chapterNo} 章`,
          content: draft,
          plan: task.chapterPlan,
          acceptanceCriteria: task.acceptanceCriteria ?? [],
        },
      },
    ],
    summary: `计划写入第 ${chapterNo} 章章节正文`,
  };
}

function planCharacterUpdate(deps: ExecutorDeps, task: TaskContract): ExecutionPlan {
  const existingChars = new Set(
    (deps.handle.charactersRepo?.list() ?? []).map((c) => c.name),
  );
  const structured = task.assetChanges?.filter((change) => change.type === "character") ?? [];
  const steps: StagedChange[] = structured
    .filter((change) => change.name.trim())
    .map((change) => ({
      id: randomUUID(),
      type: "character_upsert",
      payload: {
        name: change.name.trim(),
        role: change.role ?? "supporting",
        baseData: change.baseData ?? {},
        currentState: change.currentState ?? {},
      },
    }));

  if (steps.length === 0) {
    for (const entity of uniqueNonEmpty(task.affectedEntities)) {
      if (!existingChars.has(entity)) {
        steps.push({
          id: randomUUID(),
          type: "character_upsert",
          payload: { name: entity, role: "supporting", baseData: {}, currentState: {} },
        });
      }
    }
  }

  const summary = steps.length === 0
    ? "无需变更，角色实体已存在或缺少可执行对象"
    : `计划创建或更新 ${steps.length} 个角色`;

  return { steps, summary };
}

function planOutlineUpdate(deps: ExecutorDeps, task: TaskContract): ExecutionPlan {
  const existingTitles = new Set(
    (deps.handle.outlineRepo?.listAll() ?? []).map((node) => node.title),
  );
  const baseSortOrder = deps.handle.outlineRepo?.listAll().length ?? 0;
  const structured = task.assetChanges?.filter((change) => change.type === "outline") ?? [];
  const steps = structured.length > 0
    ? structured
      .filter((change) => change.title.trim())
      .map<StagedChange>((change, index) => ({
        id: randomUUID(),
        type: "outline_upsert",
        sortOrder: index,
        payload: {
          parentId: change.parentId ?? null,
          level: change.level ?? "chapter",
          title: change.title.trim(),
          summary: change.summary ?? task.chapterPlan ?? task.userInstruction,
          status: "planned",
          sortOrder: change.sortOrder ?? baseSortOrder + index,
          metadata: null,
        },
      }))
    : uniqueNonEmpty(task.affectedEntities)
      .filter((title) => !existingTitles.has(title))
      .map<StagedChange>((title, index) => ({
        id: randomUUID(),
        type: "outline_upsert",
        sortOrder: index,
        payload: {
          parentId: null,
          level: "chapter",
          title,
          summary: task.chapterPlan ?? task.userInstruction,
          status: "planned",
          sortOrder: baseSortOrder + index,
          metadata: null,
        },
      }));

  if (steps.length === 0) {
    return { steps: [], summary: "缺少大纲节点名称，未执行大纲变更" };
  }

  return {
    steps,
    summary: `计划创建或更新 ${steps.length} 个大纲节点`,
  };
}

function planWorldbookUpdate(task: TaskContract): ExecutionPlan {
  const structured = task.assetChanges?.filter((change) => change.type === "worldbook") ?? [];
  const steps = structured.length > 0
    ? structured
      .filter((change) => change.title.trim() && change.content.trim())
      .map<StagedChange>((change, index) => worldbookStep(
        change.title.trim(),
        change.content.trim(),
        change.keys?.length ? change.keys : [change.title.trim()],
        index,
      ))
    : uniqueNonEmpty(task.affectedEntities)
      .map<StagedChange>((title, index) => worldbookStep(
        title,
        task.chapterPlan ?? task.userInstruction,
        [title],
        index,
      ));

  if (steps.length === 0) {
    return { steps: [], summary: "缺少世界书条目名称或内容，未执行世界书变更" };
  }

  return {
    steps,
    summary: `计划创建或更新 ${steps.length} 个世界书条目`,
  };
}

function worldbookStep(title: string, content: string, keys: string[], index: number): StagedChange {
  return {
    id: randomUUID(),
    type: "worldbook_upsert",
    sortOrder: index,
    payload: {
      title,
      content,
      keys,
      enabled: true,
      activation: "triggered",
      constant: false,
      priority: 0,
      insertionDepth: 0,
      recursive: false,
      recursionLimit: 0,
      metadata: { source: "agent_workflow" },
    },
  };
}

function planAssetAudit(task: TaskContract): ExecutionPlan {
  const assets = task.target?.auditScope?.assets?.length
    ? task.target.auditScope.assets
    : ["all"];
  const chapterNo = task.targetChapterNo ?? task.target?.chapterNo ?? 0;

  return {
    steps: [
      {
        id: randomUUID(),
        type: "chapter_audit",
        payload: {
          chapterNo,
          verdict: "ok",
          auditModel: "agent-workflow",
          auditedAt: Date.now(),
          issues: [
            {
              dimension: "active_asset_audit",
              severity: "ok",
              note: `已触发全量审查: ${assets.join(", ")}`,
            },
          ],
        },
      },
    ],
    summary: `计划记录主动审查结果: ${assets.join(", ")}`,
  };
}

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
