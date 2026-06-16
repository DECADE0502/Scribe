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
  tools = makeGenreSectionTools({ repo, charactersRepo, includeLegacyNames: true });
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
  const normalizedArgs =
    toolName === "create_genre_section" &&
    Array.isArray(args.schema) &&
    args.schema.length > 0 &&
    !args.identityFields
      ? {
          ...args,
          identityFields: [args.schema[0].name],
          displayFields: [args.schema[0].name],
          schema: args.schema.map((field: any, index: number) =>
            index === 0
              ? { ...field, role: field.role ?? "identity", required: field.required ?? true }
              : field,
          ),
        }
      : args;
  const parsed = t.parameters.parse(normalizedArgs);
  return await t.execute(parsed, {
    toolCallId: "test",
    messages: [],
  } as any);
}

describe("create_genre_section", () => {
  it("exposes generic record tool aliases while keeping legacy names", () => {
    const publicTools = makeGenreSectionTools({ repo, charactersRepo });
    expect(publicTools.create_record_collection?.execute).toBeDefined();
    expect(publicTools.update_record_collection_schema?.execute).toBeDefined();
    expect(publicTools.upsert_record_item?.execute).toBeDefined();
    expect(publicTools.link_record_items?.execute).toBeDefined();
    expect(publicTools.create_genre_section).toBeUndefined();
    expect(publicTools.upsert_genre_section_item).toBeUndefined();

    expect(tools.create_record_collection?.execute).toBeDefined();
    expect(tools.update_record_collection_schema?.execute).toBeDefined();
    expect(tools.upsert_record_item?.execute).toBeDefined();
    expect(tools.link_record_items?.execute).toBeDefined();
    expect(tools.create_genre_section?.execute).toBeDefined();
    expect(tools.upsert_genre_section_item?.execute).toBeDefined();
  });

  it("happy:创建板块返回 GenreSection", async () => {
    const r = await exec("create_genre_section", {
      name: "任意集合",
      schema: [{ name: "name", type: "string", required: true }],
    });
    expect(r.id).toBeTruthy();
    expect(r.name).toBe("任意集合");
    expect(r.createdBy).toBe("ai");
    expect(r.identityFields).toEqual(["name"]);
  });

  it("create_record_collection accepts shorthand ref to another collection", async () => {
    await exec("create_record_collection", {
      name: "合同条款",
      identityFields: ["条款编号"],
      displayFields: ["条款编号"],
      searchFields: ["条款编号"],
      schema: [
        { name: "条款编号", type: "string", role: "identity", required: true },
      ],
    });

    const result = await exec("create_record_collection", {
      name: "风险事项",
      identityFields: ["风险编号"],
      displayFields: ["风险编号", "涉及合同"],
      searchFields: ["风险编号"],
      schema: [
        { name: "风险编号", type: "string", role: "identity", required: true },
        { name: "涉及合同", type: "ref:合同条款", role: "relation" },
      ],
    });

    expect(result.schema.find((field: any) => field.name === "涉及合同").type).toBe("ref:section:合同条款");
  });

  it("error:新建集合缺少 identity 声明时抛错,不猜字段", async () => {
    const t = tools.create_genre_section;
    const parsed = t.parameters.parse({
      name: "缺声明集合",
      schema: [{ name: "名称", type: "string", required: true }],
    });

    await expect(
      t.execute(parsed, { toolCallId: "test", messages: [] } as any),
    ).rejects.toThrow(/identity/);
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

  it("displayFields:显式显示字段决定显示名,不靠第一个字段猜", async () => {
    const r = await exec("create_genre_section", {
      name: "显示字段集合",
      identityFields: ["名称"],
      displayFields: ["名称"],
      schema: [
        { name: "描述", type: "string" },
        { name: "名称", type: "string", required: true, role: "identity" },
      ],
    });
    expect(r.identityFields).toEqual(["名称"]);
    expect(r.displayFields).toEqual(["名称"]);
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
  it("upsert:相同 identity 更新旧条目,不重复新增", async () => {
    await exec("create_genre_section", {
      name: "任意集合",
      identityFields: ["代号"],
      displayFields: ["名称"],
      searchFields: ["代号", "名称", "状态"],
      schema: [
        { name: "代号", type: "string", required: true, role: "identity" },
        { name: "名称", type: "string", role: "label" },
        { name: "状态", type: "string", role: "status" },
      ],
    });
    const first = await exec("upsert_genre_section_item", {
      sectionName: "任意集合",
      data: { 代号: "A-1", 名称: "一号", 状态: "初始" },
    });
    const second = await exec("upsert_genre_section_item", {
      sectionName: "任意集合",
      data: { 代号: "A-1", 状态: "变化" },
    });
    const section = repo.getByName("任意集合");

    expect(repo.listItems(section.id)).toHaveLength(1);
    expect(first.created).toBe(true);
    expect(second.updated).toBe(true);
    expect(repo.getItem(first.item.id).data).toMatchObject({
      代号: "A-1",
      名称: "一号",
      状态: "变化",
    });
  });

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
  it("ref:character field accepts character name and stores character id", async () => {
    const alan = charactersRepo.create({
      name: "阿澜",
      role: "protagonist",
      baseData: {},
      currentState: {},
    });
    await exec("create_genre_section", {
      name: "Relics",
      identityFields: ["name"],
      displayFields: ["name"],
      schema: [
        { name: "name", type: "string", required: true, role: "identity" },
        { name: "holder", type: "ref:character", role: "relation" },
      ],
    });

    const result = await exec("upsert_record_item", {
      sectionName: "Relics",
      data: { name: "Black Root", holder: "阿澜" },
    });

    expect(result.created).toBe(true);
    expect(result.item.data.holder).toBe(alan.id);
  });

  it("upsert expands enum declarations when AI writes a new generic value", async () => {
    await exec("create_genre_section", {
      name: "Islands",
      identityFields: ["name"],
      displayFields: ["name", "status"],
      schema: [
        { name: "name", type: "string", required: true, role: "identity" },
        {
          name: "status",
          type: { kind: "enum", values: ["稳定", "未知"] },
          role: "status",
        },
      ],
    });

    const result = await exec("upsert_record_item", {
      sectionName: "Islands",
      data: { name: "潮汐岩", status: "已探明" },
    });

    expect(result.created).toBe(true);
    expect(result.item.data.status).toBe("已探明");
    const section = repo.getByName("Islands");
    const status = section.schema.find((field: any) => field.name === "status");
    expect(status.type.values).toContain("已探明");
  });

  it("upsert_record_item accepts data as a JSON object string from model tool calls", async () => {
    await exec("create_record_collection", {
      name: "Artifacts",
      identityFields: ["name"],
      displayFields: ["name"],
      searchFields: ["name", "status"],
      schema: [
        { name: "name", type: "string", required: true, role: "identity" },
        { name: "status", type: "string", role: "status" },
      ],
    });

    const result = await exec("upsert_record_item", {
      sectionName: "Artifacts",
      data: JSON.stringify({ name: "Compass", status: "active" }),
    });

    expect(result.created).toBe(true);
    expect(result.item.data).toMatchObject({
      name: "Compass",
      status: "active",
    });
  });

  it("upsert_record_item rejects data strings that do not parse to an object", async () => {
    await exec("create_record_collection", {
      name: "BadPayloads",
      identityFields: ["name"],
      displayFields: ["name"],
      schema: [
        { name: "name", type: "string", required: true, role: "identity" },
      ],
    });

    await expect(
      exec("upsert_record_item", {
        sectionName: "BadPayloads",
        data: "not-json",
      }),
    ).rejects.toThrow();
  });
});

describe("link_record_items", () => {
  it("links two generic record items through a declared relation field", async () => {
    await exec("create_genre_section", {
      name: "SourceRecords",
      identityFields: ["code"],
      displayFields: ["title"],
      searchFields: ["code", "title"],
      schema: [
        { name: "code", type: "string", required: true, role: "identity" },
        { name: "title", type: "string", role: "label" },
        { name: "relatedTargets", type: "list:ref:section:TargetRecords", role: "relation" },
      ],
    });
    await exec("create_genre_section", {
      name: "TargetRecords",
      identityFields: ["code"],
      displayFields: ["title"],
      searchFields: ["code", "title"],
      schema: [
        { name: "code", type: "string", required: true, role: "identity" },
        { name: "title", type: "string", role: "label" },
      ],
    });
    await exec("upsert_genre_section_item", {
      sectionName: "SourceRecords",
      data: { code: "S-1", title: "Source One" },
    });
    await exec("upsert_genre_section_item", {
      sectionName: "TargetRecords",
      data: { code: "T-1", title: "Target One" },
    });

    const result = await exec("link_record_items", {
      sourceSectionName: "SourceRecords",
      sourceIdentity: { code: "S-1" },
      relationField: "relatedTargets",
      targetSectionName: "TargetRecords",
      targetIdentity: { code: "T-1" },
    });

    expect(result.linked).toBe(true);
    const sourceSection = repo.getByName("SourceRecords");
    const source = repo.findItemByIdentity(sourceSection, { code: "S-1" });
    expect(source.data.relatedTargets).toEqual([result.targetItemId]);
  });
  it("links a generic record item to a character relation field", async () => {
    const alan = charactersRepo.create({
      name: "阿澜",
      role: "protagonist",
      baseData: {},
      currentState: {},
    });
    await exec("create_genre_section", {
      name: "Relics",
      identityFields: ["name"],
      displayFields: ["name"],
      schema: [
        { name: "name", type: "string", required: true, role: "identity" },
        { name: "holder", type: "ref:character", role: "relation" },
      ],
    });
    await exec("upsert_record_item", {
      sectionName: "Relics",
      data: { name: "Black Root" },
    });

    const result = await exec("link_record_items", {
      sourceSectionName: "Relics",
      sourceIdentity: { name: "Black Root" },
      relationField: "holder",
      targetSectionName: "characters",
      targetIdentity: { name: "阿澜" },
    });

    expect(result.linked).toBe(true);
    expect(result.targetCharacterId).toBe(alan.id);
    const section = repo.getByName("Relics");
    const item = repo.findItemByIdentity(section, { name: "Black Root" });
    expect(item.data.holder).toBe(alan.id);
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

  it("updates declaration metadata when schema evolves", async () => {
    await exec("create_genre_section", {
      name: "EvolvingRecords",
      identityFields: ["code"],
      displayFields: ["code"],
      searchFields: ["code"],
      schema: [
        { name: "code", type: "string", required: true, role: "identity" },
      ],
    });

    const updated = await exec("update_genre_section_schema", {
      sectionName: "EvolvingRecords",
      identityFields: ["code"],
      displayFields: ["title"],
      searchFields: ["code", "title"],
      schema: [
        { name: "code", type: "string", required: true, role: "identity" },
        { name: "title", type: "string", role: "label" },
      ],
    });

    expect(updated.identityFields).toEqual(["code"]);
    expect(updated.displayFields).toEqual(["title"]);
    expect(updated.searchFields).toEqual(["code", "title"]);
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
