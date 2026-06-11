import type { LanguageModel } from "ai";
import type { ModelInfo } from "@scribe/shared";
import { DeepSeekProvider } from "./providers/deepseek.js";
import { MiMoProvider } from "./providers/mimo.js";
import type { ProviderAdapter } from "./providers/_interface.js";
import { lookupLocal } from "./providers/local-model-table.js";

export type ProviderId = "deepseek" | "mimo";

export interface ModelManagerState {
  provider: ProviderId;
  apiKey: string | null;
  writeModelId: string;
  auditModelId: string;
}

export interface ModelManager {
  getModel(): LanguageModel | undefined;
  getAuditModel(): LanguageModel | undefined;
  getWriteModelInfo(): ModelInfo;
  getAuditModelInfo(): ModelInfo;
  getState(): ModelManagerState;
  /** UI 保存设置后调用,热生效 */
  configure(patch: Partial<ModelManagerState>): void;
  /** 实时拉模型列表(无 key 时抛错) */
  listModels(): Promise<ModelInfo[]>;
}

const DEFAULT_WRITE_MODEL = "deepseek-v4-pro";
const DEFAULT_AUDIT_MODEL = "deepseek-v4-flash";

export function createModelManager(initial?: Partial<ModelManagerState>): ModelManager {
  const state: ModelManagerState = {
    provider: initial?.provider ?? "deepseek",
    apiKey: initial?.apiKey ?? null,
    writeModelId: initial?.writeModelId ?? DEFAULT_WRITE_MODEL,
    auditModelId: initial?.auditModelId ?? DEFAULT_AUDIT_MODEL,
  };

  function provider(): ProviderAdapter | undefined {
    if (!state.apiKey) return undefined;
    return state.provider === "mimo"
      ? new MiMoProvider({ apiKey: state.apiKey })
      : new DeepSeekProvider({ apiKey: state.apiKey });
  }

  function infoFor(modelId: string): ModelInfo {
    return { id: modelId, ...(lookupLocal(modelId) ?? {}) };
  }

  return {
    getModel() {
      const p = provider();
      return p ? p.createModel(state.writeModelId, { apiKey: state.apiKey! }) : undefined;
    },
    getAuditModel() {
      const p = provider();
      return p ? p.createModel(state.auditModelId, { apiKey: state.apiKey! }) : undefined;
    },
    getWriteModelInfo() { return infoFor(state.writeModelId); },
    getAuditModelInfo() { return infoFor(state.auditModelId); },
    getState() { return { ...state }; },
    configure(patch) {
      if (patch.provider) state.provider = patch.provider;
      if (patch.apiKey !== undefined) state.apiKey = patch.apiKey;
      if (patch.writeModelId) state.writeModelId = patch.writeModelId;
      if (patch.auditModelId) state.auditModelId = patch.auditModelId;
    },
    async listModels() {
      const p = provider();
      if (!p) throw new Error("未配置 API Key");
      return p.listModels();
    },
  };
}
