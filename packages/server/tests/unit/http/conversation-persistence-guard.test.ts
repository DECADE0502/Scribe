import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...listSourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("conversation persistence guard", () => {
  it("server routes do not append conversation rows directly", () => {
    const routesDir = resolve(process.cwd(), "src/http/routes");
    const offenders = listSourceFiles(routesDir)
      .map((file) => ({
        file,
        source: readFileSync(file, "utf-8"),
      }))
      .filter((item) => item.source.includes("conversationsRepo.append"))
      .map((item) => item.file);

    expect(offenders).toEqual([]);
  });

  it("conversation message service is the only production append owner", () => {
    const srcDir = resolve(process.cwd(), "src");
    const offenders = listSourceFiles(srcDir)
      .filter((file) => !file.endsWith("conversation-message-service.ts"))
      .map((file) => ({
        file,
        source: readFileSync(file, "utf-8"),
      }))
      .filter((item) => item.source.includes("conversationsRepo.append"))
      .map((item) => item.file);

    expect(offenders).toEqual([]);
  });
});
