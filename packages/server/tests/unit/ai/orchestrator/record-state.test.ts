import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { runMigrations } from "../../../../src/db/migrations/runner.js";
import { createCharactersRepo } from "../../../../src/db/repositories/characters.js";
import { createForeshadowingRepo } from "../../../../src/db/repositories/foreshadowing.js";
import { createGenreSectionsRepo } from "../../../../src/db/repositories/genre-sections.js";
import { createTimelineRepo } from "../../../../src/db/repositories/timeline.js";
import { buildArchiveSummary, recordChapterState } from "../../../../src/ai/orchestrator/record-state.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function createRepos() {
  const db = new Database(":memory:");
  const initSql = fs.readFileSync(
    path.join(__dirname, "../../../../src/db/migrations/workspace/001_init.sql"),
    "utf-8",
  );
  runMigrations(db, [{ name: "001_init.sql", sql: initSql }]);
  return {
    db,
    charactersRepo: createCharactersRepo(db),
    foreshadowingRepo: createForeshadowingRepo(db),
    genreSectionsRepo: createGenreSectionsRepo(db),
    timelineRepo: createTimelineRepo(db),
  };
}

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

describe("buildArchiveSummary", () => {
  it("按通用记录声明渲染 identity/display/search 和条目检索文本", () => {
    const summary = buildArchiveSummary({
      genreSections: [
        {
          section: {
            name: "任意集合",
            identityFields: ["代号"],
            displayFields: ["名称"],
            searchFields: ["代号", "名称", "摘要"],
            schema: [
              { name: "代号", type: "string", role: "identity", required: true },
              { name: "名称", type: "string", role: "label" },
              { name: "摘要", type: "text", role: "summary" },
            ],
          },
          items: [
            {
              data: {
                代号: "A-1",
                名称: "一号",
                摘要: "重要可检索信息",
              },
            },
          ],
        },
      ],
      characters: [],
      activeForeshadowing: [],
    });

    expect(summary).toContain("identity:代号");
    expect(summary).toContain("display:名称");
    expect(summary).toContain("search:代号,名称,摘要");
    expect(summary).toContain("A-1");
    expect(summary).toContain("一号");
    expect(summary).toContain("重要可检索信息");
  });
});

describe("recordChapterState", () => {
  it("does not run state tools when quality gate failed", async () => {
    const repos = createRepos();
    try {
      const archiveSummary = buildArchiveSummary({
        genreSections: [],
        characters: repos.charactersRepo.list(),
        activeForeshadowing: [],
      });

      const events = await consume(recordChapterState(
        {
          model: makeMultiTurnStub(() => {
            throw new Error("model should not be called when quality gate failed");
          }),
          stateDeps: {
            charactersRepo: repos.charactersRepo,
            foreshadowingRepo: repos.foreshadowingRepo,
            timelineRepo: repos.timelineRepo,
            chapterNo: 3,
          },
          genreDeps: {
            repo: repos.genreSectionsRepo,
            charactersRepo: repos.charactersRepo,
          },
        },
        {
          chapterNo: 3,
          chapterContent: "正文里有错误事实。",
          archiveSummary,
          qualityGateResult: {
            passed: false,
            blockingIssues: ["ship.fuel changed from 18 percent to 72 percent without an explicit in-chapter cause"],
          },
        },
      ));

      expect(events).toContainEqual(expect.objectContaining({
        type: "error",
        errorClass: "quality_gate_blocked_state_recording",
      }));
      expect(repos.timelineRepo.listAll()).toEqual([]);
    } finally {
      repos.db.close();
    }
  });

  it("有通用集合且首轮未写条目时,自动补一次记录落库", async () => {
    const repos = createRepos();
    try {
      repos.genreSectionsRepo.createSection({
        name: "航线档案",
        identityFields: ["name"],
        displayFields: ["name", "status"],
        searchFields: ["name", "status", "note"],
        schema: [
          { name: "name", type: "string", role: "identity", required: true, isLabel: true },
          { name: "status", type: "string", role: "status" },
          { name: "note", type: "text", role: "summary" },
        ],
        createdBy: "ai",
      });

      const model = makeMultiTurnStub((turn) => {
        if (turn === 0) {
          return [
            { type: "text-delta", textDelta: "已检查,无需记录。" },
            { type: "finish", finishReason: "stop", usage: { promptTokens: 20, completionTokens: 5 } },
          ];
        }
        if (turn === 1) {
          return [
            {
              type: "tool-call",
              toolCallType: "function",
              toolCallId: "tc1",
              toolName: "upsert_record_item",
              args: JSON.stringify({
                sectionName: "航线档案",
                data: {
                  name: "东向风纹",
                  status: "断裂",
                  note: "本章明确出现并影响航行的长期状态。",
                },
              }),
            },
            { type: "finish", finishReason: "tool-calls", usage: { promptTokens: 80, completionTokens: 20 } },
          ];
        }
        return [
          { type: "text-delta", textDelta: "已补记航线状态。" },
          { type: "finish", finishReason: "stop", usage: { promptTokens: 60, completionTokens: 8 } },
        ];
      });

      const archiveSummary = buildArchiveSummary({
        genreSections: repos.genreSectionsRepo.listSections().map((section) => ({
          section,
          items: repos.genreSectionsRepo.listItems(section.id),
        })),
        characters: [],
        activeForeshadowing: [],
      });

      const events = await consume(recordChapterState(
        {
          model,
          stateDeps: {
            charactersRepo: repos.charactersRepo,
            foreshadowingRepo: repos.foreshadowingRepo,
            timelineRepo: repos.timelineRepo,
            chapterNo: 1,
          },
          genreDeps: {
            repo: repos.genreSectionsRepo,
            charactersRepo: repos.charactersRepo,
          },
        },
        {
          chapterNo: 1,
          chapterContent: "阿澜抵达鸣鸥岛,发现东向风纹断裂,旧航线因此失效。",
          archiveSummary,
        },
      ));

      expect(events.some((e: any) => e.type === "tool_call_start" && e.toolName === "upsert_record_item")).toBe(true);
      const section = repos.genreSectionsRepo.getByName("航线档案");
      expect(section).toBeDefined();
      const items = repos.genreSectionsRepo.listItems(section!.id);
      expect(items).toHaveLength(1);
      const [item] = items;
      expect(item).toBeDefined();
      expect(item!.data.name).toBe("东向风纹");
    } finally {
      repos.db.close();
    }
  });
});
