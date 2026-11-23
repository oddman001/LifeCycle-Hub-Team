import assert from "node:assert/strict";
import { openDemoDatabase } from "./standalone-db.mjs";
import worker from "./dist/server/index.js";

// Quick-record AI recognition: clothing, device and subscription text intake.
// The AI provider is optional; without configuration the modules keep their local rules.
const d = openDemoDatabase(":memory:");
const origin = "http://localhost";
const baseEnv = { DB: d.DB, LOCAL_INSTANCE: true };
const aiEnv = { ...baseEnv, AI_API_KEY: "test-quick-ai-key" };
const post = (path, data, env = baseEnv) => worker.fetch(new Request(origin + path, {
  method: "POST", headers: { origin }, body: new URLSearchParams(data),
}), env);
const page = async (path, env = baseEnv) => {
  const response = await worker.fetch(new Request(origin + path), env);
  assert.equal(response.status, 200, path);
  return response.text();
};
const nativeFetch = globalThis.fetch;
const calls = [];
const jsonOf = (call) => JSON.parse(call.body);
const aiReply = (value) => Response.json({ output: [{ content: [{ type: "output_text", text: JSON.stringify(value) }] }] });
let scripted = {};
globalThis.fetch = async (url, options) => {
  calls.push({ url, body: options.body, headers: options.headers });
  throw new Error("AI request without a scripted reply");
};

