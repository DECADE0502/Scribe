import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations/runner.js";
import { createBookMetaRepo } from "../../src/db/repositories/book-meta.js";
import { createCharactersRepo } from "../../src/db/repositories/characters.js";
import { createOutlineRepo } from "../../src/db/repositories/outline.js";
import { createGenreSectionsRepo } from "../../src/db/repositories/genre-sections.js";
import { createForeshadowingRepo } from "../../src/db/repositories/foreshadowing.js";
import { createChaptersRepo } from "../../src/db/repositories/chapters.js";
import { runNewBookConversation } from "../../src/ai/orchestrator/new-book.js";
import { loadBookSnapshot } from "../../src/ai/context-builder/snapshot.js";
import { isOnboardComplete } from "../../src/ai/orchestrator/onboard-completeness.js";
import { NEW_BOOK_ONBOARD_PROMPT } from "../../src/ai/prompts/new-book-onboard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let tmp: string;
let db: any;
let deps: any;
let snapshotDeps: any;
let paths: any;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scribe-nb-"));
  db = new Database(":memory:");
  const initSql = fs.readFileSync(
    path.join(__dirname, "../../src/db/migrations/workspace/001_init.sql"),
    "utf-8",
  );
  runMigrations(db, [{ name: "001_init.sql", sql: initSql }]);
  paths = { rulesMd: path.join(tmp, "rules.md") };
  const bookMetaRepo = createBookMetaRepo(db);
  const charactersRepo = createCharactersRepo(db);
  const outlineRepo = createOutlineRepo(db);
  const genreSectionsRepo = createGenreSectionsRepo(db);
  const foreshadowingRepo = createForeshadowingRepo(db);
  const chaptersRepo = createChaptersRepo(db);
  deps = {
    bookMetaToolsDeps: {
      bookMetaRepo,
      charactersRepo,
      outlineRepo,
      rulesMdPath: paths.rulesMd,
    },
    genreToolsDeps: { repo: genreSectionsRepo, charactersRepo },
  };
  snapshotDeps = {
    charactersRepo,
    outlineRepo,
    foreshadowingRepo,
    chaptersRepo,
    genreSectionsRepo,
    bookMetaRepo,
  };
});

afterEach(() => {
  try {
    db.close();
  } catch {}
  fs.rmSync(tmp, { recursive: true, force: true });
});

/**
 * 多轮 stub LanguageModel:每次 doStream 返回 sequenceFn(turn) 给的 chunks。
 * args 字段必须是 stringified JSON,与 LanguageModelV1FunctionToolCall 一致。
 */
function makeMultiTurnStub(sequenceFn: (turn: number) => any[]): any {
  let turn = 0;
  return {
    specificationVersion: "v1",
    provider: "stub",
    modelId: "stub-multi",
    defaultObjectGenerationMode: "json",
    async doGenerate() {
      throw new Error("not used");
    },
    async doStream() {
      const chunks = sequenceFn(turn);
      turn++;
      return {
        stream: new ReadableStream({
          start(ctrl) {
            for (const c of chunks) ctrl.enqueue(c);
            ctrl.close();
          },
        }),
        rawCall: { rawPrompt: null, rawSettings: {} },
      };
    },
  };
}

async function consume<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of iter) out.push(v);
  return out;
}

