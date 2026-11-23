import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnvFile } from "./env-file.mjs";

const dir = mkdtempSync(join(tmpdir(), "lifecycle-env-"));
const file = join(dir, ".env");
writeFileSync(file, [
  "# comment line",
  "OPENAI_API_KEY=sk-test-123",
  'OPENAI_BASE_URL="https://api.deepseek.com/v1"',
  "EMPTY=",
  "EXISTING=from-file",
  "export AI_MODEL=deepseek-chat",
].join("\n"), "utf8");

const env = { EXISTING: "keep-me" };
const loaded = loadEnvFile(file, env);
assert.equal(env.OPENAI_API_KEY, "sk-test-123");
assert.equal(env.OPENAI_BASE_URL, "https://api.deepseek.com/v1");
assert.equal(env.AI_MODEL, "deepseek-chat");
assert.equal(env.EXISTING, "keep-me", "real environment variables must win");
assert.equal(env.EMPTY, undefined, "empty values are ignored");
assert.equal(loaded.OPENAI_API_KEY, "sk-test-123");
assert.deepEqual(loadEnvFile(join(dir, "missing.env"), {}), {});
console.log("Env file passed: comments, quotes, export prefix, empty values, precedence and missing file.");
