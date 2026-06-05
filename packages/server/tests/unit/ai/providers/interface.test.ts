import { describe, it, expectTypeOf } from "vitest";
import type { ProviderAdapter } from "../../../../src/ai/providers/_interface.js";

describe("ProviderAdapter type", () => {
  it("有 6 个公开方法/属性", () => {
    expectTypeOf<keyof ProviderAdapter>().toEqualTypeOf<
      "id" | "listModels" | "enrichModel" | "testToolUse" | "createModel" | "classifyError"
    >();
  });
});
