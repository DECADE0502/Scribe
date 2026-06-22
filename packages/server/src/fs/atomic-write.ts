import * as fs from "node:fs";

let seq = 0;

/**
 * 原子写文件:先写临时文件,再 rename 覆盖目标。
 * rename 在 POSIX 与 Windows(libuv MOVEFILE_REPLACE_EXISTING)上都是原子替换,
 * 因此即便写到一半进程被杀,目标文件要么是旧内容、要么是新内容,绝不会出现半截/空文件。
 */
export function writeFileAtomic(target: string, data: string, opts?: { mode?: number }): void {
  const tmp = `${target}.tmp-${process.pid}-${seq++}`;
  fs.writeFileSync(tmp, data, { encoding: "utf-8", ...(opts?.mode !== undefined ? { mode: opts.mode } : {}) });
  try {
    fs.renameSync(tmp, target);
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
    throw e;
  }
}
