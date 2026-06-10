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

/** key 打码:sk-abc...xyz → sk-a****xyz */
export function maskKey(key: string): string {
  if (key.length <= 8) return "****";
  return `${key.slice(0, 5)}****${key.slice(-4)}`;
}
