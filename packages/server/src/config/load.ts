import * as fs from "node:fs";

export type ProviderId = "deepseek" | "mimo";

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
}

export const DEFAULT_CONFIG: AppConfig = {
  singleBudgetUsd: 5,
  port: 6789,
  provider: "deepseek",
  writeModelId: "deepseek-v4-pro",
  auditModelId: "deepseek-v4-flash",
  masterPrompt: "",
};

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
      provider: raw.provider === "mimo" || raw.provider === "deepseek"
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
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(configJsonPath: string, config: AppConfig): void {
  fs.writeFileSync(configJsonPath, JSON.stringify(config, null, 2), "utf-8");
}
