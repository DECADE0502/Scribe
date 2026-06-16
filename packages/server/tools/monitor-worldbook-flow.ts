import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  createBookRegistry,
  type BookHandle,
} from "../src/http/book-registry.js";
import { createApp } from "../src/http/server.js";
import { buildChapterWriteMessages } from "../src/ai/context-builder/book-context.js";

function makePaths(root: string) {
  return {
    appRoot: root,
    libraryDb: path.posix.join(root, "library.db"),
    booksDir: path.posix.join(root, "books"),
    backupsDir: path.posix.join(root, "backups"),
    secretsEnv: path.posix.join(root, "secrets.env"),
    configJson: path.posix.join(root, "config.json"),
    bookDir: (id: string) => path.posix.join(root, "books", id),
    workspaceDb: (id: string) => path.posix.join(root, "books", id, "workspace.db"),
    chaptersDir: (id: string) => path.posix.join(root, "books", id, "chapters"),
    rulesMd: (id: string) => path.posix.join(root, "books", id, "rules.md"),
    exportsDir: (id: string) => path.posix.join(root, "books", id, "exports"),
    bookBackupsDir: (id: string) => path.posix.join(root, "backups", id),
  };
}

const scenarios = [
  {
    title: "Signal Glass",
    genre: "near-future mystery",
    query: "Repair the orbital signal relay and inspect the echo protocol.",
    entries: [
      {
        title: "Station contract",
        content: "The station is a sealed technical workplace with strict access logs.",
        activation: "constant" as const,
        constant: true,
        priority: 100,
      },
      {
        title: "Signal relay",
        content: "The relay can trigger echo protocol checks.",
        keys: ["signal relay"],
        priority: 80,
        recursive: true,
        recursionLimit: 1,
      },
      {
        title: "Echo protocol",
        content: "Echo protocol scenes must mention checksum drift.",
        keys: ["echo protocol"],
        priority: 60,
      },
    ],
    expected: ["Station contract", "Signal relay", "Echo protocol"],
    excluded: "contract breach penalty",
  },
  {
    title: "Launch Clause",
    genre: "legal workplace",
    query: "The product counsel reviews the contract breach risk before launch.",
    entries: [
      {
        title: "Legal realism",
        content: "No supernatural solutions; evidence and procedure drive decisions.",
        activation: "constant" as const,
        constant: true,
        priority: 100,
      },
      {
        title: "Contract breach",
        content: "A breach risk must cite obligation, evidence, and owner.",
        keys: ["contract breach"],
        priority: 80,
      },
      {
        title: "Irrelevant monastery",
        content: "This fantasy monastery must not enter the legal workplace prompt.",
        keys: ["monastery"],
        priority: 90,
      },
    ],
    expected: ["Legal realism", "Contract breach"],
    excluded: "fantasy monastery",
  },
  {
    title: "Island Cartographer",
    genre: "fantasy adventure",
    query: "A cartographer follows the seasonal route toward the relic map.",
    entries: [
      {
        title: "Map oath",
        content: "Maps are political documents, never neutral scenery.",
        activation: "constant" as const,
        constant: true,
        priority: 100,
      },
      {
        title: "Seasonal route",
        content: "Seasonal routes depend on wind debt and island customs.",
        keys: ["seasonal route"],
        priority: 80,
      },
      {
        title: "Relic map",
        content: "Relic maps change only when a real cost is paid.",
        keys: ["relic map"],
        priority: 70,
      },
    ],
    expected: ["Map oath", "Seasonal route", "Relic map"],
    excluded: "checksum drift",
  },
];

async function createBook(app: ReturnType<typeof createApp>, title: string, genre: string) {
  const res = await app.request("/api/books", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, genre }),
  });
  if (res.status !== 201) throw new Error(`create book failed: ${res.status}`);
  return (await res.json() as { id: string }).id;
}

function completeForAuto(handle: BookHandle) {
  handle.bookMetaRepo.set("premise", "A deterministic monitor premise.");
  handle.bookMetaRepo.set("tone", "focused");
  handle.charactersRepo.create({
    name: "Monitor Protagonist",
    role: "protagonist",
    baseData: {},
    currentState: {},
  });
  handle.outlineRepo.create({
    parentId: null,
    level: "volume",
    title: "Monitor Volume",
    summary: "A monitor outline.",
    status: "planned",
    sortOrder: 0,
    metadata: null,
  });
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scribe-worldbook-monitor-"));
  const paths = makePaths(root);
  fs.mkdirSync(paths.booksDir, { recursive: true });
  const registry = createBookRegistry({ paths });
  const app = createApp({ bookRegistry: registry });
  const reports = [];

  try {
    for (const scenario of scenarios) {
      const bookId = await createBook(app, scenario.title, scenario.genre);
      const handle = registry.open(bookId);
      completeForAuto(handle);
      for (const entry of scenario.entries) {
        handle.worldbookRepo.create({
          content: entry.content,
          title: entry.title,
          activation: entry.activation ?? "triggered",
          constant: entry.constant ?? false,
          keys: entry.keys ?? [],
          priority: entry.priority,
          recursive: entry.recursive ?? false,
          recursionLimit: entry.recursionLimit ?? 0,
        });
      }
      const preview = await app.request(`/api/books/${bookId}/worldbook/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: scenario.query }),
      });
      const previewJson = await preview.json() as {
        selected: Array<{ entry: { title: string } }>;
        rendered: string;
      };
      const writeContext = buildChapterWriteMessages(
        handle,
        1,
        scenario.query,
      );
      const promptText = writeContext.messages
        .map((message) => (typeof message.content === "string" ? message.content : ""))
        .join("\n");
      const selectedTitles = previewJson.selected.map((item) => item.entry.title);
      const missing = scenario.expected.filter(
        (title) => !selectedTitles.includes(title) || !promptText.includes(title),
      );
      const leaked = promptText.includes(scenario.excluded);
      reports.push({
        bookId,
        title: scenario.title,
        genre: scenario.genre,
        selectedTitles,
        hasWorldbookPrompt: promptText.includes("## Worldbook"),
        missing,
        leaked,
        passed: missing.length === 0 && !leaked,
      });
    }
  } finally {
    registry.closeAll();
  }

  const outDir = path.join(process.cwd(), "tmp");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(
    outDir,
    `worldbook-monitor-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  );
  const output = { generatedAt: new Date().toISOString(), root, reports };
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), "utf-8");
  console.log(JSON.stringify({ outPath, reports }, null, 2));
  if (reports.some((report) => !report.passed)) process.exit(2);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
