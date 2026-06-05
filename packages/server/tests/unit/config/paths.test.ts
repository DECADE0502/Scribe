import { describe, it, expect, vi, beforeEach } from "vitest";
import * as os from "node:os";
import { resolveAppPaths } from "../../../src/config/paths.js";

// Node 24 + Vitest:node:os 的命名空间属性 configurable=false,
// 必须先用 vi.mock 复制一份可变命名空间,vi.spyOn 才能工作。
vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual };
});

describe("resolveAppPaths", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("Linux:使用 ~/.config/scribe", () => {
    vi.spyOn(os, "platform").mockReturnValue("linux");
    vi.spyOn(os, "homedir").mockReturnValue("/home/u");
    const p = resolveAppPaths({ env: {} });
    expect(p.appRoot).toBe("/home/u/.config/scribe");
    expect(p.libraryDb).toBe("/home/u/.config/scribe/library.db");
    expect(p.booksDir).toBe("/home/u/.config/scribe/books");
    expect(p.backupsDir).toBe("/home/u/.config/scribe/backups");
    expect(p.secretsEnv).toBe("/home/u/.config/scribe/secrets.env");
  });

  it("macOS:使用 ~/Library/Application Support/scribe", () => {
    vi.spyOn(os, "platform").mockReturnValue("darwin");
    vi.spyOn(os, "homedir").mockReturnValue("/Users/u");
    expect(resolveAppPaths({ env: {} }).appRoot)
      .toBe("/Users/u/Library/Application Support/scribe");
  });

  it("Windows:使用 %APPDATA%/scribe", () => {
    vi.spyOn(os, "platform").mockReturnValue("win32");
    const p = resolveAppPaths({ env: { APPDATA: "C:/Users/u/AppData/Roaming" } });
    expect(p.appRoot).toBe("C:/Users/u/AppData/Roaming/scribe");
  });

  it("SCRIBE_HOME 环境变量优先生效", () => {
    const p = resolveAppPaths({ env: { SCRIBE_HOME: "/tmp/x" } });
    expect(p.appRoot).toBe("/tmp/x");
  });

  it("bookDir(id) 拼接正确", () => {
    vi.spyOn(os, "platform").mockReturnValue("linux");
    vi.spyOn(os, "homedir").mockReturnValue("/h");
    const p = resolveAppPaths({ env: {} });
    expect(p.bookDir("abc")).toBe("/h/.config/scribe/books/abc");
    expect(p.workspaceDb("abc")).toBe("/h/.config/scribe/books/abc/workspace.db");
    expect(p.chaptersDir("abc")).toBe("/h/.config/scribe/books/abc/chapters");
  });
});