describe("新建书完整流程集成测试", () => {
  it("onboard prompt 要求 AI 自主建模通用记录,不依赖题材清单", () => {
    expect(NEW_BOOK_ONBOARD_PROMPT).toContain("长期保持一致");
    expect(NEW_BOOK_ONBOARD_PROMPT).toContain("create_record_collection");
    expect(NEW_BOOK_ONBOARD_PROMPT).toContain("update_record_collection_schema");
    expect(NEW_BOOK_ONBOARD_PROMPT).toContain("upsert_record_item");
    expect(NEW_BOOK_ONBOARD_PROMPT).toContain("identityFields");
    expect(NEW_BOOK_ONBOARD_PROMPT).toContain("displayFields");
    expect(NEW_BOOK_ONBOARD_PROMPT).toContain("searchFields");
    expect(NEW_BOOK_ONBOARD_PROMPT).not.toContain("create_genre_section");
    expect(NEW_BOOK_ONBOARD_PROMPT).not.toContain("修仙/玄幻 →");
    expect(NEW_BOOK_ONBOARD_PROMPT).not.toContain("都市/异能 →");
  });

  it("三轮对话后基础设定齐全,isOnboardComplete=true", async () => {
    // 轮 1:set_book_meta(genre, premise) + create_record_collection x 3 → 文本
    const turn1Model = makeMultiTurnStub((t) => {
      if (t === 0)
        return [
          {
            type: "tool-call",
            toolCallType: "function",
            toolCallId: "t1a",
            toolName: "set_book_meta",
            args: JSON.stringify({
              genre: "仙侠",
              premise: "被废功法的弃婴重修崛起",
            }),
          },
          {
            type: "finish",
            finishReason: "tool-calls",
            usage: { promptTokens: 50, completionTokens: 10 },
          },
        ];
      if (t === 1)
        return [
          {
            type: "tool-call",
            toolCallType: "function",
            toolCallId: "t1b",
            toolName: "create_record_collection",
            args: JSON.stringify({
              name: "长期对象A",
              identityFields: ["name"],
              displayFields: ["name"],
              searchFields: ["name"],
              schema: [{ name: "name", type: "string", required: true, role: "identity" }],
            }),
          },
          {
            type: "finish",
            finishReason: "tool-calls",
            usage: { promptTokens: 70, completionTokens: 10 },
          },
        ];
      if (t === 2)
        return [
          {
            type: "tool-call",
            toolCallType: "function",
            toolCallId: "t1c",
            toolName: "create_record_collection",
            args: JSON.stringify({
              name: "长期对象B",
              identityFields: ["name"],
              displayFields: ["name"],
              searchFields: ["name"],
              schema: [{ name: "name", type: "string", required: true, role: "identity" }],
            }),
          },
          {
            type: "finish",
            finishReason: "tool-calls",
            usage: { promptTokens: 90, completionTokens: 10 },
          },
        ];
      if (t === 3)
        return [
          {
            type: "tool-call",
            toolCallType: "function",
            toolCallId: "t1d",
            toolName: "create_record_collection",
            args: JSON.stringify({
              name: "长期对象C",
              identityFields: ["name"],
              displayFields: ["name"],
              searchFields: ["name"],
              schema: [{ name: "name", type: "string", required: true, role: "identity" }],
            }),
          },
          {
            type: "finish",
            finishReason: "tool-calls",
            usage: { promptTokens: 110, completionTokens: 10 },
          },
        ];
      return [
        { type: "text-delta", textDelta: "题材是仙侠对吧?主角叫什么?" },
        {
          type: "finish",
          finishReason: "stop",
          usage: { promptTokens: 130, completionTokens: 15 },
        },
      ];
    });
    await consume(
      runNewBookConversation(
        { model: turn1Model, toolDeps: deps, maxSteps: 10 },
        { message: "我想写个仙侠的,主角是被废功法的弃婴重修崛起。" },
      ),
    );

    // 轮 2:create_character + set_book_meta(tone) → 文本
    const turn2Model = makeMultiTurnStub((t) => {
      if (t === 0)
        return [
          {
            type: "tool-call",
            toolCallType: "function",
            toolCallId: "t2a",
            toolName: "create_character",
            args: JSON.stringify({
              name: "林尘",
              role: "protagonist",
              background: "弃婴",
              motivation: "复仇",
            }),
          },
          {
            type: "finish",
            finishReason: "tool-calls",
            usage: { promptTokens: 50, completionTokens: 10 },
          },
        ];
      if (t === 1)
        return [
          {
            type: "tool-call",
            toolCallType: "function",
            toolCallId: "t2b",
            toolName: "set_book_meta",
            args: JSON.stringify({ tone: "清冷" }),
          },
          {
            type: "finish",
            finishReason: "tool-calls",
            usage: { promptTokens: 70, completionTokens: 10 },
          },
        ];
      return [
        { type: "text-delta", textDelta: "卷一从他重修开始,讲到第一次复仇可以吗?" },
        {
          type: "finish",
          finishReason: "stop",
          usage: { promptTokens: 90, completionTokens: 15 },
        },
      ];
    });
    await consume(
      runNewBookConversation(
        { model: turn2Model, toolDeps: deps, maxSteps: 10 },
        {
          message: "叫林尘,清冷克制点。",
          history: [
            {
              role: "user",
              content: "我想写个仙侠的,主角是被废功法的弃婴重修崛起。",
            },
            { role: "assistant", content: "题材是仙侠对吧?主角叫什么?" },
          ],
        },
      ),
    );

    // 轮 3:create_outline_node → 文本(收尾信号)
    const turn3Model = makeMultiTurnStub((t) => {
      if (t === 0)
        return [
          {
            type: "tool-call",
            toolCallType: "function",
            toolCallId: "t3a",
            toolName: "create_outline_node",
            args: JSON.stringify({
              level: "volume",
              title: "卷一:重生",
              summary: "林尘重修崛起到第一次复仇",
            }),
          },
          {
            type: "finish",
            finishReason: "tool-calls",
            usage: { promptTokens: 50, completionTokens: 10 },
          },
        ];
      return [
        {
          type: "text-delta",
          textDelta: "基础设定好了,要不要现在开始写第一章?",
        },
        {
          type: "finish",
          finishReason: "stop",
          usage: { promptTokens: 70, completionTokens: 15 },
        },
      ];
    });
    await consume(
      runNewBookConversation(
        { model: turn3Model, toolDeps: deps, maxSteps: 10 },
        {
          message: "可以。",
          history: [
            {
              role: "user",
              content: "我想写个仙侠的,主角是被废功法的弃婴重修崛起。",
            },
            { role: "assistant", content: "题材是仙侠对吧?主角叫什么?" },
            { role: "user", content: "叫林尘,清冷克制点。" },
            {
              role: "assistant",
              content: "卷一从他重修开始,讲到第一次复仇可以吗?",
            },
          ],
        },
      ),
    );

    // 断言 SQLite 状态
    expect(snapshotDeps.bookMetaRepo.get("genre")).toBe("仙侠");
    expect(snapshotDeps.bookMetaRepo.get("premise")).toBe(
      "被废功法的弃婴重修崛起",
    );
    expect(snapshotDeps.bookMetaRepo.get("tone")).toBe("清冷");
    expect(
      snapshotDeps.charactersRepo
        .list()
        .some((c: any) => c.name === "林尘" && c.role === "protagonist"),
    ).toBe(true);
    expect(
      snapshotDeps.outlineRepo
        .listAll()
        .some((n: any) => n.level === "volume" && n.title === "卷一:重生"),
    ).toBe(true);
    expect(snapshotDeps.genreSectionsRepo.listSections()).toHaveLength(3);

    // isOnboardComplete=true
    const snap = loadBookSnapshot("b1", snapshotDeps, paths);
    const completeness = isOnboardComplete(snap);
    expect(completeness.ok).toBe(true);
    expect(completeness.missing).toHaveLength(0);
  });

  it("跳过流程:isOnboardComplete=false 但工作台仍可进入", async () => {
    // 用户不走对话,直接跳过。snapshot 是初始状态:meta 全空
    const snap = loadBookSnapshot("b1", snapshotDeps, paths);
    const r = isOnboardComplete(snap);
    expect(r.ok).toBe(false);
    expect(r.missing.length).toBeGreaterThan(0);
    // 但仍能 load(确认 loadBookSnapshot 不依赖 onboard 完成)
    expect(snap.bookId).toBe("b1");
    expect(snap.characters).toEqual([]);
  });
});
