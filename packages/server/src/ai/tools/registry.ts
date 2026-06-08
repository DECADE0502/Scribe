import type { Tool } from "ai";
import {
  makeGenreSectionTools,
  type GenreToolsDeps,
} from "./genre-section-tools.js";

export interface ToolRegistryDeps {
  genreToolsDeps?: GenreToolsDeps;
}

/**
 * 构建工具注册表,返回 Vercel AI SDK 的 tools 对象。
 * 调用方按需注入 deps,缺失的 deps 对应工具不会出现在 registry 中。
 */
export function buildToolRegistry(
  deps: ToolRegistryDeps,
): Record<string, Tool> {
  const tools: Record<string, Tool> = {};
  if (deps.genreToolsDeps) {
    Object.assign(tools, makeGenreSectionTools(deps.genreToolsDeps));
  }
  return tools;
}
