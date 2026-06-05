export interface SnapshotSchedulerOptions {
  /** 周期触发间隔。默认 6 小时。 */
  intervalMs?: number;
  /** 累计提交多少章触发一次额外快照。默认 5。 */
  chaptersThreshold?: number;
  /** 真正执行快照的回调。 */
  doSnapshot: (bookId: string) => Promise<void>;
}

export interface SnapshotScheduler {
  start(activeBooks: () => string[]): void;
  stop(): void;
  onChapterCommitted(bookId: string): void;
}

export function createSnapshotScheduler(
  opts: SnapshotSchedulerOptions,
): SnapshotScheduler {
  const interval = opts.intervalMs ?? 6 * 3600 * 1000;
  const threshold = opts.chaptersThreshold ?? 5;
  const counters = new Map<string, number>();
  let timer: ReturnType<typeof setInterval> | undefined;

  return {
    start(activeBooks: () => string[]) {
      timer = setInterval(() => {
        for (const id of activeBooks()) void opts.doSnapshot(id);
      }, interval);
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
    },
    onChapterCommitted(bookId: string) {
      const next = (counters.get(bookId) ?? 0) + 1;
      if (next >= threshold) {
        counters.set(bookId, 0);
        void opts.doSnapshot(bookId);
      } else {
        counters.set(bookId, next);
      }
    },
  };
}
