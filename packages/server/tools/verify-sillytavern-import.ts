import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createBookRegistry } from "../src/http/book-registry.js";
import { createApp } from "../src/http/server.js";
import { buildWriteContext } from "../src/ai/context-builder/builder.js";
import { loadBookSnapshot } from "../src/ai/context-builder/snapshot.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const presetPath = process.argv[2] ?? path.join(repoRoot, "Izumi 0503.json");
const worldbookPath = process.argv[3] ?? findWorldbookPath(repoRoot);

function findWorldbookPath(root: string): string {
  for (const file of fs.readdirSync(root)) {
    if (!file.endsWith(".json") || file === "Izumi 0503.json") continue;
    const full = path.join(root, file);
    try {
      const parsed = JSON.parse(fs.readFileSync(full, "utf8")) as Record<string, unknown>;
      if (parsed.entries && typeof parsed.entries === "object") return full;
    } catch {
      // keep scanning
    }
  }
  throw new Error("Could not locate a SillyTavern worldbook JSON file");
}

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

async function importFile(
  app: ReturnType<typeof createApp>,
  bookId: string,
  file: string,
) {
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  const res = await app.request(`/api/books/${bookId}/imports`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: path.basename(file), json }),
  });
  if (res.status !== 201) {
    throw new Error(`${file} import failed: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<{
    sourceType: string;
    imported: {
      promptPresets: number;
      promptBlocks: number;
      worldbookEntries: number;
    };
  }>;
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scribe-sillytavern-verify-"));
  const paths = makePaths(root);
  fs.mkdirSync(paths.booksDir, { recursive: true });
  const registry = createBookRegistry({ paths });
  const app = createApp({ bookRegistry: registry });
  try {
    const create = await app.request("/api/books", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "SillyTavern Import Verification",
        genre: "verification",
      }),
    });
    const book = await create.json() as { id: string };
    const presetImport = await importFile(app, book.id, presetPath);
    const worldbookImport = await importFile(app, book.id, worldbookPath);
    const handle = registry.open(book.id);
    const presets = handle.promptPresetsRepo.listPresets();
    const blocks = presets.flatMap((preset) =>
      handle.promptPresetsRepo.listBlocks(preset.id),
    );
    const worldbook = handle.worldbookRepo.list();
    const snapshot = loadBookSnapshot(book.id, {
      charactersRepo: handle.charactersRepo,
      outlineRepo: handle.outlineRepo,
      foreshadowingRepo: handle.foreshadowingRepo,
      chaptersRepo: handle.chaptersRepo,
      genreSectionsRepo: handle.genreSectionsRepo,
      worldbookRepo: handle.worldbookRepo,
      promptPresetsRepo: handle.promptPresetsRepo,
      readerIssuesRepo: handle.readerIssuesRepo,
      bookMetaRepo: handle.bookMetaRepo,
    }, { rulesMd: handle.rulesMdPath });
    handle.readerIssuesRepo.create({
      chapterNo: 1,
      type: "continuity",
      severity: "warning",
      note: "Verification reader issue must affect the next writing context.",
      evidence: "The previous chapter raised it.",
      suggestedAction: "Resolve it in the next chapter.",
      status: "open",
    });
    const snapshotWithIssue = loadBookSnapshot(book.id, {
      charactersRepo: handle.charactersRepo,
      outlineRepo: handle.outlineRepo,
      foreshadowingRepo: handle.foreshadowingRepo,
      chaptersRepo: handle.chaptersRepo,
      genreSectionsRepo: handle.genreSectionsRepo,
      worldbookRepo: handle.worldbookRepo,
      promptPresetsRepo: handle.promptPresetsRepo,
      readerIssuesRepo: handle.readerIssuesRepo,
      bookMetaRepo: handle.bookMetaRepo,
    }, { rulesMd: handle.rulesMdPath });
    const context = buildWriteContext({
      snapshot: snapshotWithIssue,
      currentChapterNo: 2,
      intent: {
        characters: [],
        foreshadowing: [],
        records: [],
        userMessage: "Write a chapter involving capture, the system, heaven, and status bar.",
      },
    });
    const joined = context.messages.map((message) => String(message.content)).join("\n");
    const diagnostics = context.diagnostics ?? {
      promptPresetBlockIds: [],
      promptRegexScriptsApplied: [],
      worldbookEntryIds: [],
      readerIssueIds: [],
    };
    const output = {
      bookId: book.id,
      imports: {
        preset: {
          sourceType: presetImport.sourceType,
          imported: presetImport.imported,
        },
        worldbook: {
          sourceType: worldbookImport.sourceType,
          imported: worldbookImport.imported,
        },
      },
      presetCount: presets.length,
      promptBlockCount: blocks.length,
      enabledPromptBlockCount: blocks.filter((block) => block.enabled && block.stackIndex !== null).length,
      regexScriptCount: presets.reduce((sum, preset) => {
        const scripts = preset.extensions.regex_scripts;
        return sum + (Array.isArray(scripts) ? scripts.length : 0);
      }, 0),
      worldbookEntryCount: worldbook.length,
      importedWorldbookEntryCount: worldbook.filter((entry) => entry.metadata.sourceImportId).length,
      constantWorldbookCount: worldbook.filter((entry) => entry.constant && entry.metadata.sourceImportId).length,
      snapshotPromptBlocks: snapshot.promptBlocks.length,
      snapshotWorldbookEntries: snapshot.worldbookEntries.length,
      contextPresetBlockCount: diagnostics.promptPresetBlockIds.length,
      contextRegexScriptsApplied: diagnostics.promptRegexScriptsApplied,
      contextWorldbookEntryIds: diagnostics.worldbookEntryIds,
      contextReaderIssueIds: diagnostics.readerIssueIds,
      hasPresetContext: diagnostics.promptPresetBlockIds.length > 0,
      regexScriptsApplied: diagnostics.promptRegexScriptsApplied.length > 0,
      hasWorldbookContext: joined.includes("## Worldbook"),
      worldbookTriggered: diagnostics.worldbookEntryIds.length > 0,
      hasReaderIssueContext: joined.includes("Verification reader issue"),
      messageCount: context.messages.length,
    };
    console.log(JSON.stringify(output, null, 2));

    if (output.promptBlockCount < 200) throw new Error("Preset prompt blocks were not fully imported");
    if (output.enabledPromptBlockCount < 50) throw new Error("Enabled preset stack was not preserved");
    if (output.importedWorldbookEntryCount !== 38) throw new Error("Worldbook entries were not fully imported");
    if (output.constantWorldbookCount !== 7) throw new Error("Constant worldbook entries were not preserved");
    if (!output.hasPresetContext) throw new Error("Preset blocks did not enter writing context");
    if (!output.regexScriptsApplied) throw new Error("Preset regex scripts did not run in writing context");
    if (!output.hasWorldbookContext) throw new Error("Worldbook did not enter writing context");
    if (!output.worldbookTriggered) throw new Error("No worldbook entries were selected for writing context");
    if (!output.hasReaderIssueContext) throw new Error("Reader issues did not enter writing context");
    if (output.contextReaderIssueIds.length === 0) throw new Error("Reader issue diagnostics were not recorded");
  } finally {
    registry.closeAll();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
