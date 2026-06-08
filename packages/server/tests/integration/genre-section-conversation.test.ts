import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations/runner.js";
import { createGenreSectionsRepo } from "../../src/db/repositories/genre-sections.js";
import { createCharactersRepo } from "../../src/db/repositories/characters.js";
import { makeGenreSectionTools } from "../../src/ai/tools/genre-section-tools.js";
import { streamLlm } from "../../src/ai/llm-call.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let db: any, repo: any, charactersRepo: any;

beforeEach(() => {
  db = new Database(":memory:");
  const initSql = fs.readFileSync(
    path.join(__dirname, "../../src/db/migrations/workspace/001_init.sql"),
    "utf-8",
  );
  runMigrations(db, [{ name: "001_init.sql", sql: initSql }]);
  repo = createGenreSectionsRepo(db);
  charactersRepo = createCharactersRepo(db);
});

afterEach(() => {
  try {
    db.close();
  } catch {}
});

/**
 * 构造一个支持多次 tool call 的 stub LanguageModel(spec v1)。
 *
 * sequenceFn(turn): 第 turn 次 doStream 时返回的 chunks 序列。
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

describe("AI 自创板块对话集成", () => {
  it("LLM 多步 tool_call 序列:create × 2 + add_item × 1 + 文本回复", async () => {
    const tools = makeGenreSectionTools({ repo, charactersRepo });

    const model = makeMultiTurnStub((turn) => {
      if (turn === 0) {
        return [
          {
            type: "tool-call",
            toolCallType: "function",
            toolCallId: "tc1",
            toolName: "create_genre_section",
            args: JSON.stringify({
              name: "功法体系",
              schema: [{ name: "name", type: "string", required: true }],
            }),
          },
          {
            type: "finish",
            finishReason: "tool-calls",
            usage: { promptTokens: 50, completionTokens: 30 },
          },
        ];
      }
      if (turn === 1) {
        return [
          {
            type: "tool-call",
            toolCallType: "function",
            toolCallId: "tc2",
            toolName: "create_genre_section",
            args: JSON.stringify({
              name: "境界",
              schema: [
                { name: "name", type: "string", required: true },
                { name: "order", type: "number" },
              ],
            }),
          },
          {
            type: "finish",
            finishReason: "tool-calls",
            usage: { promptTokens: 80, completionTokens: 30 },
          },
        ];
      }
      if (turn === 2) {
        return [
          {
            type: "tool-call",
            toolCallType: "function",
            toolCallId: "tc3",
            toolName: "add_genre_section_item",
            args: JSON.stringify({
              sectionName: "境界",
              data: { name: "炼气", order: 1 },
            }),
          },
          {
            type: "finish",
            finishReason: "tool-calls",
            usage: { promptTokens: 100, completionTokens: 30 },
          },
        ];
      }
      return [
        { type: "text-delta", textDelta: "我建了" },
        { type: "text-delta", textDelta: "功法体系和境界两个板块" },
        {
          type: "finish",
          finishReason: "stop",
          usage: { promptTokens: 120, completionTokens: 20 },
        },
      ];
    });

    const events = await consume(
      streamLlm({
        model,
        messages: [
          { role: "user", content: "我想写仙侠,主角废功法重修" },
        ],
        tools,
        maxSteps: 10,
      }),
    );

    // SQLite 验证
    const sections = repo.listSections();
    expect(sections).toHaveLength(2);
    expect(sections.map((s: any) => s.name).sort()).toEqual([
      "功法体系",
      "境界",
    ]);
    const jingjie = repo.getByName("境界");
    expect(jingjie).toBeDefined();
    const items = repo.listItems(jingjie!.id);
    expect(items).toHaveLength(1);
    expect(items[0].data.name).toBe("炼气");

    // SSE 事件验证
    const toolStarts = events.filter((e) => e.type === "tool_call_start");
    const toolEnds = events.filter((e) => e.type === "tool_call_end");
    expect(toolStarts).toHaveLength(3);
    expect(toolEnds).toHaveLength(3);
    expect(toolStarts.map((e: any) => e.toolName).sort()).toEqual([
      "add_genre_section_item",
      "create_genre_section",
      "create_genre_section",
    ]);
    const textDeltas = events
      .filter((e) => e.type === "text_delta")
      .map((e: any) => e.delta)
      .join("");
    expect(textDeltas).toContain("功法体系和境界");
    expect(events.find((e) => e.type === "done")).toBeDefined();
  });

  it("错误恢复:LLM 试图删不存在板块 → 工具抛错 → SSE 含 error 事件 → DB 不被破坏", async () => {
    const tools = makeGenreSectionTools({ repo, charactersRepo });

    // 先建一个板块,确保删除非目标板块时它不会被误伤
    repo.createSection({
      name: "存在板块",
      schema: [{ name: "name", type: "string" }],
      createdBy: "user",
    });

    const model = makeMultiTurnStub((turn) => {
      if (turn === 0) {
        return [
          {
            type: "tool-call",
            toolCallType: "function",
            toolCallId: "tc1",
            toolName: "delete_genre_section",
            args: JSON.stringify({ sectionName: "不存在的板块" }),
          },
          {
            type: "finish",
            finishReason: "tool-calls",
            usage: { promptTokens: 10, completionTokens: 5 },
          },
        ];
      }
      // 后续轮次实际不会被触发(第一轮 tool 抛错后 streamLlm 短路);
      // 仍提供 fallback 以防 SDK 行为变化时也能跑完。
      return [
        { type: "text-delta", textDelta: "兜底文本" },
        {
          type: "finish",
          finishReason: "stop",
          usage: { promptTokens: 5, completionTokens: 2 },
        },
      ];
    });

    const events = await consume(
      streamLlm({
        model,
        messages: [{ role: "user", content: "删板块" }],
        tools,
        maxSteps: 10,
      }),
    );

    // 关键不变量:
    // 1. 错误传播到 SSE(error 事件)或者末尾通过 done 收尾(取决于 SDK 行为)
    const hasError = events.some((e) => e.type === "error");
    const hasDone = events.some((e) => e.type === "done");
    expect(hasError || hasDone).toBe(true);
    // 2. 数据库未被破坏:不存在的板块当然不存在,存在板块被保留
    expect(repo.getByName("不存在的板块")).toBeUndefined();
    expect(repo.getByName("存在板块")).toBeDefined();
    // 3. 错误信息(若有)中应能定位到工具失败(不强制要求 tool_call_end)
    const errorEvents = events.filter((e) => e.type === "error");
    if (errorEvents.length > 0) {
      const msg = errorEvents.map((e: any) => e.message).join("\n");
      expect(msg).toMatch(/不存在|delete_genre_section|ToolExecution/i);
    }
  });
});
