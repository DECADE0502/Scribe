import { serve } from "@hono/node-server";
import { createApp } from "./http/server.js";

const port = Number(process.env.PORT ?? 6789);
serve({ fetch: createApp().fetch, port, hostname: "127.0.0.1" });
console.log(`scribe server listening at http://127.0.0.1:${port}`);
