import { serve } from "@hono/node-server";
import { resolveAppPaths } from "./config/paths.js";
import { createBookRegistry } from "./http/book-registry.js";
import { createApp } from "./http/server.js";

const paths = resolveAppPaths({ env: process.env });
const registry = createBookRegistry({ paths });

const port = Number(process.env.PORT ?? 6789);
const app = createApp({ bookRegistry: registry });

const server = serve({ fetch: app.fetch, port, hostname: "127.0.0.1" });
console.log(`scribe server listening at http://127.0.0.1:${port}`);

const cleanup = () => {
  console.log("\nshutting down...");
  registry.closeAll();
  server.close();
  process.exit(0);
};
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
