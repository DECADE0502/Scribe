import type { SseEvent } from "@scribe/shared";
import type { TaskContext, TaskDef } from "./types.js";

export async function* dispatchTask(
  task: TaskDef,
  ctx: TaskContext,
): AsyncIterable<SseEvent> {
  let text = "";
  try {
    for await (const ev of task.stream(ctx)) {
      if (ev.type === "text_delta") {
        text += ev.delta;
        yield { type: "text_delta", delta: ev.delta };
      }
    }
  } catch (err) {
    yield { type: "error", errorClass: "stream_failed", message: err instanceof Error ? err.message : String(err) };
    return;
  }

  let parsed: unknown;
  try {
    parsed = await task.parse(ctx, text);
  } catch (err) {
    yield { type: "error", errorClass: "parse_failed", message: err instanceof Error ? err.message : String(err) };
    return;
  }

  try {
    task.apply(ctx, parsed);
    yield { type: "done", committed: task.mutates };
  } catch (err) {
    yield { type: "error", errorClass: "apply_failed", message: err instanceof Error ? err.message : String(err) };
  }
}
