import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { runMigrations } from "../../../../src/db/migrations/runner.js";
import { createCharactersRepo } from "../../../../src/db/repositories/characters.js";
import { createForeshadowingRepo } from "../../../../src/db/repositories/foreshadowing.js";
import { createTimelineRepo } from "../../../../src/db/repositories/timeline.js";
import { makeStateTools } from "../../../../src/ai/tools/state-tools.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let db: any, charactersRepo: any, foreshadowingRepo: any, timelineRepo: any, tools: any;

beforeEach(() => {
  db = new Database(":memory:");
  const initSql = fs.readFileSync(
    path.join(__dirname, "../../../../src/db/migrations/workspace/001_init.sql"),
    "utf-8",
  );
  runMigrations(db, [{ name: "001_init.sql", sql: initSql }]);
  charactersRepo = createCharactersRepo(db);
  foreshadowingRepo = createForeshadowingRepo(db);
  timelineRepo = createTimelineRepo(db);
  charactersRepo.create({ name: "林尘", role: "protagonist", baseData: {}, currentState: { 位置: "云岚宗" } });
  tools = makeStateTools({ charactersRepo, foreshadowingRepo, timelineRepo, chapterNo: 5 });
});

afterEach(() => {
  try { db.close(); } catch {}
});

async function exec(toolName: string, args: any): Promise<any> {
  const t = tools[toolName];
  const parsed = t.parameters.parse(args);
  return await t.execute(parsed, { toolCallId: "test", messages: [] } as any);
}

describe("update_character_state", () => {
  it("happy:merge 到现有状态", async () => {
    const r = await exec("update_character_state", { name: "林尘", state: { 修为: "练气一层" } });
    expect(r.state.位置).toBe("云岚宗"); // 原字段保留
    expect(r.state.修为).toBe("练气一层");
    expect(charactersRepo.list()[0].currentState.修为).toBe("练气一层");
  });

  it("容错:state 若是 JSON 字符串,解析后 merge", async () => {
    const r = await exec("update_character_state", {
      name: "林尘",
      state: "{\"位置\":\"外门\",\"持有物\":[\"木剑\"]}",
    });

    expect(r.state.位置).toBe("外门");
    expect(r.state.持有物).toEqual(["木剑"]);
  });

  it("error:角色不存在", async () => {
    await expect(exec("update_character_state", { name: "幽灵", state: {} })).rejects.toThrow(/不存在/);
  });
});

describe("create_character(章末记录新角色)", () => {
  it("happy:创建本章新出现的配角", async () => {
    const r = await exec("create_character", { name: "沈姐", role: "supporting", background: "观测局引路人" });
    expect(r.created).toBe("沈姐");
    const names = charactersRepo.list().map((c: any) => c.name);
    expect(names).toContain("沈姐");
    // 创建后可直接记录其状态/出场
    await exec("add_character_appearance", { name: "沈姐", brief: "在 B3 层掩护陈默" });
    const shen = charactersRepo.list().find((c: any) => c.name === "沈姐");
    expect(shen.appearances).toHaveLength(1);
  });

  it("去重:已存在角色不重复创建", async () => {
    const r = await exec("create_character", { name: "林尘", role: "protagonist" });
    expect(r.skipped).toBeTruthy();
    expect(charactersRepo.list().filter((c: any) => c.name === "林尘")).toHaveLength(1);
  });
});

describe("add_character_appearance", () => {
  it("happy:写入 appearances 带当前章号", async () => {
    await exec("add_character_appearance", { name: "林尘", brief: "觉醒剑灵" });
    const c = charactersRepo.list()[0];
    expect(c.appearances).toHaveLength(1);
    expect(c.appearances[0].chapterNo).toBe(5);
    expect(c.appearances[0].brief).toBe("觉醒剑灵");
  });
});

describe("add_foreshadowing / pay_foreshadowing", () => {
  it("happy:登记伏笔为 active + plantedChapter", async () => {
    await exec("add_foreshadowing", { label: "黑剑来历", description: "断剑戮" });
    const list = foreshadowingRepo.list("active");
    expect(list).toHaveLength(1);
    expect(list[0].label).toBe("黑剑来历");
  });

  it("去重:同名伏笔不重复登记", async () => {
    await exec("add_foreshadowing", { label: "黑剑来历" });
    const r = await exec("add_foreshadowing", { label: "黑剑来历" });
    expect(r.skipped).toBeTruthy();
    expect(foreshadowingRepo.list()).toHaveLength(1);
  });

  it("pay:回收已存在伏笔", async () => {
    await exec("add_foreshadowing", { label: "黑剑来历" });
    const r = await exec("pay_foreshadowing", { label: "黑剑来历" });
    expect(r.paid).toBe("黑剑来历");
    expect(foreshadowingRepo.list("active")).toHaveLength(0);
    expect(foreshadowingRepo.list("paid")).toHaveLength(1);
  });

  it("pay:活跃伏笔不存在抛错", async () => {
    await expect(exec("pay_foreshadowing", { label: "不存在" })).rejects.toThrow(/不存在/);
  });
});

describe("add_timeline_event", () => {
  it("happy:写入时间线带当前章号", async () => {
    await exec("add_timeline_event", { storyTime: "当夜", event: "出逃", participants: ["林尘"] });
    const all = timelineRepo.listAll();
    expect(all).toHaveLength(1);
    expect(all[0].chapterNo).toBe(5);
    expect(all[0].event).toBe("出逃");
  });
});
