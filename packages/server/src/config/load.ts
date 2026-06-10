import * as fs from "node:fs";

export interface AppConfig {
  /** 单次自动模式预算上限(USD) */
  singleBudgetUsd: number;
  /** HTTP 端口 */
  port: number;
}

export const DEFAULT_CONFIG: AppConfig = {
  singleBudgetUsd: 5,
  port: 6789,
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
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(configJsonPath: string, config: AppConfig): void {
  fs.writeFileSync(configJsonPath, JSON.stringify(config, null, 2), "utf-8");
}
