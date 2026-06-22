import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { writeFileAtomic } from "../../../src/fs/atomic-write.js";

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scribe-atomic-")); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe("writeFileAtomic", () => {
  it("写入新文件", () => {
    const f = path.join(tmp, "a.txt");
    writeFileAtomic(f, "hello");
    expect(fs.readFileSync(f, "utf-8")).toBe("hello");
  });

  it("覆盖已有文件(原子替换)", () => {
    const f = path.join(tmp, "b.txt");
    fs.writeFileSync(f, "old");
    writeFileAtomic(f, "new");
    expect(fs.readFileSync(f, "utf-8")).toBe("new");
  });

  it("不残留 .tmp 临时文件", () => {
    const f = path.join(tmp, "c.txt");
    writeFileAtomic(f, "x");
    const leftovers = fs.readdirSync(tmp).filter((n) => n.includes(".tmp"));
    expect(leftovers).toEqual([]);
  });
});
