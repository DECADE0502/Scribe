import type { ErrorClass } from "@scribe/shared";

export interface RetryOpts {
  classify: (e: unknown) => ErrorClass;
  sleepImpl?: (ms: number) => Promise<void>;
  onAttempt?: (n: number, cls: ErrorClass) => void;
}

const POLICY: Record<ErrorClass, { maxRetries: number; backoff: (n: number) => number }> = {
  rate_limit: { maxRetries: 3, backoff: (n) => 1000 * 2 ** (n - 1) },
  timeout: { maxRetries: 1, backoff: () => 0 },
  stream_idle: { maxRetries: 1, backoff: () => 0 },
  auth: { maxRetries: 0, backoff: () => 0 },
  context_overflow: { maxRetries: 1, backoff: () => 0 },
  unknown: { maxRetries: 0, backoff: () => 0 },
};

export async function withRetry<T>(op: () => Promise<T>, opts: RetryOpts): Promise<T> {
  const sleep = opts.sleepImpl ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let attempt = 0;
  while (true) {
    try {
      return await op();
    } catch (e) {
      const cls = opts.classify(e);
      const policy = POLICY[cls];
      if (attempt >= policy.maxRetries) throw e;
      attempt += 1;
      opts.onAttempt?.(attempt, cls);
      await sleep(policy.backoff(attempt));
    }
  }
}
