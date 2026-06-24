import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const LEGACY_MODULES = [
  "conversation-orchestrator",
  "new-book",
  "worldbook-chat",
  "revise-segment",
  "write-chapter",
  "write-with-audit",
  "repair-chapter",
  "record-state",
  "delete-chapter",
];

const LEGACY_MUTATION_TOOL_MODULES = [
  "book-meta-tools",
  "worldbook-tools",
  "state-tools",
  "registry",
];

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...listSourceFiles(full));
    else if (/\.ts$/.test(entry)) out.push(full);
  }
  return out;
}

function importRegex(moduleName: string): RegExp {
  return new RegExp(`from\\s+["'][^"']*/${moduleName}\\.js["']`);
}

describe("legacy production import guard", () => {
  it("HTTP routes do not import legacy AI orchestrators", () => {
    const files = listSourceFiles(resolve(process.cwd(), "src/http/routes"));
    const offenders = files.flatMap((file) => {
      const source = readFileSync(file, "utf-8");
      return LEGACY_MODULES
        .filter((moduleName) => importRegex(moduleName).test(source))
        .map((moduleName) => `${file} -> ${moduleName}`);
    });

    expect(offenders).toEqual([]);
  });

  it("current agent pipeline does not import legacy orchestrators or mutation tool registries", () => {
    const files = [
      "src/ai/orchestrator/agent-runner.ts",
      "src/ai/orchestrator/main-agent.ts",
      "src/ai/orchestrator/executor-agent.ts",
      "src/ai/orchestrator/validator-agent.ts",
      "src/ai/orchestrator/repair-agent.ts",
    ].map((file) => resolve(process.cwd(), file));

    const blockedModules = [...LEGACY_MODULES, ...LEGACY_MUTATION_TOOL_MODULES];
    const offenders = files.flatMap((file) => {
      const source = readFileSync(file, "utf-8");
      return blockedModules
        .filter((moduleName) => importRegex(moduleName).test(source))
        .map((moduleName) => `${file} -> ${moduleName}`);
    });

    expect(offenders).toEqual([]);
  });
});
