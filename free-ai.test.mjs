import assert from "node:assert/strict";
import { openDemoDatabase } from "./standalone-db.mjs";
import worker from "./dist/server/index.js";

// Free-model presets: AI_PROVIDER=ollama runs a local model without any key, and the
// zhipu/openrouter presets use their free tiers. An explicit model override still wins.
const d = openDemoDatabase(":memory:");
const origin = "http://localhost";
const base = { DB: d.DB, LOCAL_INSTANCE: true };
const deviceValue = { name: "免费笔记本", deviceType: "笔记本电脑", brand: null, model: "F1",
  configuration: null, serialNumber: null, purchaseChannel: null, purchasePrice: 3999,
  purchasedOn: null, warrantyUntil: null, usageStatus: null };
const nativeFetch = globalThis.fetch;
const calls = [];
const chatReply = (value) => Response.json({ choices: [{ message: { content: JSON.stringify(value) } }] });
const page = async (path, env) => {
  const response = await worker.fetch(new Request(origin + path), env);
  assert.equal(response.status, 200, path);
  return response.text();
};
const extract = (env, text = "买了一台笔记本，3999元。") => worker.fetch(new Request(origin + "/items/device/new", {
  method: "POST", headers: { origin },
  body: new URLSearchParams({ operation: "deviceExtract", text, timeZone: "Asia/Shanghai" }),
}), env);

try {
  globalThis.fetch = async (url, options) => {
    calls.push({ url, headers: options.headers, body: options.body });
    return chatReply(deviceValue);
  };

  // 1. Local Ollama: no key at all, Chat Completions JSON mode, loopback URL.
  const ollama = { ...base, AI_PROVIDER: "ollama" };
  assert.match(await page("/items/device/new?mode=quick", ollama), /免费模型 · 本地 Ollama · qwen2\.5:7b/);
  assert.match(await page("/items/food/intake", ollama),
    /已启用文字 AI 识别（免费模型 · 本地 Ollama · qwen2\.5:7b）/);
  const ollamaResult = await extract(ollama);
  assert.equal(ollamaResult.status, 200);
  assert.match(await ollamaResult.text(), /AI 识别结果/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://127.0.0.1:11434/v1/chat/completions");
  assert.equal(calls[0].headers.authorization, undefined, "a keyless local model must not receive Authorization");
  assert.equal(JSON.parse(calls[0].body).model, "qwen2.5:7b");
  assert.deepEqual(JSON.parse(calls[0].body).response_format, { type: "json_object" });

  // 2. Zhipu's free GLM-4-Flash tier: preset endpoint and model, key still sent.
  calls.length = 0;
  const zhipu = { ...base, AI_PROVIDER: "zhipu", AI_API_KEY: "zhipu-key" };
  assert.match(await page("/items/subscription/new?mode=quick", zhipu), /免费模型 · 智谱 GLM · glm-4-flash/);
  const zhipuResult = await extract(zhipu);
  assert.equal(zhipuResult.status, 200);
  const zhipuHtml = await zhipuResult.text();
  assert.match(zhipuHtml, /AI 识别结果/);
  assert.ok(!zhipuHtml.includes("zhipu-key"), "the API key must never be rendered");
  assert.equal(calls[0].url, "https://open.bigmodel.cn/api/paas/v4/chat/completions");
  assert.equal(calls[0].headers.authorization, "Bearer zhipu-key");
  assert.equal(JSON.parse(calls[0].body).model, "glm-4-flash");

  // 3. OpenRouter's ":free" model preset.
  calls.length = 0;
  const openrouter = { ...base, AI_PROVIDER: "openrouter", AI_API_KEY: "router-key" };
  assert.match(await page("/items/clothing/new?mode=quick", openrouter),
    /免费模型 · OpenRouter · meta-llama\/llama-3\.3-70b-instruct:free/);
  await extract(openrouter);
  assert.equal(calls[0].url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(JSON.parse(calls[0].body).model, "meta-llama/llama-3.3-70b-instruct:free");
  assert.equal(calls[0].headers.authorization, "Bearer router-key");

  // 4. AI_MODEL overrides the preset model, and the label follows.
  calls.length = 0;
  const custom = { ...base, AI_PROVIDER: "ollama", AI_MODEL: "gpt-oss:20b" };
  assert.match(await page("/items/device/new?mode=quick", custom), /免费模型 · 本地 Ollama · gpt-oss:20b/);
  await extract(custom);
  assert.equal(JSON.parse(calls[0].body).model, "gpt-oss:20b");

  console.log("Free AI passed: keyless local Ollama preset, zhipu GLM-4-Flash, OpenRouter :free model, and AI_MODEL overrides.");
} finally {
  globalThis.fetch = nativeFetch;
  d.close();
}
