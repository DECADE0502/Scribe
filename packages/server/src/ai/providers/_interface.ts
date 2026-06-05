import type { LanguageModel } from "ai";
import type { ModelInfo, ErrorClass } from "@scribe/shared";

export interface ModelOpts {
  apiKey: string;
  baseUrl?: string;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface ProviderAdapter {
  id: string;
  listModels(): Promise<ModelInfo[]>;
  enrichModel(modelId: string): Promise<ModelInfo>;
  testToolUse(modelId: string, opts: ModelOpts): Promise<boolean>;
  createModel(modelId: string, opts: ModelOpts): LanguageModel;
  classifyError(err: unknown): ErrorClass;
}
