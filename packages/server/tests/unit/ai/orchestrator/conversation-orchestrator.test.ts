import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import type { ChapterSummary } from "@scribe/shared";
import { runMigrations } from "../../../../src/db/migrations/runner.js";
import { createBookMetaRepo } from "../../../../src/db/repositories/book-meta.js";
import { createCharactersRepo } from "../../../../src/db/repositories/characters.js";
import { createOutlineRepo } from "../../../../src/db/repositories/outline.js";
import { createForeshadowingRepo } from "../../../../src/db/repositories/foreshadowing.js";
import { createTimelineRepo } from "../../../../src/db/repositories/timeline.js";
import { createGenreSectionsRepo } from "../../../../src/db/repositories/genre-sections.js";
import { createChaptersRepo } from "../../../../src/db/repositories/chapters.js";
import { createConversationsRepo } from "../../../../src/db/repositories/conversations.js";
import { runConversation } from "../../../../src/ai/orchestrator/conversation-orchestrator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let db: any, handle: any, deps: any;

function summary(n: number, oneLiner: string, chars: string[]): ChapterSummary {
  return { chapterNo: n, oneLiner, paragraph: `第${n}章`, keyEvents: [{ event: oneLiner, characters: chars, foreshadowingRefs: [] }], generatedAt: 1, reasoningContent: null };
}

async function collect(it: AsyncIterable<any>): Promise<any[]> {
  const out: any[] = [];
  for await (const ev of it) out.push(ev);
  return out;
}
const textOf = (evs: any[]) => evs.filter(e => e.type === "text_delta").map(e => e.delta).join("");

beforeEach(() => {
  db = new Database(":memory:");
  const initSql = fs.readFileSync(path.join(__dirname, "../../../../src/db/migrations/workspace/001_init.sql"), "utf-8");
  runMigrations(db, [{ name: "001_init.sql", sql: initSql }]);
  const chaptersRepo = createChaptersRepo(db);
  const charactersRepo = createCharactersRepo(db);
  charactersRepo.create({ name: "林尘", role: "protagonist", baseData: {}, currentState: {} });
  for (let n = 1; n <= 5; n++) {
    chaptersRepo.saveVersion({ chapterNo: n, source: "ai_write", contentMd: `第${n}章正文` });
  }
  chaptersRepo.saveSummary(summary(1, "林尘觉醒", ["林尘"]));
  chaptersRepo.saveSummary(summary(2, "青玄登场", ["林尘"]));
  chaptersRepo.saveSummary(summary(3, "矿洞", ["林尘"]));
  chaptersRepo.saveSummary(summary(4, "夜查", ["林尘"]));
  chaptersRepo.saveSummary(summary(5, "出逃", ["林尘"]));
  handle = {
    bookId: "b1",
    bookMetaRepo: createBookMetaRepo(db),
    charactersRepo,
    outlineRepo: createOutlineRepo(db),
    foreshadowingRepo: createForeshadowingRepo(db),
    timelineRepo: createTimelineRepo(db),
    genreSectionsRepo: createGenreSectionsRepo(db),
    chaptersRepo,
    conversationsRepo: createConversationsRepo(db),
    chapterFiles: { read: () => undefined },
    rulesMdPath: "__none__.md",
  };
  deps = { handle, model: {} as any, auditModel: {} as any, auditModelId: "stub" };
});

afterEach(() => { try { db.close(); } catch {} });

describe("runConversation 斜杠命令路由(§7.4)", () => {
  it("/help 列出所有命令,先发 command_explicit 意图", async () => {
    const evs = await collect(runConversation(deps, { message: "/help" }));
    const intent = evs.find(e => e.type === "intent");
    expect(intent.category).toBe("command_explicit");
    expect(intent.command).toBe("help");
    expect(textOf(evs)).toContain("/write");
    expect(evs.at(-1).type).toBe("done");
  });

  it("/note 落库为便签", async () => {
    const evs = await collect(runConversation(deps, { message: "/note 记得给主角加个师父" }));
    expect(textOf(evs)).toContain("已记下便签");
    const notes = handle.conversationsRepo.listLatest(10).filter((m: any) => m.metadata?.kind === "note");
    expect(notes).toHaveLength(1);
    expect(notes[0].content).toContain("师父");
  });

  it("/recall 按关键词检索历史章节", async () => {
    const evs = await collect(runConversation(deps, { message: "/recall 林尘" }));
    const text = textOf(evs);
    expect(text).toContain("相关章节");
    expect(text).toMatch(/第1章|第2章/);
  });

  it("/revise 引导去编辑器选段", async () => {
    const evs = await collect(runConversation(deps, { message: "/revise" }));
    expect(textOf(evs)).toContain("编辑器");
  });
});
