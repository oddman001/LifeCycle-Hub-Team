import { existsSync, readFileSync } from "node:fs";

// Minimal .env loader for the team edition: KEY=VALUE lines, # comments and optional
// single/double quotes. Real environment variables always win, and keys are never logged.
export function loadEnvFile(file, env = process.env) {
  if (!existsSync(file)) return {};
  const loaded = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const [, key, raw] = match;
    let value = raw;
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    if (!value.trim()) continue;
    if (String(env[key] ?? "").trim()) continue;
    env[key] = value;
    loaded[key] = value;
  }
  return loaded;
}
