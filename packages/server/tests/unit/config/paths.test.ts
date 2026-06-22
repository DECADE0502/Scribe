import { describe, it, expect } from "vitest";
import { resolveAppPaths } from "../../../src/config/paths.js";

describe("resolveAppPaths", () => {
  it("默认:数据存项目目录下的 .scribe-data(不写入系统配置目录)", () => {
    const p = resolveAppPaths({ env: {}, projectRoot: "/proj" });
    expect(p.appRoot).toBe("/proj/.scribe-data");
    expect(p.libraryDb).toBe("/proj/.scribe-data/library.db");
    expect(p.booksDir).toBe("/proj/.scribe-data/books");
    expect(p.backupsDir).toBe("/proj/.scribe-data/backups");
    expect(p.secretsEnv).toBe("/proj/.scribe-data/secrets.env");
    expect(p.configJson).toBe("/proj/.scribe-data/config.json");
  });

  it("Windows 风格 projectRoot 也归一为正斜杠路径", () => {
    const p = resolveAppPaths({ env: {}, projectRoot: "C:\\Users\\u\\Scribe" });
    expect(p.appRoot).toBe("C:/Users/u/Scribe/.scribe-data");
  });

  it("SCRIBE_HOME 环境变量优先生效(可指向任意目录)", () => {
    const p = resolveAppPaths({ env: { SCRIBE_HOME: "/tmp/x" }, projectRoot: "/proj" });
    expect(p.appRoot).toBe("/tmp/x");
  });

  it("bookDir(id) 等子路径拼接正确", () => {
    const p = resolveAppPaths({ env: {}, projectRoot: "/proj" });
    expect(p.bookDir("abc")).toBe("/proj/.scribe-data/books/abc");
    expect(p.workspaceDb("abc")).toBe("/proj/.scribe-data/books/abc/workspace.db");
    expect(p.chaptersDir("abc")).toBe("/proj/.scribe-data/books/abc/chapters");
  });
});
