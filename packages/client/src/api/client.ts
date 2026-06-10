/** Scribe 客户端 API。封装 fetch + JSON + 错误归类,以及 SSE 流式消费。 */
import { useToastStore } from "../stores/toast.js";

const ERROR_TEXTS: Record<string, string> = {
  auth: "API key 无效或过期,请到设置中更新",
  rate_limit: "请求过于频繁,请稍后重试",
  not_found: "资源不存在",
  service_unavailable: "服务未就绪,请先在设置中配置模型",
  network: "网络不可用,请检查连接",
  budget_exceeded: "超过单次预算上限",
};

function toastError(errorClass: string, message: string) {
  const text = ERROR_TEXTS[errorClass] ?? `操作失败:${message}`;
  useToastStore.getState().push({ level: "error", text });
}

export interface BookSummary {
  id: string;
  title: string;
  genre: string | null;
  createdAt: number;
  updatedAt: number;
  totalCostUsd: number;
}

export interface CreateBookInput {
  title?: string;
  genre?: string | null;
}

export interface OnboardStatus {
  ok: boolean;
  missing: string[];
}

export interface SseEventBase { type: string }

export class ApiError extends Error {
  constructor(message: string, public status: number, public errorClass: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch (e) {
    toastError("network", "网络断开");
    throw new ApiError(`网络断开,请检查连接`, 0, "network");
  }
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    let errorClass = "unknown";
    try {
      const body = await res.json() as { error?: string; errorClass?: string };
      if (body?.error) message = body.error;
      if (body?.errorClass) errorClass = body.errorClass;
    } catch { /* body 不是 JSON,忽略 */ }
    if (res.status === 401 || res.status === 403) errorClass = "auth";
    if (res.status === 429) errorClass = "rate_limit";
    if (res.status === 503) errorClass = "service_unavailable";
    if (res.status === 404) errorClass = "not_found";
    toastError(errorClass, message);
    throw new ApiError(message, res.status, errorClass);
  }
  return await res.json() as T;
}

export const api = {
  async listBooks(): Promise<BookSummary[]> {
    const r = await jsonFetch<{ books: BookSummary[] }>("/api/books");
    return r.books;
  },
  async createBook(input: CreateBookInput = {}): Promise<BookSummary> {
    return jsonFetch<BookSummary>("/api/books", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  async getOnboardStatus(bookId: string): Promise<OnboardStatus> {
    return jsonFetch<OnboardStatus>(`/api/books/${encodeURIComponent(bookId)}/onboard-status`);
  },
  async skipOnboard(bookId: string): Promise<void> {
    await jsonFetch(`/api/books/${encodeURIComponent(bookId)}/onboard/skip`, { method: "POST" });
  },
  async deleteBook(bookId: string): Promise<void> {
    // 当前 server 还没暴露 DELETE,留接口位
    await jsonFetch(`/api/books/${encodeURIComponent(bookId)}`, { method: "DELETE" });
  },
};

export interface StreamSseOptions {
  url: string;
  body?: unknown;
  signal?: AbortSignal;
  onEvent: (event: { type: string; [key: string]: unknown }) => void;
}

/** 消费 SSE 流。每个事件作为对象传给 onEvent;errorClass=network 时用于标识网络断开。 */
export async function streamSse(opts: StreamSseOptions): Promise<void> {
  let res: Response;
  try {
    res = await fetch(opts.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: opts.body == null ? undefined : JSON.stringify(opts.body),
      signal: opts.signal,
    });
  } catch (e) {
    opts.onEvent({ type: "error", errorClass: "network", message: "网络断开,请检查连接" });
    return;
  }
  if (!res.ok || !res.body) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json() as { error?: string };
      if (body?.error) message = body.error;
    } catch { /* ignore */ }
    opts.onEvent({ type: "error", errorClass: "http_error", message, status: res.status });
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const dataLines = block.split("\n").filter(l => l.startsWith("data:"));
      if (dataLines.length === 0) continue;
      const dataText = dataLines.map(l => l.slice(5).trim()).join("\n");
      try {
        const parsed = JSON.parse(dataText) as { type: string; [key: string]: unknown };
        opts.onEvent(parsed);
      } catch {
        // 忽略不能解析的事件
      }
    }
  }
}
