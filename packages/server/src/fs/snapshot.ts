import * as fs from "node:fs";
import * as path from "node:path";
import * as tar from "tar";

export interface CreateSnapshotInput {
  srcDir: string;
  outDir: string;
  now?: Date;
}

export interface SnapshotInfo {
  /** 绝对路径(POSIX 正斜杠) */
  path: string;
  /** 文件名(YYYYMMDD-HHMM.tar.gz) */
  name: string;
  /** 由文件名解析出的快照时刻 */
  takenAt: Date;
}

export interface RestoreSnapshotInput {
  snapshotPath: string;
  destDir: string;
}

export interface PruneOptions {
  now?: Date;
}

export interface PruneResult {
  kept: string[];
  deleted: string[];
}

const FILENAME_RE = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})\.tar\.gz$/;
const pad2 = (n: number) => String(n).padStart(2, "0");

function formatFilename(d: Date): string {
  return (
    `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}` +
    `-${pad2(d.getHours())}${pad2(d.getMinutes())}.tar.gz`
  );
}

function parseFilename(name: string): Date | undefined {
  const m = FILENAME_RE.exec(name);
  if (!m) return undefined;
  const [, y, mo, da, hh, mi] = m;
  return new Date(
    Number(y),
    Number(mo) - 1,
    Number(da),
    Number(hh),
    Number(mi),
    0,
    0,
  );
}

/** ISO 8601 周编号:返回 `YYYY-Www` 字符串 */
function isoWeek(d: Date): string {
  // 复制为 UTC midnight,避免 DST
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = t.getUTCDay() === 0 ? 7 : t.getUTCDay();
  // 推到当周周四
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const year = t.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(
    ((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
  );
  return `${year}-W${pad2(week)}`;
}

export async function createSnapshot(
  input: CreateSnapshotInput,
): Promise<SnapshotInfo> {
  if (!fs.existsSync(input.srcDir)) {
    throw new Error(`srcDir not found: ${input.srcDir}`);
  }
  fs.mkdirSync(input.outDir, { recursive: true });
  const now = input.now ?? new Date();
  let name = formatFilename(now);
  let full = path.posix.join(
    input.outDir.split(path.sep).join("/"),
    name,
  );
  // 同分钟二次创建时,追加秒级避免覆盖
  if (fs.existsSync(full)) {
    const sec = pad2(now.getSeconds());
    name = name.replace(/\.tar\.gz$/, `${sec}.tar.gz`);
    full = path.posix.join(input.outDir.split(path.sep).join("/"), name);
  }
  const parent = path.dirname(input.srcDir);
  const base = path.basename(input.srcDir);
  await tar.create(
    { gzip: true, file: full, cwd: parent, portable: true },
    [base],
  );
  return { path: full, name, takenAt: now };
}

export async function listSnapshots(dir: string): Promise<SnapshotInfo[]> {
  if (!fs.existsSync(dir)) return [];
  const entries = fs
    .readdirSync(dir)
    .filter((f) => FILENAME_RE.test(f));
  const dirPosix = dir.split(path.sep).join("/");
  return entries
    .map((name) => {
      const d = parseFilename(name);
      return d
        ? { path: path.posix.join(dirPosix, name), name, takenAt: d }
        : undefined;
    })
    .filter((x): x is SnapshotInfo => Boolean(x))
    .sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime());
}

export async function restoreSnapshot(
  input: RestoreSnapshotInput,
): Promise<void> {
  if (!fs.existsSync(input.snapshotPath)) {
    throw new Error(`snapshot not found: ${input.snapshotPath}`);
  }
  const parent = path.dirname(input.destDir);
  fs.mkdirSync(parent, { recursive: true });
  // 归档以 srcDir 的 basename 作为根。解压到 parent,顶层目录会重叠覆盖。
  await tar.extract({ file: input.snapshotPath, cwd: parent });
}

export async function pruneSnapshots(
  dir: string,
  opts?: PruneOptions,
): Promise<PruneResult> {
  if (!fs.existsSync(dir)) return { kept: [], deleted: [] };
  const now = opts?.now ?? new Date();
  const files = fs.readdirSync(dir).filter((f) => FILENAME_RE.test(f));
  const parsed = files
    .map((name) => ({ name, date: parseFilename(name)! }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const recentKept: string[] = [];
  // 每周保留最早的一份
  const weeklyEarliest = new Map<string, { name: string; date: Date }>();

  for (const { name, date } of parsed) {
    const ageDays = (now.getTime() - date.getTime()) / 86_400_000;
    if (ageDays < 30) {
      recentKept.push(name);
      continue;
    }
    const wk = isoWeek(date);
    const existing = weeklyEarliest.get(wk);
    if (!existing || date < existing.date) {
      weeklyEarliest.set(wk, { name, date });
    }
  }

  const kept = [...recentKept, ...[...weeklyEarliest.values()].map((v) => v.name)];
  const keepSet = new Set(kept);
  const deleted: string[] = [];
  for (const f of files) {
    if (!keepSet.has(f)) {
      fs.unlinkSync(path.join(dir, f));
      deleted.push(f);
    }
  }
  return { kept, deleted };
}
