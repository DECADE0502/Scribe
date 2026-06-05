import type { SseEvent } from "@scribe/shared";

export async function* runEcho(input: { message: string }): AsyncIterable<SseEvent> {
  const reply = `[echo] ${input.message}`;
  for (const ch of reply) {
    yield { type: "text_delta", delta: ch };
    await new Promise((r) => setTimeout(r, 5));
  }
  yield { type: "done" };
}
