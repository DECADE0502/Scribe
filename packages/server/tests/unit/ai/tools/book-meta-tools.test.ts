import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { runMigrations } from "../../../../src/db/migrations/runner.js";
import { createBookMetaRepo } from "../../../../src/db/repositories/book-meta.js";
import { createCharactersRepo } from "../../../../src/db/repositories/characters.js";
import { createOutlineRepo } from "../../../../src/db/repositories/outline.js";
import { makeBookMetaTools } from "../../../../src/ai/tools/book-meta-tools.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let tmp: string;
let db: any;
let deps: any;
let tools: any;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scribe-bm-"));
  db = new Database(":memory:");
  const initSql = fs.readFileSync(
    path.join(
      __dirname,
      "../../../../src/db/migrations/workspace/001_init.sql",
    ),
    "utf-8",
  );
  runMigrations(db, [{ name: "001_init.sql", sql: initSql }]);
  deps = {
    bookMetaRepo: createBookMetaRepo(db),
    charactersRepo: createCharactersRepo(db),
    outlineRepo: createOutlineRepo(db),
    rulesMdPath: path.join(tmp, "rules.md"),
  };
  tools = makeBookMetaTools(deps);
});

afterEach(() => {
  try {
    db.close();
  } catch {}
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function exec(name: string, args: any) {
  const t = tools[name];
  if (!t || !t.execute) throw new Error(`tool ${name} 缺 execute`);
  const parsed = t.parameters.parse(args);
  return await t.execute(parsed, {
    toolCallId: "test",
    messages: [],
  } as any);
}

describe("set_book_meta", () => {
  it("可设多字段,partial 合并", async () => {
    await exec("set_book_meta", { title: "玄剑录", genre: "仙侠" });
    await exec("set_book_meta", { tone: "清冷" });
    expect(deps.bookMetaRepo.get("title")).toBe("玄剑录");
    expect(deps.bookMetaRepo.get("genre")).toBe("仙侠");
    expect(deps.bookMetaRepo.get("tone")).toBe("清冷");
  });

  it("空 args 不报错(全 optional)", async () => {
    const r = await exec("set_book_meta", {});
    expect(r.updated).toEqual({});
  });
});

describe("create_character", () => {
  it("happy:protagonist + 三字段", async () => {
    const r = await exec("create_character", {
      name: "林尘",
      role: "protagonist",
      background: "弃婴",
      motivation: "复仇",
    });
    expect(r.id).toBeTruthy();
    expect(r.name).toBe("林尘");
    const c = deps.charactersRepo.get(r.id);
    expect(c?.role).toBe("protagonist");
    expect(c?.baseData?.background).toBe("弃婴");
  });

  it("Zod 拦截 role 非法值", async () => {
    await expect(
      exec("create_character", {
        name: "x",
        role: "villain",
      }),
    ).rejects.toThrow();
  });
});

describe("update_character", () => {
  it("happy:更新 name 和 background", async () => {
    const c = await exec("create_character", {
      name: "林尘",
      role: "protagonist",
    });
    const r = await exec("update_character", {
      id: c.id,
      name: "林二尘",
      background: "新背景",
    });
    expect(r.name).toBe("林二尘");
    const reloaded = deps.charactersRepo.get(c.id);
    expect(reloaded?.baseData?.background).toBe("新背景");
  });

  it("error:角色不存在", async () => {
    await expect(
      exec("update_character", { id: "ghost", name: "x" }),
    ).rejects.toThrow(/不存在/);
  });
});

describe("create_outline_node", () => {
  it("happy:volume 顶级节点", async () => {
    const r = await exec("create_outline_node", {
      level: "volume",
      title: "卷一:重生",
      summary: "主角重修崛起",
    });
    expect(r.title).toBe("卷一:重生");
    expect(deps.outlineRepo.listAll()).toHaveLength(1);
  });

  it("sortOrder 默认按已有同级数量递增", async () => {
    await exec("create_outline_node", { level: "volume", title: "卷一" });
    await exec("create_outline_node", { level: "volume", title: "卷二" });
    const all = deps.outlineRepo.listAll();
    const sorted = [...all].sort(
      (a: any, b: any) => a.sortOrder - b.sortOrder,
    );
    expect(sorted.map((n: any) => n.title)).toEqual(["卷一", "卷二"]);
  });

  it("Zod 拦截非法 level", async () => {
    await expect(
      exec("create_outline_node", {
        level: "section",
        title: "x",
      }),
    ).rejects.toThrow();
  });
});

describe("update_outline_node", () => {
  it("happy:更新 status", async () => {
    const n = await exec("create_outline_node", {
      level: "volume",
      title: "卷一",
    });
    const r = await exec("update_outline_node", {
      id: n.id,
      status: "in_progress",
    });
    expect(r.title).toBe("卷一");
  });
});

describe("set_rules_md", () => {
  it("写入 rules.md 文件", async () => {
    await exec("set_rules_md", { content: "## 风格\n\n禁用破折号。" });
    expect(fs.existsSync(deps.rulesMdPath)).toBe(true);
    const content = fs.readFileSync(deps.rulesMdPath, "utf-8");
    expect(content).toContain("禁用破折号");
  });

  it("覆盖式更新", async () => {
    await exec("set_rules_md", { content: "v1" });
    await exec("set_rules_md", { content: "v2" });
    expect(fs.readFileSync(deps.rulesMdPath, "utf-8")).toBe("v2");
  });

  it("自动创建父目录", async () => {
    fs.rmSync(deps.rulesMdPath, { force: true });
    fs.rmSync(path.dirname(deps.rulesMdPath), {
      recursive: true,
      force: true,
    });
    await exec("set_rules_md", { content: "x" });
    expect(fs.existsSync(deps.rulesMdPath)).toBe(true);
  });
});
