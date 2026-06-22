import type { LanguageModel } from "ai";
import type { ModelInfo } from "@scribe/shared";
import { AnyRouterProvider } from "./providers/anyrouter.js";
import { CustomOpenAICompatibleProvider } from "./providers/custom-openai-compatible.js";
import { DeepSeekProvider } from "./providers/deepseek.js";
import { MiMoProvider } from "./providers/mimo.js";
import type { ProviderAdapter } from "./providers/_interface.js";
import { lookupLocal } from "./providers/local-model-table.js";
import type { CustomProviderConfig } from "../config/load.js";

export type ProviderId = string;

export interface ModelManagerState {
  provider: ProviderId;
  apiKey: string | null;
  writeModelId: string;
  auditModelId: string;
  customProviders: CustomProviderConfig[];
  /** 全局「最深处提示词」(热配置) */
  masterPrompt: string;
}

export interface ModelManager {
  getModel(): LanguageModel | undefined;
  getAuditModel(): LanguageModel | undefined;
  getWriteModelInfo(): ModelInfo;
  getAuditModelInfo(): ModelInfo;
  getState(): ModelManagerState;
  /** 全局最深处提示词(热配置) */
  getMasterPrompt(): string;
  /** UI 保存设置后调用,热生效 */
  configure(patch: Partial<ModelManagerState>): void;
  /** 实时拉模型列表(无 key 时抛错) */
  listModels(): Promise<ModelInfo[]>;
}

const DEFAULT_WRITE_MODEL = "gemini-2.5-pro";
const DEFAULT_AUDIT_MODEL = "gemini-2.5-pro";

/**
 * 根据给定的供应商/Key/自定义供应商构建一个 provider adapter。
 * 纯函数,不依赖任何全局状态——既给全局单例 ModelManager 用,
 * 也给「预览列模型」这类一次性、不落盘的场景复用。
 */
export function buildProvider(opts: {
  provider: ProviderId;
  apiKey: string | null;
  customProviders?: CustomProviderConfig[];
}): ProviderAdapter | undefined {
  if (!opts.apiKey) return undefined;
  if (opts.provider === "mimo") return new MiMoProvider({ apiKey: opts.apiKey });
  if (opts.provider === "deepseek") return new DeepSeekProvider({ apiKey: opts.apiKey });
  const custom = (opts.customProviders ?? []).find((item) => item.id === opts.provider);
  if (custom) {
    return new CustomOpenAICompatibleProvider({
      id: custom.id,
      baseUrl: custom.baseUrl,
      auth: custom.auth,
      apiKey: opts.apiKey,
    });
  }
  return new AnyRouterProvider({ apiKey: opts.apiKey });
}

/** 一次性列出某套配置下的可用模型,不触碰任何全局状态。无 key 时抛错。 */
export async function listModelsFor(opts: {
  provider: ProviderId;
  apiKey: string | null;
  customProviders?: CustomProviderConfig[];
}): Promise<ModelInfo[]> {
  const p = buildProvider(opts);
  if (!p) throw new Error("未配置 API Key");
  return p.listModels();
}

export function createModelManager(initial?: Partial<ModelManagerState>): ModelManager {
  const state: ModelManagerState = {
    provider: initial?.provider ?? "anyrouter",
    apiKey: initial?.apiKey ?? null,
    writeModelId: initial?.writeModelId ?? DEFAULT_WRITE_MODEL,
    auditModelId: initial?.auditModelId ?? DEFAULT_AUDIT_MODEL,
    customProviders: initial?.customProviders ?? [],
    masterPrompt: initial?.masterPrompt ?? "",
  };

  function provider(): ProviderAdapter | undefined {
    return buildProvider({
      provider: state.provider,
      apiKey: state.apiKey,
      customProviders: state.customProviders,
    });
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
    getMasterPrompt() { return state.masterPrompt; },
    configure(patch) {
      if (patch.provider) state.provider = patch.provider;
      if (patch.apiKey !== undefined) state.apiKey = patch.apiKey;
      if (patch.writeModelId) state.writeModelId = patch.writeModelId;
      if (patch.auditModelId) state.auditModelId = patch.auditModelId;
      if (patch.customProviders) state.customProviders = patch.customProviders;
      if (patch.masterPrompt !== undefined) state.masterPrompt = patch.masterPrompt;
    },
    async listModels() {
      const p = provider();
      if (!p) throw new Error("未配置 API Key");
      return p.listModels();
    },
  };
}
