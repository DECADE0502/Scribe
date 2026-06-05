import type { SseEvent } from "@scribe/shared";

export function streamSseResponse(events: AsyncIterable<SseEvent>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      try {
        for await (const ev of events) {
          ctrl.enqueue(encoder.encode(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`));
          if (ev.type === "done" || ev.type === "error") break;
        }
      } catch (e) {
        const ev = {
          type: "error",
          errorClass: "unknown",
          message: String((e as Error).message),
        };
        ctrl.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify(ev)}\n\n`));
      } finally {
        ctrl.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
