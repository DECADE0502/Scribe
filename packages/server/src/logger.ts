/**
 * 轻量 logger。带时间戳、级别、模块标签。输出到 stdout/stderr。
 * 用 LOG_LEVEL 环境变量控制详细度（debug/info/warn/error），默认 info。
 */
type Level = "debug" | "info" | "warn" | "error";

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const envLevel = (process.env.LOG_LEVEL ?? "info").toLowerCase() as Level;
const threshold = ORDER[envLevel] ?? ORDER.info;

const COLORS: Record<Level, string> = {
  debug: "\x1b[90m",
  info: "\x1b[36m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
};
const RESET = "\x1b[0m";

function stamp(): string {
  return new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

function emit(level: Level, tag: string, msg: string, extra?: unknown) {
  if (ORDER[level] < threshold) return;
  const line = `${COLORS[level]}[${stamp()}] [${level.toUpperCase()}] [${tag}]${RESET} ${msg}`;
  if (level === "error" || level === "warn") {
    process.stderr.write(line + "\n");
    if (extra != null) process.stderr.write(String(extra) + "\n");
  } else {
    process.stdout.write(line + "\n");
    if (extra != null) process.stdout.write(String(extra) + "\n");
  }
}

export const log = {
  debug(tag: string, msg: string, extra?: unknown) { emit("debug", tag, msg, extra); },
  info(tag: string, msg: string, extra?: unknown) { emit("info", tag, msg, extra); },
  warn(tag: string, msg: string, extra?: unknown) { emit("warn", tag, msg, extra); },
  error(tag: string, msg: string, extra?: unknown) { emit("error", tag, msg, extra); },
};

/** 请求级 tag 工厂：给每次 HTTP 请求一个短 id，方便串日志 */
let reqCounter = 0;
export function reqTag(path: string): string {
  const id = (++reqCounter).toString(36).padStart(4, "0");
  return `http:${id}:${path}`;
}