try {
  const itemsBefore = await d.DB.prepare("SELECT count(*) AS n FROM Item").first();

  // 1. No AI configuration: the quick-entry pages say so and the local rules run.
  for (const path of ["/items/clothing/new?mode=quick", "/items/device/new?mode=quick", "/items/subscription/new?mode=quick"]) {
    assert.match(await page(path), /未配置 AI 识别/, path);
  }
  const rulesClothing = await post("/items/clothing/intake", { text: "两年前买了一件羊毛外套，花了399元，经常穿，需要干洗。" });
  assert.equal(rulesClothing.status, 200);
  const rulesClothingHtml = await rulesClothing.text();
  assert.match(rulesClothingHtml, /文字规则提取结果/);
  assert.match(rulesClothingHtml, /value="399"/);
  const rulesDevice = await post("/items/device/new", { operation: "deviceExtract", text: "昨天买了一台笔记本，花了4999元，型号是A1，配置16GB。", timeZone: "Asia/Shanghai" });
  assert.equal(rulesDevice.status, 200);
  const rulesDeviceHtml = await rulesDevice.text();
  assert.match(rulesDeviceHtml, /文字规则提取结果/);
  assert.match(rulesDeviceHtml, /value="4999"/);
  // Reported mismatch: price and material must not leak into the garment name.
  for (const text of ["今天买了一件299元的聚酯纤维的冲锋衣", "今天买了一件299的聚酯纤维的冲锋衣"]) {
    const outfit = await post("/items/clothing/intake", { text });
    assert.equal(outfit.status, 200, text);
    const outfitHtml = await outfit.text();
    assert.match(outfitHtml, /name="name"[^>]*value="冲锋衣"/, text);
    assert.match(outfitHtml, /name="price"[^>]*value="299"/, text);
    assert.match(outfitHtml, /<option selected>外套<\/option>/, text);
    assert.match(outfitHtml, /name="purchaseDay"[^>]*value="\d{4}-\d{2}-\d{2}"/, text);
  }
  // Colloquial care wording must fill the fixed care tags, and negatives must not.
  const care = await post("/items/clothing/intake", { text: "今天买了一件299的冲锋衣,冬天穿,可以机洗" });
  const careHtml = await care.text();
  assert.match(careHtml, /name="name"[^>]*value="冲锋衣"/);
  assert.match(careHtml, /name="price"[^>]*value="299"/);
  assert.match(careHtml, /<option selected>外套<\/option>/);
  assert.match(careHtml, /name="care" value="可机洗" checked/);
  const dryClean = await post("/items/clothing/intake", { text: "买了一件羊毛外套，不可机洗，需要干洗" });
  const dryCleanHtml = await dryClean.text();
  assert.doesNotMatch(dryCleanHtml, /name="care" value="可机洗" checked/);
  assert.match(dryCleanHtml, /name="care" value="需要干洗" checked/);
  const rulesSubscription = await post("/items/subscription/new", { operation: "subscriptionExtract", text: "今天开通了音乐会员，每月25元，不自动续费。", timeZone: "Asia/Shanghai" });
  assert.equal(rulesSubscription.status, 200);
  assert.match(await rulesSubscription.text(), /文字规则提取/);
  assert.equal(calls.length, 0, "no AI request should be sent without configuration");

  // 1b. AI recognition covers the text box only; photo and voice stay opt-in.
  const textOnlyFood = await page("/items/food/intake", aiEnv);
  assert.match(textOnlyFood, /已启用文字 AI 识别/);
  assert.doesNotMatch(textOnlyFood, /识别照片/);
  assert.match(await page("/items/medicine/intake", aiEnv), /已启用文字 AI 识别/);
  const mediaRejected = await post("/items/food/intake", { method: "photo" }, aiEnv);
  assert.equal(mediaRejected.status, 503);
  assert.match(await mediaRejected.text(), /只启用文字 AI 识别/);
  const mediaPage = await page("/items/food/intake", { ...aiEnv, AI_MEDIA: "1" });
  assert.match(mediaPage, /识别照片/);
  assert.match(mediaPage, /转写并提取/);

  // 2. Configured AI: structured extraction is rendered into the review card, nothing is saved yet.
  globalThis.fetch = async (url, options) => {
    const call = { url, body: options.body, headers: options.headers };
    calls.push(call);
    const name = JSON.parse(call.body)?.text?.format?.name;
    assert.ok(scripted[name], "unexpected schema " + name);
    return aiReply(scripted[name]);
  };
  scripted = {
    wardrobe_intake: { name: "羊绒大衣", kind: "外套", brand: "示例品牌", size: "M", color: "驼色",
      material: ["羊毛","羊绒"], frequency: "经常穿", weather: ["晴天"], care: ["需要干洗"],
      location: "主卧衣柜", price: 1299, minTemp: -5, maxTemp: 10, purchaseRaw: "两年前", purchaseDate: null },
    device_intake: { name: "AI 笔记本", deviceType: "笔记本电脑", brand: "示例品牌", model: "X1 Carbon",
      configuration: "16GB/512GB", serialNumber: null, purchaseChannel: "官方商城", purchasePrice: 4999,
      purchasedOn: null, warrantyUntil: null, usageStatus: "using" },
    subscription_intake: { name: "云音乐会员", provider: "示例服务商", subscriptionCategory: "影音",
      billingInterval: "月", fee: 25, autoRenew: true, startsOn: null, nextChargeOn: "2028-01-20",
      cancelBy: null, endsOn: null, lifecycleStatus: "active" },
  };
  const clothing = await post("/items/clothing/intake", { text: "两年前买了一件羊绒大衣，1299元，经常穿，需要干洗，放在主卧衣柜。" }, aiEnv);
  assert.equal(clothing.status, 200);
  const clothingHtml = await clothing.text();
  assert.match(clothingHtml, /AI 识别结果/);
  assert.match(clothingHtml, /name="name"[^>]*value="羊绒大衣"/);
  assert.match(clothingHtml, /name="price"[^>]*value="1299"/);
  assert.match(clothingHtml, /<option selected>外套<\/option>/);
  assert.match(clothingHtml, /<option selected>经常穿<\/option>/);
  assert.match(clothingHtml, /value="羊毛" checked/);
  assert.match(clothingHtml, /value="需要干洗" checked/);
  assert.match(clothingHtml, /识别时间：两年前/);
  assert.ok(!clothingHtml.includes("test-quick-ai-key"), "the API key must never be rendered");
  const wardrobeCall = jsonOf(calls.at(-1));
  assert.match(calls.at(-1).url, /\/v1\/responses$/);
  assert.equal(wardrobeCall.model, "gpt-5.4-mini");
  assert.match(wardrobeCall.instructions, /不得编造/);
  assert.match(JSON.parse(wardrobeCall.input[0].content[0].text).localDate, /^\d{4}-\d{2}-\d{2}$/);

  const device = await post("/items/device/new", { operation: "deviceExtract", text: "昨天买了一台笔记本，4999元，型号X1 Carbon。", timeZone: "Asia/Shanghai" }, aiEnv);
  assert.equal(device.status, 200);
  const deviceHtml = await device.text();
  assert.match(deviceHtml, /AI 识别结果/);
  assert.match(deviceHtml, /name="name" value="AI 笔记本"/);
  assert.match(deviceHtml, /value="4999"/);
  assert.match(deviceHtml, /name="model" value="X1 Carbon"/);
  assert.match(deviceHtml, /<option value="using" selected>/);
  assert.match(deviceHtml, /name="warrantyUntil" value=""/);
  assert.doesNotMatch(deviceHtml, /文字规则提取/);

  const subscription = await post("/items/subscription/new", { operation: "subscriptionExtract", text: "开通了云音乐会员，每月25元，自动续费，下次扣费2028年1月20日。", timeZone: "Asia/Shanghai" }, aiEnv);
  assert.equal(subscription.status, 200);
  const subscriptionHtml = await subscription.text();
  assert.match(subscriptionHtml, /AI 识别/);
  assert.match(subscriptionHtml, /name="fee" value="25"/);
  assert.match(subscriptionHtml, /name="nextChargeOn" value="2028-01-20"/);
  assert.match(subscriptionHtml, /<option value="yes" selected>/);
  assert.match(subscriptionHtml, /<option selected>月<\/option>/);

  // An AI answer that misses a tag must still show tags explicitly present in the text.
  scripted.wardrobe_intake = { name: "冲锋衣", kind: "外套", brand: null, size: null, color: null,
    material: [], frequency: null, weather: [], care: [], location: null, price: 299,
    minTemp: null, maxTemp: null, purchaseRaw: null, purchaseDate: null };
  const merged = await post("/items/clothing/intake", { text: "买了一件299的冲锋衣，可以机洗" }, aiEnv);
  const mergedHtml = await merged.text();
  assert.match(mergedHtml, /AI 识别结果/);
  assert.match(mergedHtml, /name="care" value="可机洗" checked/);

  // Review cards must not write records before the user confirms.
  assert.deepEqual(await d.DB.prepare("SELECT count(*) AS n FROM Item").first(), itemsBefore);

  // 3. AI failures fall back to the local rules instead of blocking the quick record.
  globalThis.fetch = async () => new Response("upstream error", { status: 500 });
  const failedDevice = await post("/items/device/new", { operation: "deviceExtract", text: "昨天买了一台笔记本，花了4999元，型号是A1。", timeZone: "Asia/Shanghai" }, aiEnv);
  assert.equal(failedDevice.status, 200);
  const failedDeviceHtml = await failedDevice.text();
  assert.match(failedDeviceHtml, /文字规则提取结果/);
  assert.match(failedDeviceHtml, /已改用本地规则/);
  assert.match(failedDeviceHtml, /value="4999"/);

  globalThis.fetch = async () => Response.json({ output: [{ content: [{ type: "output_text", text: "这不是 JSON" }] }] });
  const failedClothing = await post("/items/clothing/intake", { text: "两年前买了一件羊毛外套，花了399元。" }, aiEnv);
  assert.equal(failedClothing.status, 200);
  const failedClothingHtml = await failedClothing.text();
  assert.match(failedClothingHtml, /文字规则提取结果/);
  assert.match(failedClothingHtml, /已改用本地规则/);
  assert.match(failedClothingHtml, /value="399"/);

  // 4. Non-OpenAI compatible gateways use Chat Completions JSON mode with the configured model.
  globalThis.fetch = async (url, options) => {
    calls.push({ url, body: options.body, headers: options.headers });
    assert.match(url, /^https:\/\/api\.example\.cn\/v1\/chat\/completions$/);
    assert.equal(options.headers.authorization, "Bearer chat-key");
    const body = JSON.parse(options.body);
    assert.equal(body.model, "example-chat");
    assert.deepEqual(body.response_format, { type: "json_object" });
    assert.match(body.messages[1].content, /4999/);
    const value = { name: "网关笔记本", deviceType: "笔记本", brand: null, model: "G1", configuration: null,
      serialNumber: null, purchaseChannel: null, purchasePrice: 4999, purchasedOn: null, warrantyUntil: null, usageStatus: null };
    return Response.json({ choices: [{ message: { content: "```json\n" + JSON.stringify(value) + "\n```" } }] });
  };
  const chatEnv = { ...baseEnv, AI_API_KEY: "chat-key", AI_BASE_URL: "https://api.example.cn/v1", AI_MODEL: "example-chat" };
  assert.match(await page("/items/device/new?mode=quick", chatEnv), /已启用 AI 识别/);
  const chatDevice = await post("/items/device/new", { operation: "deviceExtract", text: "买了一台笔记本，4999元。", timeZone: "Asia/Shanghai" }, chatEnv);
  assert.equal(chatDevice.status, 200);
  const chatDeviceHtml = await chatDevice.text();
  assert.match(chatDeviceHtml, /AI 识别结果/);
  assert.match(chatDeviceHtml, /name="name" value="网关笔记本"/);
  assert.match(chatDeviceHtml, /value="4999"/);

  // 4b. DeepSeek-compatible gateways pick their own model id when AI_MODEL is absent.
  globalThis.fetch = async (url, options) => {
    calls.push({ url, body: options.body, headers: options.headers });
    assert.match(url, /^https:\/\/api\.deepseek\.com\/v1\/chat\/completions$/);
    const body = JSON.parse(options.body);
    assert.equal(body.model, "deepseek-chat");
    const value = { name: "深寻冲锋衣", kind: "外套", brand: null, size: null, color: null,
      material: [], frequency: null, weather: [], care: [], location: null, price: null,
      minTemp: null, maxTemp: null, purchaseRaw: null, purchaseDate: null };
    return Response.json({ choices: [{ message: { content: JSON.stringify(value) } }] });
  };
  const deepseekEnv = { ...baseEnv, OPENAI_API_KEY: "deepseek-key", OPENAI_BASE_URL: "https://api.deepseek.com/v1" };
  const deepseek = await post("/items/clothing/intake", { text: "买了一件冲锋衣" }, deepseekEnv);
  assert.equal(deepseek.status, 200);
  assert.match(await deepseek.text(), /name="name"[^>]*value="深寻冲锋衣"/);

  // 5. Invalid input still fails cleanly before any AI call.
  globalThis.fetch = async () => { throw new Error("should not be called"); };
  const empty = await post("/items/subscription/new", { operation: "subscriptionExtract", text: "" }, aiEnv);
  assert.equal(empty.status, 400);
  assert.match(await empty.text(), /1 至 2000 个字符/);

  console.log("Quick record AI passed: AI extraction for clothing/device/subscription, local rule fallback, chat-compatible gateways and review-only writes.");
} finally {
  globalThis.fetch = nativeFetch;
  d.close();
}
