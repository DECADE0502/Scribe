import type { TaskContract } from "./executor-agent.js";

export interface MainAgentDeps {
  model: unknown;
}

export interface MainOutput {
  reply: string;
  draft?: string;
  taskContract: TaskContract;
}

export async function analyzeIntent(
  _deps: MainAgentDeps,
  message: string,
): Promise<MainOutput> {
  const m = message.trim();

  const writeMatch = m.match(/写\s*第?\s*(\d+)\s*章/);
  if (writeMatch?.[1]) {
    return {
      reply: `好的,开始写第 ${writeMatch[1]} 章。`,
      taskContract: {
        intent: "write_chapter",
        userInstruction: m,
        affectedEntities: [],
        targetChapterNo: parseInt(writeMatch[1], 10),
      },
    };
  }

  const charMatch = m.match(/创建角色\s*([^\s,，。]+)/);
  if (charMatch?.[1]) {
    return {
      reply: `好的,创建角色「${charMatch[1]}」。`,
      taskContract: {
        intent: "asset_update",
        userInstruction: m,
        affectedEntities: [charMatch[1]],
      },
    };
  }

  return {
    reply: "收到。",
    taskContract: {
      intent: "query_only",
      userInstruction: m,
      affectedEntities: [],
    },
  };
}
