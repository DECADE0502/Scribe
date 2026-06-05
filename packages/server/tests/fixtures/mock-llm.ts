import type { ProviderAdapter } from "../../src/ai/providers/_interface.js";

export interface MockLLMOpts {
  chunks?: string[];
  throwOn?: "stream" | "doStream";
  errorMessage?: string;
}

export function makeStubLanguageModel(opts: MockLLMOpts = {}): any {
  const chunks = opts.chunks ?? ["默", "认", "正文"];
  return {
    specificationVersion: "v1",
    provider: "stub",
    modelId: "stub-model",
    async doGenerate() {
      throw new Error("stub does not support doGenerate");
    },
    async doStream() {
      if (opts.throwOn === "doStream") {
        throw new Error(opts.errorMessage ?? "stub error");
      }
      return {
        stream: new ReadableStream({
          start(ctrl) {
            if (opts.throwOn === "stream") {
              ctrl.error(new Error(opts.errorMessage ?? "stream error"));
              return;
            }
            for (const ch of chunks) {
              ctrl.enqueue({ type: "text-delta", textDelta: ch });
            }
            ctrl.enqueue({
              type: "finish",
              finishReason: "stop",
              usage: { promptTokens: 5, completionTokens: chunks.length },
            });
            ctrl.close();
          },
        }),
        rawCall: { rawPrompt: null, rawSettings: {} },
      };
    },
  };
}

export function makeMockProvider(chunks: string[]): ProviderAdapter {
  return {
    id: "mock",
    async listModels() {
      return [{ id: "stub-model" }];
    },
    async enrichModel(id) {
      return { id };
    },
    async testToolUse() {
      return false;
    },
    createModel() {
      return makeStubLanguageModel({ chunks });
    },
    classifyError() {
      return "unknown";
    },
  };
}
