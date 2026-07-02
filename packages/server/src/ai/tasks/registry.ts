import type { AgentRunRequest } from "@scribe/shared";
import type { TaskDef } from "./types.js";
import { writeChapterTask } from "./write-chapter.js";
import { reviseTask } from "./revise.js";
import { onboardTask } from "./onboard.js";
import { chatTask } from "./chat.js";
import { auditTask } from "./audit.js";

export function resolveTask(request: AgentRunRequest): TaskDef<any> {
  switch (request.source) {
    case "editor": return writeChapterTask;
    case "revision": return reviseTask;
    case "onboard": return onboardTask;
    // audit 用 stream→parse 闭包状态传递结果;并发请求共享单例会互相覆写,
    // 因此每次解析都造新实例(见 Task 7 review)
    case "asset_audit": return auditTask.withDeps({});
    case "chat":
    case "auto":
    default: return chatTask;
  }
}
