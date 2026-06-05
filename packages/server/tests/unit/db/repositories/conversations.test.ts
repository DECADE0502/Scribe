import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "../../../../src/db/migrations/runner.js";
import { createConversationsRepo } from "../../../../src/db/repositories/conversations.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceInit = fs.readFileSync(
  path.join(__dirname, "../../../../src/db/migrations/workspace/001_init.sql"),
  "utf-8"
);

let db: any, repo: ReturnType<typeof createConversationsRepo>;
beforeEach(() => {
  db = new Database(":memory:");
  runMigrations(db, [{ name: "001_init.sql", sql: workspaceInit }]);
  repo = createConversationsRepo(db);
});

describe("conversations repo", () => {
  it("append + countAll", () => {
    repo.append({ role: "user", content: "你好" });
    repo.append({ role: "assistant", content: "您好" });
    expect(repo.countAll()).toBe(2);
  });

  it("append 返回带 id 的记录", () => {
    const m = repo.append({ role: "user", content: "hi", metadata: { tag: "x" } });
    expect(m.id).toBeGreaterThan(0);
    expect(m.role).toBe("user");
    expect(m.metadata).toEqual({ tag: "x" });
    expect(m.createdAt).toBeGreaterThan(0);
  });

  it("listLatest 按 created_at desc 限制条数", async () => {
    repo.append({ role: "user", content: "1" });
    await new Promise((r) => setTimeout(r, 5));
    repo.append({ role: "assistant", content: "2" });
    await new Promise((r) => setTimeout(r, 5));
    repo.append({ role: "user", content: "3" });
    const list = repo.listLatest(2);
    expect(list).toHaveLength(2);
    expect(list[0]?.content).toBe("3");
    expect(list[1]?.content).toBe("2");
  });

  it("listSince 返回 timestamp 之后的消息", async () => {
    repo.append({ role: "user", content: "old" });
    await new Promise((r) => setTimeout(r, 10));
    const cut = Date.now();
    await new Promise((r) => setTimeout(r, 10));
    repo.append({ role: "user", content: "new" });
    const list = repo.listSince(cut);
    expect(list).toHaveLength(1);
    expect(list[0]?.content).toBe("new");
  });

  it("metadata 缺省存 NULL,读出 null", () => {
    const m = repo.append({ role: "user", content: "hi" });
    expect(repo.listLatest(1)[0]?.metadata).toBeNull();
    expect(m.metadata).toBeNull();
  });

  it("countAll 空表为 0", () => {
    expect(repo.countAll()).toBe(0);
  });

  it("raw NULL/空串/JSON null 的 metadata 全部读出为 null", () => {
    db.prepare(
      `INSERT INTO conversations(role,content,metadata,created_at) VALUES(?,?,?,?)`
    ).run("user", "a", null, 1);
    db.prepare(
      `INSERT INTO conversations(role,content,metadata,created_at) VALUES(?,?,?,?)`
    ).run("user", "b", "", 2);
    db.prepare(
      `INSERT INTO conversations(role,content,metadata,created_at) VALUES(?,?,?,?)`
    ).run("user", "c", "null", 3);
    const list = repo.listSince(0);
    expect(list).toHaveLength(3);
    expect(list.every((m) => m.metadata === null)).toBe(true);
  });
});
