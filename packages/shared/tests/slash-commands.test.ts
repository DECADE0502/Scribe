import { describe, it, expect } from "vitest";
import { parseSlashCommand, matchSlashCommands, SLASH_COMMANDS } from "../src/slash-commands.js";

describe("parseSlashCommand", () => {
  it("普通文本 → text", () => {
    expect(parseSlashCommand("你好")).toEqual({ kind: "text" });
  });

  it("英文命令 + 参数", () => {
    expect(parseSlashCommand("/auto 5")).toEqual({ kind: "command", id: "auto", args: "5" });
  });

  it("中文别名", () => {
    expect(parseSlashCommand("/续写")).toEqual({ kind: "command", id: "write", args: "" });
    expect(parseSlashCommand("/查找 林尘")).toEqual({ kind: "command", id: "recall", args: "林尘" });
  });

  it("未知命令 → text(交给意图识别)", () => {
    expect(parseSlashCommand("/不存在的命令")).toEqual({ kind: "text" });
  });

  it("前后空白容忍", () => {
    expect(parseSlashCommand("  /help  ")).toEqual({ kind: "command", id: "help", args: "" });
  });

  it("8 个命令都有中英 alias", () => {
    expect(SLASH_COMMANDS).toHaveLength(8);
    for (const cmd of SLASH_COMMANDS) {
      expect(cmd.aliases.some(a => /^\/[a-z]+$/.test(a))).toBe(true);
      expect(cmd.aliases.some(a => /[一-龥]/.test(a))).toBe(true);
    }
  });
});

describe("matchSlashCommands", () => {
  it("单 / 列出全部", () => {
    expect(matchSlashCommands("/")).toHaveLength(8);
  });

  it("英文前缀过滤", () => {
    const m = matchSlashCommands("/re");
    expect(m.map(c => c.id).sort()).toEqual(["recall", "revise", "rewrite"]);
  });

  it("中文前缀过滤", () => {
    const m = matchSlashCommands("/续");
    expect(m.map(c => c.id)).toEqual(["write"]);
  });

  it("非斜杠开头返回空", () => {
    expect(matchSlashCommands("普通文本")).toHaveLength(0);
  });
});
