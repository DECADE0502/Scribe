import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 内置 SillyTavern 导入示例。JSON 原文随服务端打包在 ./samples/ 下,
 * 运行时按需读取(避免 tsc 把几百 KB 的 JSON 当成巨型字面量类型拖慢编译)。
 */
const samplesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "samples");

export interface BuiltinSample {
  id: string;
  name: string;
  filename: string;
  description: string;
}

export const BUILTIN_SAMPLES: BuiltinSample[] = [
  {
    id: "izumi-preset",
    name: "Izumi 0503(SillyTavern 预设)",
    filename: "izumi-preset.json",
    description: "泉此方 Izumi 预设:203 个提示块,演示按 prompt_order 顺序 + 逐块开关注入。",
  },
  {
    id: "pet-worldbook",
    name: "宠物捕捉系统(世界书)",
    filename: "pet-worldbook.json",
    description: "现代都市奇幻世界书:38 条,演示常驻/关键词触发/优先级排序与逐条开关。",
  },
];

export function getBuiltinSample(id: string): BuiltinSample | undefined {
  return BUILTIN_SAMPLES.find((s) => s.id === id);
}

/** 读取某个内置示例的原始 JSON(供导入流水线消费)。文件缺失时抛错。 */
export function readBuiltinSampleJson(sample: BuiltinSample): { filename: string; json: unknown } {
  const raw = fs.readFileSync(path.join(samplesDir, sample.filename), "utf-8");
  return { filename: sample.filename, json: JSON.parse(raw) as unknown };
}
