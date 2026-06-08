import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { runMigrations } from "../../../../src/db/migrations/runner.js";
import { createGenreSectionsRepo } from "../../../../src/db/repositories/genre-sections.js";
import { createCharactersRepo } from "../../../../src/db/repositories/characters.js";
import { makeGenreSectionTools } from "../../../../src/ai/tools/genre-section-tools.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let db: any, repo: any, charactersRepo: any, tools: any;

beforeEach(() => {
  db = new Database(":memory:");
  const initSql = fs.readFileSync(
    path.join(
      __dirname,
      "../../../../src/db/migrations/workspace/001_init.sql",
    ),
    "utf-8",
  );
  runMigrations(db, [{ name: "001_init.sql", sql: initSql }]);
  repo = createGenreSectionsRepo(db);
  charactersRepo = createCharactersRepo(db);
  tools = makeGenreSectionTools({ repo, charactersRepo });
});

afterEach(() => {
  try {
    db.close();
  } catch {}
});

async function exec(toolName: string, args: any): Promise<any> {
  const t = tools[toolName];
  if (!t || !t.execute) throw new Error(`tool ${toolName} 缺少 execute`);
  // Vercel AI SDK 5 要求工具入参先经过 zod 校验,这里手动跑一遍以模拟真实调用路径。
  const parsed = t.parameters.parse(args);
  return await t.execute(parsed, {
    toolCallId: "test",
    messages: [],
  } as any);
}

describe("create_genre_section", () => {
  it("happy:创建板块返回 GenreSection", async () => {
    const r = await exec("create_genre_section", {
      name: "功法体系",
      schema: [{ name: "name", type: "string", required: true }],
    });
    expect(r.id).toBeTruthy();
    expect(r.name).toBe("功法体系");
    expect(r.createdBy).toBe("ai");
  });

  it("error:重名抛错", async () => {
    await exec("create_genre_section", {
      name: "功法",
      schema: [{ name: "x", type: "string" }],
    });
    await expect(
      exec("create_genre_section", {
        name: "功法",
        schema: [{ name: "x", type: "string" }],
      }),
    ).rejects.toThrow(/已存在/);
  });
});

describe("add_genre_section_item", () => {
  it("happy:有板块 + 数据合法 → 添加成功", async () => {
    const sec = await exec("create_genre_section", {
      name: "境界",
      schema: [
        { name: "name", type: "string", required: true },
        { name: "order", type: "number" },
      ],
    });
    const item = await exec("add_genre_section_item", {
      sectionName: "境界",
      data: { name: "炼气", order: 1 },
    });
    expect(item.id).toBeTruthy();
    expect(item.data.name).toBe("炼气");
    expect(repo.listItems(sec.id)).toHaveLength(1);
  });

  it("error:板块不存在", async () => {
    await expect(
      exec("add_genre_section_item", {
        sectionName: "幽灵板块",
        data: {},
      }),
    ).rejects.toThrow(/不存在/);
  });

  it("error:required 字段缺失", async () => {
    await exec("create_genre_section", {
      name: "x",
      schema: [{ name: "n", type: "string", required: true }],
    });
    await expect(
      exec("add_genre_section_item", {
        sectionName: "x",
        data: {},
      }),
    ).rejects.toThrow(/必填/);
  });

  it("ref:character 字段:目标存在通过,不存在抛错", async () => {
    const linchen = charactersRepo.create({
      name: "林尘",
      role: "protagonist",
      baseData: {},
      currentState: {},
    });
    await exec("create_genre_section", {
      name: "灵宠",
      schema: [
        { name: "name", type: "string", required: true },
        { name: "owner", type: "ref:character" },
      ],
    });
    await exec("add_genre_section_item", {
      sectionName: "灵宠",
      data: { name: "小白", owner: linchen.id },
    });
    await expect(
      exec("add_genre_section_item", {
        sectionName: "灵宠",
        data: { name: "小黑", owner: "幽灵-id" },
      }),
    ).rejects.toThrow(/不存在/);
  });
});

describe("update_genre_section_schema", () => {
  it("happy:改 schema 成功", async () => {
    await exec("create_genre_section", {
      name: "境界",
      schema: [{ name: "name", type: "string", required: true }],
    });
    const updated = await exec("update_genre_section_schema", {
      sectionName: "境界",
      schema: [
        { name: "name", type: "string", required: true },
        { name: "order", type: "number" },
      ],
    });
    expect(updated.schema).toHaveLength(2);
  });

  it("error:板块不存在", async () => {
    await expect(
      exec("update_genre_section_schema", {
        sectionName: "no",
        schema: [{ name: "x", type: "string" }],
      }),
    ).rejects.toThrow(/不存在/);
  });
});

describe("delete_genre_section", () => {
  it("happy:级联删 items", async () => {
    const sec = await exec("create_genre_section", {
      name: "境界",
      schema: [{ name: "name", type: "string", required: true }],
    });
    await exec("add_genre_section_item", {
      sectionName: "境界",
      data: { name: "炼气" },
    });
    await exec("add_genre_section_item", {
      sectionName: "境界",
      data: { name: "筑基" },
    });
    const r = await exec("delete_genre_section", { sectionName: "境界" });
    expect(r.deleted).toBe("境界");
    expect(r.itemsRemoved).toBe(2);
    expect(repo.getSection(sec.id)).toBeUndefined();
    expect(repo.listItems(sec.id)).toHaveLength(0);
  });

  it("error:板块不存在", async () => {
    await expect(
      exec("delete_genre_section", { sectionName: "x" }),
    ).rejects.toThrow(/不存在/);
  });
});

describe("update_genre_section_item / delete_genre_section_item", () => {
  it("update_genre_section_item happy", async () => {
    await exec("create_genre_section", {
      name: "境界",
      schema: [
        { name: "name", type: "string", required: true },
        { name: "order", type: "number" },
      ],
    });
    const item = await exec("add_genre_section_item", {
      sectionName: "境界",
      data: { name: "炼气", order: 1 },
    });
    const updated = await exec("update_genre_section_item", {
      itemId: item.id,
      data: { order: 2 },
    });
    expect(updated.data.order).toBe(2);
    expect(updated.data.name).toBe("炼气"); // merge 不删原字段
  });

  it("update_genre_section_item:校验失败抛错", async () => {
    await exec("create_genre_section", {
      name: "x",
      schema: [{ name: "n", type: "number", required: true }],
    });
    const item = await exec("add_genre_section_item", {
      sectionName: "x",
      data: { n: 1 },
    });
    await expect(
      exec("update_genre_section_item", {
        itemId: item.id,
        data: { n: "字符串非数字" },
      }),
    ).rejects.toThrow(/应为数字/);
  });

  it("delete_genre_section_item happy", async () => {
    await exec("create_genre_section", {
      name: "x",
      schema: [{ name: "n", type: "string" }],
    });
    const item = await exec("add_genre_section_item", {
      sectionName: "x",
      data: { n: "a" },
    });
    await exec("delete_genre_section_item", { itemId: item.id });
    expect(repo.getItem(item.id)).toBeUndefined();
  });

  it("delete_genre_section_item:不存在抛错", async () => {
    await expect(
      exec("delete_genre_section_item", { itemId: "ghost" }),
    ).rejects.toThrow(/不存在/);
  });
});
