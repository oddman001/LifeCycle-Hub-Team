import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import worker, { resolveFoodDates } from "./test-results/legacy-worker/index.js";

const sqlite = new DatabaseSync(":memory:");
for (const file of ["0000_initial", "0001_food_stock", "0002_food_lifecycle", "0003_food_intake",
  "0004_food_dates", "0005_food_compound", "0006_drug_m1", "0007_drug_m2", "0008_drug_m3",
  "0009_food_portions", "0010_record_deletion", "0013_wardrobe", "0014_device_lifecycle",
  "0015_subscription_lifecycle"]) sqlite.exec(readFileSync(`drizzle/${file}.sql`, "utf8"));
function statement(sql, params = []) {
  return {
    bind: (...values) => statement(sql, values),
    first: async () => sqlite.prepare(sql).get(...params),
    all: async () => ({ results: sqlite.prepare(sql).all(...params) }),
    run: () => sqlite.prepare(sql).columns().length
      ? { results: sqlite.prepare(sql).all(...params) }
      : { meta: sqlite.prepare(sql).run(...params) },
  };
}
const DB = {
  prepare: statement,
  async batch(queries) {
    sqlite.exec("BEGIN");
    try {
      const result = queries.map((query) => query.run());
      sqlite.exec("COMMIT");
      return result;
    } catch (error) {
      sqlite.exec("ROLLBACK");
      throw error;
    }
  },
};
const origin = "https://expiry.test";
const base = "/items/food";
const post = (path, fields) => worker.fetch(new Request(origin + path, {
  method: "POST", body: new URLSearchParams(fields), headers: { origin },
}), { DB });
const relative = (offset) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" })
  .format(new Date(Date.now() + offset * 86400000));
const review = async (text) => {
  const response = await post(base + "/intake", { method: "text", text, timeZone: "Asia/Shanghai" });
  assert.equal(response.status, 200, text);
  return response.text();
};

// 1. 保质期时长：天、周、月、年、半年都换算成天数，并从生产日期起算。
for (const [text, days] of [["保质期45天", 45], ["保质期两周", 14], ["保质期6个月", 180],
  ["保质期一年", 365], ["保质期半年", 182], ["保存期 3 个月", 90]]) {
  const parsed = resolveFoodDates(text, "2026-11-16");
  assert.equal(parsed.shelfLifeDays, days, text);
  assert.equal(parsed.shelfLifeBase, "production", text);
  assert.equal(parsed.expiresOn, "", text);
}
assert.match(resolveFoodDates("保质期6个月", "2026-11-16").dateEvidence, /每月 30 天/);
assert.doesNotMatch(resolveFoodDates("保质期45天", "2026-11-16").dateEvidence, /每月 30 天/);
// 2. 带“保质期到/有效期到”的明确到期日期。
for (const [text, expires] of [["保质期到2026年12月31日", "2026-12-31"],
  ["有效期到2027年1月5日", "2027-01-05"], ["保存期至2026/12/20", "2026-12-20"]]) {
  assert.equal(resolveFoodDates(text, "2026-11-16").expiresOn, expires, text);
}
assert.equal(resolveFoodDates("10天后过期", "2026-11-16").expiresOn, "2026-11-26");

// 3. 文字识别：数量、名称和保质期同时出现在一句话里。
const milk = await review("买了一箱伊利纯牛奶，保质期6个月");
assert.match(milk, /name="candidate-0-name" value="伊利纯牛奶"/);
assert.match(milk, /name="candidate-0-purchasedAmount" value="1"/);
assert.match(milk, /name="candidate-0-unit" value="箱"/);
assert.match(milk, /name="candidate-0-shelfLifeDays" value="180"/);
assert.match(milk, /name="candidate-0-shelfLifeBase"[\s\S]{0,120}<option value="production" selected>/);
assert.match(milk, /name="candidate-0-expiresOn" value=""/);
const bread = await review("面包保质期到2026年12月31日");
assert.match(bread, /name="candidate-0-name" value="面包"/);
assert.match(bread, /name="candidate-0-expiresOn" value="2026-12-31"/);
const produced = await review("买了牛奶，生产日期2026年11月1日，保质期21天");
assert.match(produced, /name="candidate-0-name" value="牛奶"/);
assert.match(produced, /name="candidate-0-producedOn" value="2026-11-01"/);
assert.match(produced, /name="candidate-0-expiresOn" value="2026-11-22"/);

// 4. 长段口语：多个物品要拆开，物品名称不能被叙述片段顶替。
const narrative = await review("今天下午下班路过超市，看到伊利纯牛奶在打折，就顺手买了一箱，回家放进冰箱冷藏。" +
  "另外还买了两袋全麦面包和一把香蕉，放在餐桌上。");
for (const [name, amount, unit] of [["伊利纯牛奶", "1", "箱"], ["全麦面包", "2", "袋"], ["香蕉", "1", "把"]]) {
  assert.match(narrative, new RegExp(`name="candidate-\\d-name" value="${name}"`), name);
  const index = narrative.match(new RegExp(`name="candidate-(\\d)-name" value="${name}"`))[1];
  assert.match(narrative, new RegExp(`name="candidate-${index}-purchasedAmount" value="${amount}"`), name);
  assert.match(narrative, new RegExp(`name="candidate-${index}-unit" value="${unit}"`), name);
}
assert.doesNotMatch(narrative, /candidate-\d-name" value="[^"]*(下班|超市|冰箱|餐桌)/);

// 5. 手动录入：保质期时长可以从生产日期或购买日期起算并保存。
const fromProduction = await post(base + "/new", {
  name: "手工酸奶", purchasedAmount: "2", unit: "盒", locationId: "fridge",
  expiryMode: "duration", shelfLifeBase: "production", producedOn: relative(-10), shelfLifeDays: "180",
});
assert.equal(fromProduction.status, 303, "production-based duration saves");
let saved = sqlite.prepare("SELECT f.shelfLifeDays,f.shelfLifeBase,f.expiresOn,f.expirySource FROM FoodDetail f " +
  "JOIN FoodItem p ON p.id=f.foodId WHERE p.name='手工酸奶'").get();
assert.deepEqual({ ...saved }, { shelfLifeDays: 180, shelfLifeBase: "production", expiresOn: relative(170), expirySource: "shelf" });
const fromPurchase = await post(base + "/new", {
  name: "手工面包", purchasedAmount: "1", unit: "袋", locationId: "cupboard", purchasedOn: relative(-5),
  expiryMode: "duration", shelfLifeBase: "purchase", shelfLifeDays: "30",
});
assert.equal(fromPurchase.status, 303, "purchase-based duration saves");
saved = sqlite.prepare("SELECT f.shelfLifeDays,f.shelfLifeBase,f.expiresOn FROM FoodDetail f " +
  "JOIN FoodItem p ON p.id=f.foodId WHERE p.name='手工面包'").get();
assert.deepEqual({ ...saved }, { shelfLifeDays: 30, shelfLifeBase: "purchase", expiresOn: relative(25) });
const missingProduction = await post(base + "/new", {
  name: "缺生产日期", purchasedAmount: "1", unit: "盒", locationId: "fridge",
  expiryMode: "duration", shelfLifeBase: "production", shelfLifeDays: "30",
});
assert.equal(missingProduction.status, 400, "production-based duration still needs a production date");
console.log("Expiry intake passed: month/year shelf life, labelled expiry dates, long narrative item names and duration entry.");
