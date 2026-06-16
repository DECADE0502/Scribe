import type { SillyTavernRegexScript } from "@scribe/shared";

export interface RegexScriptApplyOptions {
  target: "prompt" | "output";
  depth: number;
}

export interface AppliedRegexScript {
  id?: string;
  scriptName?: string;
}

export interface RegexScriptApplyResult {
  text: string;
  applied: AppliedRegexScript[];
  skipped: AppliedRegexScript[];
}

function parseRegex(source: string | undefined): RegExp | undefined {
  if (!source) return undefined;
  const slash = source.match(/^\/(.*)\/([a-z]*)$/i);
  if (slash) {
    return new RegExp(slash[1]!, slash[2]);
  }
  return new RegExp(source, "g");
}

function isTargetAllowed(
  script: SillyTavernRegexScript,
  target: RegexScriptApplyOptions["target"],
): boolean {
  if (target === "prompt") return script.promptOnly !== false;
  return script.promptOnly !== true;
}

function isDepthAllowed(
  script: SillyTavernRegexScript,
  depth: number,
): boolean {
  if (typeof script.minDepth === "number" && depth < script.minDepth) return false;
  if (typeof script.maxDepth === "number" && depth > script.maxDepth) return false;
  return true;
}

export function applySillyTavernRegexScripts(
  text: string,
  scripts: SillyTavernRegexScript[],
  options: RegexScriptApplyOptions,
): RegexScriptApplyResult {
  let next = text;
  const applied: AppliedRegexScript[] = [];
  const skipped: AppliedRegexScript[] = [];
  for (const script of scripts) {
    const marker = { id: script.id, scriptName: script.scriptName };
    if (
      script.disabled ||
      !isTargetAllowed(script, options.target) ||
      !isDepthAllowed(script, options.depth)
    ) {
      skipped.push(marker);
      continue;
    }
    const regex = parseRegex(script.findRegex);
    if (!regex) {
      skipped.push(marker);
      continue;
    }
    next = next.replace(regex, script.replaceString ?? "");
    applied.push(marker);
  }
  return { text: next, applied, skipped };
}
