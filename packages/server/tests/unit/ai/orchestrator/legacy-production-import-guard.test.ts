import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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

  it("4-agent orchestrator files stay deleted (task-dispatcher architecture)", () => {
    const deleted = [
      "src/ai/orchestrator/agent-runner.ts",
      "src/ai/orchestrator/main-agent.ts",
      "src/ai/orchestrator/executor-agent.ts",
      "src/ai/orchestrator/validator-agent.ts",
      "src/ai/orchestrator/repair-agent.ts",
      "src/ai/orchestrator/workflow-staging.ts",
      "src/ai/orchestrator/workflow-contract.ts",
      "src/ai/orchestrator/output-sanitize.ts",
      "src/db/repositories/workflow-runs.ts",
    ];
    const revived = deleted.filter((file) => existsSync(resolve(process.cwd(), file)));
    expect(revived).toEqual([]);
  });

  it("task dispatcher pipeline does not import legacy mutation tool registries", () => {
    const files = listSourceFiles(resolve(process.cwd(), "src/ai/tasks"));
    // "write-chapter" 与新任务文件 src/ai/tasks/write-chapter.ts 同名,
    // registry.ts 合法 import 它 —— 从黑名单里排除,只拦截旧模块路径。
    const blockedModules = [...LEGACY_MODULES, ...LEGACY_MUTATION_TOOL_MODULES]
      .filter((name) => name !== "write-chapter");
    const offenders = files.flatMap((file) => {
      const source = readFileSync(file, "utf-8");
      return blockedModules
        .filter((moduleName) => importRegex(moduleName).test(source))
        .map((moduleName) => `${file} -> ${moduleName}`);
    });

    expect(offenders).toEqual([]);
  });
});
