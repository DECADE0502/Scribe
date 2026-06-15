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

  it("isLabel:AI 显式声明的字段被保留为唯一显示名字段", async () => {
    const r = await exec("create_genre_section", {
      name: "功法",
      schema: [
        { name: "属性", type: "string" },
        { name: "功法名", type: "string", required: true, isLabel: true },
        { name: "品阶", type: "string" },
      ],
    });
    const labels = r.schema.filter((f: any) => f.isLabel);
    expect(labels).toHaveLength(1);
    expect(labels[0].name).toBe("功法名");
  });

  it("isLabel:AI 没声明时自动把第一个必填字段提为显示名(落盘必有恰好一个 isLabel)", async () => {
    const r = await exec("create_genre_section", {
      name: "法器",
      schema: [
        { name: "描述", type: "string" },
        { name: "名称", type: "string", required: true },
      ],
    });
    const labels = r.schema.filter((f: any) => f.isLabel);
    expect(labels).toHaveLength(1);
    expect(labels[0].name).toBe("名称");
  });

  it("isLabel:AI 误标多个时只保留第一个", async () => {
    const r = await exec("create_genre_section", {
      name: "势力",
      schema: [
        { name: "势力名", type: "string", isLabel: true },
        { name: "类型", type: "string", isLabel: true },
      ],
    });
    expect(r.schema.filter((f: any) => f.isLabel)).toHaveLength(1);
    expect(r.schema.find((f: any) => f.isLabel).name).toBe("势力名");
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

describe("加固:schema 演化与边界", () => {
  it("改 schema 删字段后,旧 items 仍能加载(忽略多余字段)", async () => {
    await exec("create_genre_section", {
      name: "x",
      schema: [
        { name: "a", type: "string" },
        { name: "b", type: "string" },
      ],
    });
    const item = await exec("add_genre_section_item", {
      sectionName: "x",
      data: { a: "1", b: "2" },
    });
    // 删 b 字段
    await exec("update_genre_section_schema", {
      sectionName: "x",
      schema: [{ name: "a", type: "string" }],
    });
    // 旧 item 仍能查到,b 字段仍在 data 里(不主动清理)
    const after = repo.getItem(item.id);
    expect(after?.data.a).toBe("1");
    expect(after?.data.b).toBe("2"); // 多余字段保留,符合 validator "data 多余字段忽略" 规则
  });

  it("改 schema 加 required 字段:旧 items 不动(更新时才校验)", async () => {
    await exec("create_genre_section", {
      name: "x",
      schema: [{ name: "a", type: "string", required: true }],
    });
    const item = await exec("add_genre_section_item", {
      sectionName: "x",
      data: { a: "v" },
    });
    await exec("update_genre_section_schema", {
      sectionName: "x",
      schema: [
        { name: "a", type: "string", required: true },
        { name: "b", type: "string", required: true },
      ],
    });
    // 旧 item 仍存在,但更新它(merge 后 b 仍缺)会抛错
    expect(repo.getItem(item.id)).toBeDefined();
    await expect(
      exec("update_genre_section_item", {
        itemId: item.id,
        data: { a: "v2" },
      }),
    ).rejects.toThrow(/必填/);
    // 但补全 b 后可以更新
    await exec("update_genre_section_item", {
      itemId: item.id,
      data: { b: "now-set" },
    });
  });

  it("Zod 拦截非法 schema:type=magic 在工具入参就被拒", async () => {
    await expect(
      exec("create_genre_section", {
        name: "x",
        schema: [{ name: "x", type: "magic" }],
      }),
    ).rejects.toThrow();
  });

  it("Zod 拦截非法 schema:enum 对象 values 长度 1", async () => {
    await expect(
      exec("create_genre_section", {
        name: "x",
        schema: [{ name: "x", type: { kind: "enum", values: ["仅一项"] } }],
      }),
    ).rejects.toThrow();
  });

  it("Zod 拦截:schema 数组为空", async () => {
    await expect(
      exec("create_genre_section", {
        name: "x",
        schema: [],
      }),
    ).rejects.toThrow();
  });
});
