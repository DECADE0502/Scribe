import * as fs from "node:fs";

/** 读 secrets.env(KEY=VALUE 每行一条) */
export function loadSecrets(secretsEnvPath: string): Record<string, string> {
  if (!fs.existsSync(secretsEnvPath)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(secretsEnvPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

/** 写/更新单个 secret,保留其它行 */
export function saveSecret(secretsEnvPath: string, key: string, value: string): void {
  const secrets = loadSecrets(secretsEnvPath);
  secrets[key] = value;
  const content = Object.entries(secrets).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
  fs.writeFileSync(secretsEnvPath, content, { encoding: "utf-8", mode: 0o600 });
}

function secretSegment(value: string): string {
  const out: string[] = [];
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code >= 48 && code <= 57) {
      out.push(char);
    } else if (code >= 65 && code <= 90) {
      out.push(char);
    } else if (code >= 97 && code <= 122) {
      out.push(char.toUpperCase());
    } else {
      out.push("_");
    }
  }
  return out.join("") || "UNKNOWN";
}

export function providerSecretName(providerId: string): string {
  if (providerId === "mimo") return "MIMO_API_KEY";
  if (providerId === "deepseek") return "DEEPSEEK_API_KEY";
  if (providerId === "anyrouter") return "ANYROUTER_API_KEY";
  return `CUSTOM_PROVIDER_${secretSegment(providerId)}_API_KEY`;
}

/** key 打码:sk-abc...xyz → sk-a****xyz */
export function maskKey(key: string): string {
  if (key.length <= 8) return "****";
  return `${key.slice(0, 5)}****${key.slice(-4)}`;
}
