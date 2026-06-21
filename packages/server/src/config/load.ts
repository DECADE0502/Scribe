import * as fs from "node:fs";

export type BuiltinProviderId = "anyrouter" | "deepseek" | "mimo";
export type ProviderId = BuiltinProviderId | string;

export interface StyleReference {
  id: string;
  name: string;
  content: string;
}

export interface CustomProviderConfig {
  id: string;
  name: string;
  type: "openai-compatible";
  baseUrl: string;
  auth: "bearer" | "api-key";
  defaultWriteModelId: string;
  defaultAuditModelId: string;
}

export interface AppConfig {
  /** 单次自动模式预算上限(USD) */
  singleBudgetUsd: number;
  /** HTTP 端口 */
  port: number;
  /** 当前供应商 */
  provider: ProviderId;
  /** 写作模型 */
  writeModelId: string;
  /** 审查模型 */
  auditModelId: string;
  /** 全局「最深处提示词」:原文拼到所有内置提示词最前端,可被每本书覆盖 */
  masterPrompt: string;
  /** 全局文风参考,每本书可选择其中一组注入写作 Agent */
  styleReferences: StyleReference[];
  /** 用户自定义模型供应商,密钥单独保存在 secrets.env */
  customProviders: CustomProviderConfig[];
}

export const DEFAULT_CONFIG: AppConfig = {
  singleBudgetUsd: 5,
  port: 6789,
  provider: "anyrouter",
  writeModelId: "gemini-2.5-pro",
  auditModelId: "gemini-2.5-pro",
  masterPrompt: "",
  styleReferences: [],
  customProviders: [],
};

export function isBuiltinProviderId(value: unknown): value is BuiltinProviderId {
  return value === "anyrouter" || value === "mimo" || value === "deepseek";
}

function normalizeCustomProviderId(value: string): string {
  const chars: string[] = [];
  for (const char of value.trim()) {
    const code = char.charCodeAt(0);
    if (
      (code >= 48 && code <= 57) ||
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      char === "-" ||
      char === "_"
    ) {
      chars.push(char.toLowerCase());
    }
  }
  return chars.join("");
}

export function normalizeStyleReferences(value: unknown): StyleReference[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const refs: StyleReference[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    const content = typeof raw.content === "string" ? raw.content : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    refs.push({ id, name: name || "未命名文风", content });
  }
  return refs;
}

export function normalizeCustomProviders(value: unknown): CustomProviderConfig[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: CustomProviderConfig[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const id = normalizeCustomProviderId(typeof raw.id === "string" ? raw.id : "");
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    const baseUrl = typeof raw.baseUrl === "string" ? raw.baseUrl.trim() : "";
    const auth = raw.auth === "api-key" ? "api-key" : "bearer";
    const defaultWriteModelId = typeof raw.defaultWriteModelId === "string" ? raw.defaultWriteModelId.trim() : "";
    const defaultAuditModelId = typeof raw.defaultAuditModelId === "string" ? raw.defaultAuditModelId.trim() : "";
    if (!id || isBuiltinProviderId(id) || seen.has(id) || !baseUrl) continue;
    seen.add(id);
    out.push({
      id,
      name: name || id,
      type: "openai-compatible",
      baseUrl,
      auth,
      defaultWriteModelId,
      defaultAuditModelId,
    });
  }
  return out;
}

/** 读 config.json,缺失字段用默认值;文件不存在返回默认 */
export function loadConfig(configJsonPath: string): AppConfig {
  if (!fs.existsSync(configJsonPath)) return { ...DEFAULT_CONFIG };
  try {
    const raw = JSON.parse(fs.readFileSync(configJsonPath, "utf-8")) as Partial<AppConfig>;
    return {
      singleBudgetUsd: typeof raw.singleBudgetUsd === "number" && raw.singleBudgetUsd > 0
        ? raw.singleBudgetUsd
        : DEFAULT_CONFIG.singleBudgetUsd,
      port: typeof raw.port === "number" ? raw.port : DEFAULT_CONFIG.port,
      provider: typeof raw.provider === "string" && (
        isBuiltinProviderId(raw.provider) ||
        normalizeCustomProviders(raw.customProviders).some((provider) => provider.id === raw.provider)
      )
        ? raw.provider
        : DEFAULT_CONFIG.provider,
      writeModelId: typeof raw.writeModelId === "string" && raw.writeModelId
        ? raw.writeModelId
        : DEFAULT_CONFIG.writeModelId,
      auditModelId: typeof raw.auditModelId === "string" && raw.auditModelId
        ? raw.auditModelId
        : DEFAULT_CONFIG.auditModelId,
      masterPrompt: typeof raw.masterPrompt === "string"
        ? raw.masterPrompt
        : DEFAULT_CONFIG.masterPrompt,
      styleReferences: normalizeStyleReferences(raw.styleReferences),
      customProviders: normalizeCustomProviders(raw.customProviders),
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(configJsonPath: string, config: AppConfig): void {
  fs.writeFileSync(configJsonPath, JSON.stringify(config, null, 2), "utf-8");
}
