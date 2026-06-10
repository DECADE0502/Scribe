import { streamSse } from "./client.js";

export interface SseStreamHandle {
  cancel(): void;
  done: Promise<void>;
}

export interface StartStreamOptions {
  url: string;
  body?: unknown;
  onEvent: (event: { type: string; [key: string]: unknown }) => void;
}

/**
 * 启动一个可取消的 SSE 流。
 * cancel() 会 abort fetch,流自然终止(onEvent 不会再被调)。
 */
export function startSseStream(opts: StartStreamOptions): SseStreamHandle {
  const controller = new AbortController();
  let cancelled = false;
  const done = streamSse({
    url: opts.url,
    body: opts.body,
    signal: controller.signal,
    onEvent: (ev) => {
      if (!cancelled) opts.onEvent(ev);
    },
  }).catch(() => {
    // abort 时 fetch 会 reject,静默吞掉
  });
  return {
    cancel() {
      cancelled = true;
      controller.abort();
    },
    done,
  };
}
