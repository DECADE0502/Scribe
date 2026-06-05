import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  createSnapshot,
  listSnapshots,
  restoreSnapshot,
  pruneSnapshots,
} from "../../../src/fs/snapshot.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "snap-"));
});

describe("snapshot", () => {
  it("createSnapshot 打包目录到 tar.gz,listSnapshots 列出", async () => {
    const src = path.join(tmp, "books", "abc");
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, "rules.md"), "# 规则");
    const out = path.join(tmp, "backups", "abc");
    const snap = await createSnapshot({ srcDir: src, outDir: out });
    expect(fs.existsSync(snap.path)).toBe(true);
    expect(snap.path.endsWith(".tar.gz")).toBe(true);
    const list = await listSnapshots(out);
    expect(list).toHaveLength(1);
    expect(list[0]!.path).toBe(snap.path);
  });

  it("restoreSnapshot 解压覆盖目标目录", async () => {
    const src = path.join(tmp, "src");
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, "a.md"), "原始");
    const out = path.join(tmp, "out");
    const snap = await createSnapshot({ srcDir: src, outDir: out });
    fs.writeFileSync(path.join(src, "a.md"), "被改坏");
    await restoreSnapshot({ snapshotPath: snap.path, destDir: src });
    expect(fs.readFileSync(path.join(src, "a.md"), "utf-8")).toBe("原始");
  });

  it("pruneSnapshots 保留近 30 天 + 30 天前每周 1 份", async () => {
    const out = path.join(tmp, "history");
    fs.mkdirSync(out, { recursive: true });
    // 模拟从今天向前 90 天,每天一份快照(文件名按本地时区 yyyymmdd-HHMM)
    const now = new Date(2026, 5, 5, 12, 0, 0); // 2026-06-05 12:00 本地
    const pad2 = (n: number) => String(n).padStart(2, "0");
    const names: string[] = [];
    for (let i = 0; i < 90; i++) {
      const d = new Date(now.getTime() - i * 86_400_000);
      const name =
        `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}` +
        `-${pad2(d.getHours())}${pad2(d.getMinutes())}.tar.gz`;
      fs.writeFileSync(path.join(out, name), "");
      names.push(name);
    }
    const result = await pruneSnapshots(out, { now });
    // 近 30 天(ageDays<=30)应全部保留 → 至少 30 份
    expect(result.kept.length).toBeGreaterThanOrEqual(30);
    // 90 天里删除数应 >= 50(plan 要求 90 - kept >= 50)
    expect(90 - result.kept.length).toBeGreaterThanOrEqual(50);
    // 已删的物理文件确实消失
    for (const d of result.deleted) {
      expect(fs.existsSync(path.join(out, d))).toBe(false);
    }
    // 保留的文件仍在
    for (const k of result.kept) {
      expect(fs.existsSync(path.join(out, k))).toBe(true);
    }
  });
});
