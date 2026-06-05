/**
 * 通用 JSON 字段解析工具,用于 SQLite TEXT/JSON 列回到领域模型时的反序列化。
 *
 * 三种 fallback 形态:
 *   - parseJsonField<T>(value, fallback)        — NULL/空串/解析失败 → 给定 fallback
 *   - parseJsonArray<T>(value)                  — NULL/空串/解析失败/非数组 → []
 *   - parseNullableObject(value)                — NULL/空串/解析失败/null → null
 */

export function parseJsonField<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function parseJsonArray<T>(value: unknown): T[] {
  if (value === null || value === undefined || value === "") return [];
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function parseNullableObject(
  value: unknown
): Record<string, unknown> | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed === null ? null : (parsed as Record<string, unknown>);
  } catch {
    return null;
  }
}
