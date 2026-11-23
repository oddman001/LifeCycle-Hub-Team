import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import worker, { resolveFoodDates } from "./test-results/legacy-worker/index.js";
import hostedDemo from "./dist/server/index.js";
import { parseQuantity } from "./quantity.mjs";

const sqlite = new DatabaseSync(":memory:");
sqlite.exec(readFileSync("drizzle/0000_initial.sql", "utf8"));
sqlite.exec(readFileSync("drizzle/0001_food_stock.sql", "utf8"));
sqlite.exec(readFileSync("drizzle/0002_food_lifecycle.sql", "utf8"));
sqlite.exec(readFileSync("drizzle/0003_food_intake.sql", "utf8"));
sqlite.exec(readFileSync("drizzle/0004_food_dates.sql", "utf8"));
sqlite.exec(readFileSync("drizzle/0005_food_compound.sql", "utf8"));
sqlite.exec(readFileSync("drizzle/0006_drug_m1.sql", "utf8"));
sqlite.exec(readFileSync("drizzle/0007_drug_m2.sql", "utf8"));
sqlite.exec(readFileSync("drizzle/0008_drug_m3.sql", "utf8"));
sqlite.exec(readFileSync("drizzle/0009_food_portions.sql", "utf8"));
sqlite.exec(readFileSync("drizzle/0010_record_deletion.sql", "utf8"));
sqlite.exec(readFileSync("drizzle/0013_wardrobe.sql", "utf8"));
sqlite.exec(readFileSync("drizzle/0014_device_lifecycle.sql", "utf8"));
sqlite.exec(readFileSync("drizzle/0015_subscription_lifecycle.sql", "utf8"));
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

const origin = "https://demo.test";
const get = (path) => worker.fetch(new Request(origin + path), { DB });
const post = (path, fields, source = origin) => worker.fetch(new Request(origin + path, {
  method: "POST", body: new URLSearchParams(fields), headers: { origin: source },
}), { DB });
const html = async (path) => {
  const response = await get(path);
  assert.equal(response.status, 200, path);
  return response.text();
};

assert.match(await html("/"), /待处理提醒/);
for (const category of ["clothing", "device", "subscription"]) {
  const base = "/items/" + category;
  await html(base);
  assert.equal((await post(base + "/new", { name: "blocked" }, "https://other.test")).status, 403);
  const created = await post(base + "/new", { name: "跨请求测试" });
  assert.equal(created.status, 303);
  const detail = created.headers.get("location").split("?")[0];
  assert.match(await html(detail), /跨请求测试/);
  assert.equal((await post(detail, { name: "<实际已修改>" })).status, 303);
  assert.match(await html(detail), /&lt;实际已修改&gt;/);
  assert.equal((await post(detail, { operation: "archive" })).status, 303);
  assert.match(await html(base + "?status=archived"), /实际已修改/);
  assert.doesNotMatch(await html(base), /实际已修改/);
  assert.equal((await post(detail, { name: "archived edit" })).status, 303);
  assert.match(await html(detail), /archived edit/);
  assert.match(await html(detail), /删除档案/);
  assert.equal((await post(detail, { operation:"delete" })).status,303);
  assert.equal((await get(detail)).status,404);
  assert.doesNotMatch(await html(base+"?status=archived"), /archived edit/);
}
assert.equal(sqlite.prepare("SELECT count(*) AS total FROM LifecycleEvent").get().total, 6);

for (const [spec, amount, unit] of [
  ["1 箱 × 12 瓶", 12, "瓶"], ["两箱每箱十二瓶", 24, "瓶"],
  ["250 mL × 12 瓶", 12, "瓶"], ["12 瓶/箱", 12, "瓶"], ["2 盒", 2, "盒"],
]) {
  assert.deepEqual(parseQuantity(spec), { amount, unit }, spec);
}
for (const spec of ["250 mL", "1.5 瓶", "0 瓶"]) assert.equal(parseQuantity(spec), null, spec);
assert.match(await html("/items/subscription/new?mode=manual"), /data-custom-cycle hidden/);
for (const cycle of ["年", "季度", "月", "custom"]) {
  const response = await post("/items/subscription/new", { name: "会员", billingInterval: cycle, customCycle: "每两周" });
  assert.equal(response.status, 303);
  const page = await html(response.headers.get("location"));
  assert.match(page, cycle === "custom" ? /value="每两周"/ : new RegExp(`<option selected>${cycle}</option>`));
}
assert.equal((await post("/items/subscription/new", { name: "会员", billingInterval: "custom" })).status, 400);
assert.equal((await get("/assets/forms.js")).status, 200);
console.log("Clothing, devices and subscriptions passed navigation, create, edit, archive, escaping and origin validation.");

const base = "/items/food";
const go = async (path, fields) => {
  const response = await post(path, fields);
  assert.equal(response.status, 303, await response.text());
  return response.headers.get("location").split("?")[0];
};
const createFood = (fields) => go(base + "/new", fields);
const relative = (offset) => new Intl.DateTimeFormat("sv-SE", {timeZone:"Asia/Shanghai"}).format(new Date(Date.now()+offset*86400000));
const inventory = async (query = "") => (await html(base + query)).split('id="inventory"')[1].split("<section>")[0];

assert.match(await html(base + "/demo-milk"), /当前库存<\/dt><dd>12 瓶/);
await go(base + "/demo-milk",{operation:"consume"});
assert.match(await html(base + "/demo-milk"), /11 瓶/);

const milk = await createFood({name:"验收牛奶",purchasedOn:relative(0),expiresOn:relative(2),expiryLead:"3",locationId:"fridge",quantity:"1 盒",categoryId:"dairy-0"});
const milkPage = await html(milk);
assert.match(milkPage,/冰箱冷藏室/);
assert.match(milkPage,/距包装标注日期还有 2 天/);
assert.match(await html("/"), /验收牛奶/);
assert.match(await inventory("?location=fridge&category=dairy"),/验收牛奶/);

const rice = await createFood({name:"验收大米",purchasedOn:relative(-90),locationId:"dry-cabinet",purchasedAmount:"2",unit:"kg",packaging:"opened",openedOn:relative(-30),categoryId:"dry-0"});
const riceId = rice.split("/").at(-1);
const profile = sqlite.prepare("SELECT foodId FROM FoodDetail WHERE itemId=?").get(riceId).foodId;
const midRice = await createFood({foodId:profile,purchasedOn:relative(-45),locationId:"cupboard",purchasedAmount:"5",unit:"kg"});
const lastRice = await createFood({foodId:profile,purchasedOn:relative(-5),locationId:"dry-cabinet",purchasedAmount:"5",unit:"kg"});
assert.equal(sqlite.prepare("SELECT count(*) n FROM FoodDetail WHERE foodId=?").get(profile).n,3);
assert.equal(sqlite.prepare("SELECT count(*) n FROM FoodItem WHERE id=?").get(profile).n,1);
assert.equal(sqlite.prepare("SELECT remainingAmount FROM FoodDetail WHERE itemId=?").get(riceId).remainingAmount,2);
assert.match(await html(midRice+"?added=1"),/已记录这次购买/);
assert.match(await html(base+"/new"),/更多食品信息（选填，可稍后补充）/);

assert.match(await inventory("?packaging=opened"), /验收大米/);
assert.match(await html(midRice), /5 kg/);
await go(midRice,{operation:"adjust",amount:"3",unit:"kg",amountNote:"约3kg"});
assert.match(await html(midRice), /约3kg/);
assert.match(await html(midRice), /数量调整/);
assert.doesNotMatch(await html(lastRice), /约3kg/);

const chicken = await createFood({name:"验收鸡肉",locationId:"fridge",quantity:"1 袋",categoryId:"meat-2"});
await go(chicken,{operation:"move",locationId:"freezer",transition:"freeze"});
const chickenPage = await html(chicken);
assert.match(chickenPage,/冰箱冷藏室 → 冰箱冷冻室/);
assert.match(chickenPage,/冷冻<\/strong>/);
assert.match(await inventory("?location=freezer"), /验收鸡肉/);
assert.doesNotMatch(await inventory("?location=fridge"), /验收鸡肉/);

const sauce = await createFood({name:"验收调味品",purchasedOn:relative(-45),openedOn:relative(-43),packaging:"opened",
  purchasedAmount:"2",unit:"瓶",locationId:"cupboard",checkDays:"14",expiresOn:relative(1),expiryLead:"3",categoryId:"seasoning-4"});
const dashboard = await html(base);
assert.match(dashboard,/验收调味品<\/strong><small>储存检查已逾期/);
assert.match(dashboard,/验收调味品<\/strong><small>距包装标注日期还有 1 天/);
const byExpiry = await inventory("?sort=expiry");
assert.ok(byExpiry.indexOf("验收调味品") < byExpiry.indexOf("验收牛奶"));
await go(sauce,{operation:"check",checkedOn:relative(0),inspectionNotes:"查看密封状态"});
assert.match(await html(sauce), /查看密封状态/);
assert.doesNotMatch(await html(base), /验收调味品<\/strong><small>储存检查已逾期/);
await go(sauce,{operation:"consumeAll"});
assert.doesNotMatch(await inventory(), /验收调味品/);
assert.doesNotMatch(await html("/"), /验收调味品/);
assert.match(await inventory("?status=history"), /验收调味品/);

const before = sqlite.prepare("SELECT count(*) n FROM FoodDetail").get().n;
const extracted = await post(base+"/intake",{text:"昨天买了两斤苹果，放在冰箱冷藏室\n今天买了一盒牛奶，2026-11-20 到期"});
assert.equal(extracted.status,200);
const review = await extracted.text();
assert.match(review,/待确认 · 2/);
assert.match(review,/value="苹果"/);
assert.match(review,/value="2026-11-20"/);
assert.equal(sqlite.prepare("SELECT count(*) n FROM FoodDetail").get().n,before);
const draft = review.match(/name="draft" value="([^"]+)"/)?.[1];
assert.ok(draft);
await go(base+"/intake",{operation:"confirm",draft,"candidate-0-foodId":"new","candidate-1-foodId":"new","candidate-0-name":"确认苹果","candidate-0-purchasedAmount":"2",
  "candidate-0-unit":"斤","candidate-0-locationId":"fridge","candidate-1-name":"确认取名牛奶","candidate-1-purchasedAmount":"1",
  "candidate-1-unit":"盒","candidate-1-locationId":"fridge"});
assert.equal(sqlite.prepare("SELECT count(*) n FROM FoodDetail").get().n,before+2);
assert.equal((await post(base+"/intake",{operation:"confirm",draft})).status,400);
assert.match(await inventory("?location=fridge"), /确认苹果/);

await go(base+"/locations",{name:"备用储物格",kind:"常温"});
const custom = sqlite.prepare("SELECT id FROM StorageLocation WHERE name='备用储物格'").get().id;
await go(base+"/locations",{id:custom,name:"备用储物区",kind:"常温"});
assert.match(await html(base+"/locations"), /备用储物区/);
await go(base+"/locations",{id:custom,operation:"remove"});
assert.doesNotMatch(await html(base+"/locations"), /备用储物区/);
await go(base+"/profiles",{operation:"subcategory",parentId:"seasoning",childName:"自定义香辛料"});
assert.match(await html(base+"/new"),/自定义香辛料/);
assert.equal((await post(base+"/new",{name:"越权"},"https://other.test")).status,403);
assert.match(await html(base+"/new"), /value="new" selected/);
assert.doesNotMatch(await html(base+"/new"), /data-new-profile hidden disabled/);
const refillProfile=sqlite.prepare("SELECT id FROM FoodItem WHERE deletedAt IS NULL LIMIT 1").get();
const refillHtml=await html(base+"/new?foodId="+encodeURIComponent(refillProfile.id));
assert.match(refillHtml,/data-new-profile hidden disabled/);
assert.match(refillHtml,/确认补充库存/);
assert.equal((await get(base+"/new?foodId=missing-food")).status,404);
assert.match(await html(base), /到期日历/);
assert.match(await html(base+"/intake"), /AI 服务未配置/);
assert.equal((await post(base+"/intake",{method:"photo"})).status,503);

const captures=[];
let extraction=[];
let spokenInput="买了两袋鸡胸肉，一袋冷冻，一袋冷藏";
const nativeFetch=globalThis.fetch;
globalThis.fetch=async (url,options)=>{
  captures.push({url,options});
  return url.endsWith("/audio/transcriptions")
    ? Response.json({text:spokenInput})
    : Response.json({ output:[{content:[{type:"output_text",text:JSON.stringify({items:extraction})}]}] });
};
async function aiPost(form, identity="tester") {
  return worker.fetch(new Request(origin+base+"/intake",{method:"POST",body:form,headers:{origin,"oai-authenticated-user-id":identity}}),
    {DB,OPENAI_API_KEY:"test-only-key",AI_MEDIA:"enabled"});
}
const idOfDraft=(html)=>html.match(/name="draft" value="([^"]+)"/)?.[1];
const parsePhoto=async (rows)=>{
  extraction=rows;
  const form=new FormData();
  form.set("method","photo");
  form.set("timeZone","Asia/Tokyo");
  form.append("photos",new File([Uint8Array.of(137,80,78,71)],"front.png",{type:"image/png"}));
  form.append("photos",new File([Uint8Array.of(137,80,78,71)],"label.png",{type:"image/png"}));
  const response=await aiPost(form);
  assert.equal(response.status,200);
  return response.text();
};
try {
  let review=await parsePhoto([{intent:"purchase",name:"识别牛奶",brand:"测试品牌",categoryId:"dairy-0",amount:1,unit:"盒",
    shortLife:true,expiresOn:"2026-12-01"}]);
  assert.match(review,/短保食品|包装日期需要核对/);
  assert.match(review,/name="candidate-0-expiresOn" value=""/);
  const request=JSON.parse(captures.at(-1).options.body);
  assert.equal(request.input[0].content.filter((entry)=>entry.type==="input_image").length,2);
  assert.match(request.input[0].content[1].image_url,/^data:image\/png;base64,/);
  assert.equal(request.store,false);
  assert.equal(request.text.format.type,"json_schema");

  review=await parsePhoto([{intent:"purchase",name:"识别大米",categoryId:"dry-0",specification:"5 kg",amount:5,unit:"kg"}]);
  assert.doesNotMatch(review,/短保食品建议/);
  const confirm=new URLSearchParams({operation:"confirm",draft:idOfDraft(review),"candidate-0-name":"识别大米","candidate-0-foodId":"new",
    "candidate-0-categoryId":"dry-0","candidate-0-specification":"5 kg","candidate-0-purchasedAmount":"5","candidate-0-unit":"kg",
    "candidate-0-locationId":"cupboard","candidate-0-purchasedOn":"2026-11-16","candidate-0-purchaseTime":"08:09"});
  assert.equal((await aiPost(confirm,"other")).status,409);
  assert.equal((await aiPost(confirm)).status,303);
  assert.equal((await aiPost(confirm)).status,409);
  const identified=sqlite.prepare("SELECT id FROM FoodItem WHERE name='识别大米'").get().id;
  review=await parsePhoto([{intent:"purchase",name:"识别大米",categoryId:"dry-0",specification:"5 kg",amount:5,unit:"kg"}]);
  assert.match(review,new RegExp('value="'+identified+'" selected'));
  confirm.set("draft",idOfDraft(review));
  confirm.set("candidate-0-foodId",identified);
  assert.equal((await aiPost(confirm)).status,303);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM FoodDetail WHERE foodId=?").get(identified).n,2);

  extraction=[{intent:"purchase",name:"识别鸡肉",amount:1,unit:"袋",locationId:"fridge"},
    {intent:"purchase",name:"识别鸡肉",amount:1,unit:"袋",locationId:"freezer"}];
  const audio=new FormData();
  audio.set("method","voice");
  audio.set("audio",new File([Uint8Array.of(1,2,3)],"recording.webm",{type:"audio/webm"}));
  const voice=await aiPost(audio);
  assert.equal(voice.status,200);
  const voiceReview=await voice.text();
  assert.match(voiceReview,/转写：买了两袋鸡胸肉/);
  assert.equal(captures.at(-2).options.body.get("file").name,"recording.webm");
  assert.equal(captures.at(-2).options.body.get("model"),"gpt-transcribe");
  const split={operation:"confirm",draft:idOfDraft(voiceReview)};
  for (const [index,location] of ["fridge","freezer"].entries()) {
    for (const [field,value] of Object.entries({name:"识别鸡肉",locationId:location,purchasedAmount:"1",unit:"袋"}))
      split[`candidate-${index}-${field}`]=value;
  }
  assert.equal((await aiPost(new URLSearchParams(split))).status,303);
  const chickens=sqlite.prepare("SELECT f.* FROM FoodDetail f JOIN FoodItem p ON p.id=f.foodId WHERE p.name='识别鸡肉'").all();
  assert.equal(chickens.length,2);
  assert.equal(chickens[0].foodId,chickens[1].foodId);
  assert.deepEqual(chickens.map((r)=>r.locationId).sort(),["freezer","fridge"]);

  extraction=[{intent:"adjust",name:"识别鸡肉",amount:2,unit:"袋"}];
  const update=await aiPost(new URLSearchParams({method:"text",text:"库存调整"}));
  const updateReview=await update.text();
  assert.match(updateReview,/确认操作批次/);
  const updateForm=new URLSearchParams({operation:"apply-action",draft:idOfDraft(updateReview),index:"0",
    batchId:chickens[0].itemId,amount:"2",unit:"袋"});
  assert.equal((await aiPost(updateForm)).status,303);
  assert.equal((await aiPost(updateForm)).status,409);
  assert.equal(sqlite.prepare("SELECT remainingAmount n FROM FoodDetail WHERE itemId=?").get(chickens[0].itemId).n,2);

  const milkId=milk.split("/").at(-1);
  const createdAt=sqlite.prepare("SELECT createdAt FROM Item WHERE id=?").get(milkId).createdAt;
  await go(milk,{operation:"edit",locationId:"fridge",purchasedOn:"2025-01-12",purchaseTime:"07:05",timeZone:"Asia/Tokyo",unit:"盒"});
  assert.equal(sqlite.prepare("SELECT createdAt FROM Item WHERE id=?").get(milkId).createdAt,createdAt);
  const dates=sqlite.prepare("SELECT purchasedAtLocal,purchaseTimeZone,sourceJson FROM FoodDetail WHERE itemId=?").get(milkId);
  assert.equal(dates.purchasedAtLocal,"2025-01-12T07:05");
  assert.equal(dates.purchaseTimeZone,"Asia/Tokyo");
  assert.equal(JSON.parse(dates.sourceJson).fields.purchaseTime,"user");
  spokenInput="今天买了一瓶苹果汁，10天后过期";
  extraction=[{intent:"purchase",name:"苹果汁",amount:1,unit:"瓶",expiresOn:null}];
  audio.set("timeZone","Pacific/Kiritimati");
  const voiced=await aiPost(audio);
  assert.equal(voiced.status,200);
  const localDay=new Intl.DateTimeFormat("sv-SE",{timeZone:"Pacific/Kiritimati"}).format(new Date());
  const localExpiry=new Date(Date.parse(localDay)+10*86400000).toISOString().slice(0,10);
  assert.match(await voiced.text(),new RegExp('name="candidate-0-expiresOn" value="'+localExpiry+'"'));
  extraction=[{intent:"consume",name:"梨",amount:1,unit:"个"},{intent:"move",name:"梨",locationId:"fridge"}];
  const misclassified=await aiPost(new URLSearchParams({method:"text",text:"前天买了一斤梨，有3个，已经吃了一个，剩下的放冷藏室了。"}));
  assert.equal(misclassified.status,200);
  const patched=await misclassified.text();
  assert.match(patched,/预计剩余 2 个/);
  assert.doesNotMatch(patched,/没有匹配的在库批次/);
} finally { globalThis.fetch=nativeFetch; }

for (const [text,expected] of [
  ["10天后过期","2026-11-26"],["十天后过期","2026-11-26"],["明天到期","2026-11-17"],
  ["11月26日过期","2026-11-26"],["2026年11月26日到期","2026-11-26"],
  ["到期日为2026-11-26","2026-11-26"],["保质期10天",""],
  ["2026年11月31日到期",""],["明天到期，2026年11月26日到期",""],
]) assert.equal(resolveFoodDates(text,"2026-11-16").expiresOn,expected,text);
assert.match(resolveFoodDates("11月26日过期","2026-11-16").dateEvidence,/核对年份/);
assert.equal(resolveFoodDates("明天到期","2026-12-31").expiresOn,"2027-01-01");
const duration=resolveFoodDates("保质期10天","2026-11-16");
assert.equal(duration.shelfLifeDays,10);
assert.equal(duration.shelfLifeBase,"production");
assert.match(duration.dateEvidence,/补充生产日期/);
assert.equal(resolveFoodDates("生产日期2026年11月5日，保质期十天，从生产日起","2026-11-16").producedOn,"2026-11-05");
const instantNoodles = await post(base+"/intake",{method:"text",text:"刚才买了两桶方便面，放在柜子里了",timeZone:"Asia/Shanghai"});
assert.equal(instantNoodles.status,200);
const noodlesCard = await instantNoodles.text();
assert.match(noodlesCard,/fieldset class="panel editor component-form"/);
assert.match(noodlesCard,/class="btn btn-primary">确认并保存/);
assert.match(noodlesCard,/name="candidate-0-name"[^>]*value="方便面"/);
assert.match(noodlesCard,/name="candidate-0-purchasedAmount"[^>]*value="2"/);
assert.match(noodlesCard,/name="candidate-0-unit"[^>]*value="桶"/);
assert.ok(noodlesCard.includes('<option value="cupboard" selected>厨房储物柜</option>'));
await go(base+"/intake",{operation:"confirm",draft:idOfDraft(noodlesCard),"candidate-0-foodId":"new",
  "candidate-0-name":"方便面","candidate-0-purchasedAmount":"2","candidate-0-unit":"桶","candidate-0-locationId":"cupboard"});
const noodlesBatch=sqlite.prepare("SELECT f.remainingAmount,f.stockUnit AS unit,f.locationId FROM FoodDetail f JOIN FoodItem p ON p.id=f.foodId WHERE p.name=?").get("方便面");
assert.deepEqual({...noodlesBatch},{remainingAmount:2,unit:"桶",locationId:"cupboard"});
const shelfReview=await post(base+"/intake",{method:"text",text:"买了一袋验收干货，保质期10天"});
assert.equal(shelfReview.status,200);
const shelfPage=await shelfReview.text();
assert.match(shelfPage,/name="candidate-0-shelfLifeDays" value="10"/);
assert.match(shelfPage,/name="candidate-0-expiresOn" value=""/);
await go(base+"/intake",{operation:"confirm",draft:idOfDraft(shelfPage),"candidate-0-foodId":"new",
  "candidate-0-name":"验收干货","candidate-0-purchasedAmount":"1","candidate-0-unit":"袋",
  "candidate-0-shelfLifeDays":"10","candidate-0-locationId":"cupboard"});
const shelfOnly=sqlite.prepare("SELECT f.shelfLifeDays,f.expiresOn FROM FoodDetail f JOIN FoodItem p ON p.id=f.foodId WHERE p.name='验收干货'").get();
assert.deepEqual({...shelfOnly},{shelfLifeDays:10,expiresOn:null});

const f11Review=await post(base+"/intake",{method:"text",timeZone:"Asia/Shanghai",text:"今天买了一瓶苹果汁，10天后过期"});
assert.equal(f11Review.status,200);
const f11Page=await f11Review.text();
assert.match(f11Page,new RegExp('name="candidate-0-expiresOn" value="'+relative(10)+'"'));
const f11Draft=idOfDraft(f11Page);
const mixedDateReply=await post(base+"/intake",{method:"text",text:"今天买了一瓶验收果汁；查看明天到期的牛奶"});
assert.equal(mixedDateReply.status,200);
assert.match(await mixedDateReply.text(),/name="candidate-0-expiresOn" value=""/);
await go(base+"/intake",{operation:"confirm",draft:f11Draft,"candidate-0-foodId":"new","candidate-0-name":"苹果汁",
  "candidate-0-purchasedOn":relative(0),"candidate-0-purchasedAmount":"1","candidate-0-unit":"瓶",
  "candidate-0-locationId":"fridge","candidate-0-expiresOn":relative(10)});
const juice=sqlite.prepare("SELECT f.* FROM FoodDetail f JOIN FoodItem p ON p.id=f.foodId WHERE p.name='苹果汁'").get();
assert.equal(juice.expiresOn,relative(10));
assert.equal(juice.shelfLifeDays,null);
assert.equal(juice.expirySource,"relative");
assert.equal(juice.expiryLead,3);
const juicePath=base+"/"+juice.itemId;
const juicePage=await html(juicePath);
assert.match(juicePage,new RegExp("到期日期</dt><dd>"+relative(10)));
assert.match(juicePage,new RegExp("到期提醒开始日期</dt><dd>"+relative(7)));
assert.match(await html(base+"?month="+relative(10).slice(0,7)),new RegExp("calendar-"+relative(10)));
assert.match(juicePage,new RegExp(juicePath+"/edit"));

const sibling=await createFood({foodId:juice.foodId,purchasedOn:relative(-2),locationId:"shelf",purchasedAmount:"2",
  unit:"瓶",expiresOn:relative(18),expiryLead:"2",notes:"另一个批次"});
const siblingId=sibling.split("/").at(-1);
const siblingBefore=sqlite.prepare("SELECT * FROM FoodDetail WHERE itemId=?").get(siblingId);
const edit=await html(juicePath+"/edit");
assert.match(edit,/编辑批次/);
for (const key of ["purchasedOn","purchaseTime","producedOn","shelfLifeDays","expiresOn","openedOn","remainingAmount","unit",
  "storage","locationId","disposition","notes"]) assert.match(edit,new RegExp('name="'+key+'"'));
const version=edit.match(/name="version" value="([^"]+)"/)?.[1];
const originalCreated=sqlite.prepare("SELECT createdAt FROM Item WHERE id=?").get(juice.itemId).createdAt;
await go(juicePath+"/edit",{version,purchasedOn:relative(-1),purchaseTime:"09:30",timeZone:"Asia/Shanghai",
  producedOn:relative(-4),shelfLifeDays:"12",expiresOn:relative(1),openedOn:relative(0),remainingAmount:"0.5",
  unit:"升",locationId:"drawer",storage:"密封冷藏",disposition:"active",notes:"日期复核"});
const edited=sqlite.prepare("SELECT * FROM FoodDetail WHERE itemId=?").get(juice.itemId);
assert.equal(edited.expiresOn,relative(1));
assert.equal(edited.shelfLifeDays,12);
assert.equal(edited.purchasedAtLocal,relative(-1)+"T09:30");
assert.equal(edited.openedOn,relative(0));
assert.equal(edited.remainingAmount,.5);
assert.equal(edited.stockUnit,"升");
assert.equal(edited.locationId,"drawer");
assert.equal(edited.storage,"密封冷藏");
assert.equal(sqlite.prepare("SELECT notes FROM Item WHERE id=?").get(juice.itemId).notes,"日期复核");
assert.deepEqual(sqlite.prepare("SELECT * FROM FoodDetail WHERE itemId=?").get(siblingId),siblingBefore);
assert.equal(sqlite.prepare("SELECT createdAt FROM Item WHERE id=?").get(juice.itemId).createdAt,originalCreated);
const agenda=await html(base+"?month="+relative(1).slice(0,7));
assert.match(agenda,new RegExp('id="calendar-'+relative(1)+'"'));
assert.equal((agenda.match(/苹果汁<\/strong><small>距到期日期还有 1 天/g)||[]).length,1);
const staleCalendar=await html(base+"?month="+relative(10).slice(0,7));
assert.doesNotMatch(staleCalendar,new RegExp('id="calendar-'+relative(10)+'"[^<]*<time[^>]*>[^<]*</time><span>[^\n]*'+juice.itemId));
assert.equal((await post(juicePath+"/edit",{version,notes:"过期表单"})).status,409);
await go(juicePath+"/edit",{shelfLifeDays:"10",shelfLifeBase:"production",producedOn:relative(-3)});
assert.equal(sqlite.prepare("SELECT expiresOn FROM FoodDetail WHERE itemId=?").get(juice.itemId).expiresOn,relative(7));
await go(juicePath+"/edit",{expiresOn:relative(2),shelfLifeBase:"production"});
assert.equal(sqlite.prepare("SELECT expiresOn FROM FoodDetail WHERE itemId=?").get(juice.itemId).expiresOn,relative(2));
console.log("F-11 and F-12 passed: relative text and transcript, confirmed dates, reminder replacement, and batch isolation.");

const pearText="前天买了一斤梨，有3个，已经吃了一个，剩下的放冷藏室了。";
const pearRows=()=>sqlite.prepare("SELECT f.* FROM FoodDetail f JOIN FoodItem p ON p.id=f.foodId WHERE p.name='梨' ORDER BY f.rowid").all();
const pearReview=async (text=pearText)=>{
  const result=await post(base+"/intake",{method:"text",text,timeZone:"Asia/Shanghai"});
  assert.equal(result.status,200);
  return result.text();
};
const pearConfirm=(draft,profile="new",extra={})=>({
  operation:"confirm",draft,"candidate-0-foodId":profile,"candidate-0-name":"梨",
  "candidate-0-purchasedOn":relative(-2),"candidate-0-purchasedAmount":"1","candidate-0-unit":"斤",
  "candidate-0-initialAmount":"3","candidate-0-initialUnit":"个","candidate-0-consumedAmount":"1",
  "candidate-0-consumedUnit":"个","candidate-0-locationId":"fridge",...extra,
});
const pearCard=await pearReview();
assert.match(pearCard,/name="candidate-0-name" value="梨"/);
assert.match(pearCard,/name="candidate-0-purchasedAmount" value="1"/);
assert.match(pearCard,/name="candidate-0-unit" value="斤"/);
assert.match(pearCard,/name="candidate-0-initialAmount" value="3"/);
assert.match(pearCard,/name="candidate-0-consumedAmount" value="1"/);
assert.match(pearCard,/预计剩余 2 个/);
assert.match(pearCard,new RegExp('name="candidate-0-purchasedOn" value="'+relative(-2)+'"'));
assert.doesNotMatch(pearCard,/没有匹配的在库批次/);
assert.equal(pearRows().length,0);
await go(base+"/intake",pearConfirm(idOfDraft(pearCard)));
const firstPear=pearRows()[0];
assert.equal(firstPear.purchasedAmount,1);
assert.equal(firstPear.purchasedUnit,"斤");
assert.equal(firstPear.intakeInitialAmount,3);
assert.equal(firstPear.intakeInitialUnit,"个");
assert.equal(firstPear.stockUnit,"个");
assert.equal(firstPear.remainingAmount,2);
assert.equal(firstPear.purchasedOn,relative(-2));
assert.equal(firstPear.locationId,"fridge");
assert.match(await html(base+"/"+firstPear.itemId),/当前库存<\/dt><dd>2 个/);
assert.deepEqual(sqlite.prepare("SELECT kind,notes FROM LifecycleEvent WHERE itemId=? ORDER BY rowid").all(firstPear.itemId)
  .map(({kind,notes})=>[kind,notes]),[
    ["purchase",relative(-2)+" · 1 斤"],["intake",null],["consume","1 个 · 本批次剩余 2 个"],
  ]);
const matchedPear=await pearReview();
assert.match(matchedPear,new RegExp('value="'+firstPear.foodId+'" selected'));
await go(base+"/intake",pearConfirm(idOfDraft(matchedPear),firstPear.foodId));
assert.equal(pearRows().length,2);
assert.equal(pearRows()[0].remainingAmount,2);
assert.equal(pearRows()[1].foodId,firstPear.foodId);
const ambiguous=await pearReview("前天买了一斤梨，已经吃了一个，剩下的放冷藏室了。");
assert.match(ambiguous,/无法直接换算/);
assert.match(ambiguous,/name="candidate-0-initialAmount" value=""/);
const invalid=await post(base+"/intake",pearConfirm(idOfDraft(ambiguous),firstPear.foodId,{"candidate-0-initialAmount":"","candidate-0-initialUnit":"斤"}));
assert.equal(invalid.status,400);
assert.equal(pearRows().length,2);
const standalone=await pearReview("梨吃了一个");
assert.match(standalone,/确认操作批次/);
assert.doesNotMatch(standalone,/本次购买后的库存操作/);
await go(base+"/intake",{operation:"apply-action",draft:idOfDraft(standalone),index:"0",batchId:firstPear.itemId,amount:"1",unit:"个"});
assert.equal(pearRows()[0].remainingAmount,1);
assert.equal(pearRows()[1].remainingAmount,2);
console.log("F-13 passed: compound purchase and consumption, independent units, ambiguity, profile reuse and standalone updates.");
console.log("V1.1 scenarios passed: intake API contracts, separate batches, confirmations, inventory updates and creation time.");
console.log("Food scenarios passed: batches, storage, transfer, inspections, quantities, reminders, filters and confirmed text intake.");

const portionParent=await createFood({name:"测试分装鸡肉",quantity:"",purchasedAmount:"1.5",unit:"kg",
  purchasedOn:relative(-2),expiresOn:relative(2),expiryLead:"3",checkDays:"30",locationId:"fridge",storage:"原包装",batch:"LOT-P"});
const portionId=portionParent.split("/").at(-1);
const portionUrl=portionParent+"/portion";
await go(portionParent,{operation:"check",checkedOn:relative(-1),inspectionNotes:"核对原包装"});
const portionPage=await html(portionUrl);
assert.match(portionPage,/food-form component-form/);
assert.match(portionPage,/class="back-link"[^>]*>[\s\S]*?返回批次/);
const portionVersion=portionPage.match(/name="version" value="([^"]+)"/)?.[1];
const portionsForm={version:portionVersion,"location-0":"freezer","quantity-0":"0.5","freeze-0":"yes","storage-0":"冷冻袋",
  "location-1":"drawer","quantity-1":"0.25"};
assert.equal((await post(portionUrl,{...portionsForm,"quantity-0":"2"})).status,400);
assert.equal(sqlite.prepare("SELECT count(*) n FROM FoodDetail WHERE portionParentId=?").get(portionId).n,0);
await go(portionUrl,portionsForm);
assert.equal((await post(portionUrl,portionsForm)).status,409);
const portionChildren=sqlite.prepare("SELECT * FROM FoodDetail WHERE portionParentId=? ORDER BY rowid").all(portionId);
assert.equal(portionChildren.length,2);
const [cold,drawer]=portionChildren;
const parentStock=sqlite.prepare("SELECT * FROM FoodDetail WHERE itemId=?").get(portionId);
assert.equal(parentStock.remainingAmount,0.75);
assert.equal(cold.remainingAmount,0.5);
assert.equal(drawer.remainingAmount,0.25);
assert.equal(parentStock.remainingAmount+cold.remainingAmount+drawer.remainingAmount,1.5);
assert.equal(cold.frozenOn,relative(0));
assert.equal(drawer.frozenOn,null);
assert.equal(cold.expiresOn,relative(2));
assert.equal(cold.purchasedOn,relative(-2));
assert.equal(cold.openedOn,null);
assert.equal(cold.purchasedAmount,null);
assert.equal(cold.portionCheckAnchor,relative(-1));
assert.match(await html(portionParent),/分装子批次/);
assert.match(await html(base+"/"+cold.itemId),/来源批次/);
assert.match(await html(base+"/"+cold.itemId),/冷冻袋/);
assert.match(await html(base+"/"+cold.itemId),/核对|上次检查/);
assert.equal(sqlite.prepare("SELECT count(*) n FROM FoodStockMovement WHERE foodId=?").get(parentStock.foodId).n,0);

const restVersion=(await html(portionUrl)).match(/name="version" value="([^"]+)"/)?.[1];
await go(portionUrl,{version:restVersion,"location-0":"fridge","quantity-0":"0.75"});
const spentParent=sqlite.prepare("SELECT * FROM FoodDetail WHERE itemId=?").get(portionId);
assert.equal(spentParent.disposition,"portioned");
assert.equal(spentParent.remainingAmount,0);
assert.match(await html(portionParent),/已全部分装/);
assert.equal((await get(portionParent+"/edit")).status,200);
await go(portionParent+"/edit",{remainingAmount:"9",disposition:"active",notes:"分装来源备注"});
assert.deepEqual({...sqlite.prepare("SELECT disposition,remainingAmount FROM FoodDetail WHERE itemId=?").get(portionId)},
  {disposition:"portioned",remainingAmount:0});
await go(base+"/"+cold.itemId,{operation:"consume",amount:"0.2",unit:"kg"});
await go(base+"/"+drawer.itemId,{operation:"discard"});
const unitsSibling=await createFood({foodId:parentStock.foodId,purchasedAmount:"2",unit:"袋"});
await go(unitsSibling,{operation:"consume",amount:"1",unit:"袋"});
const approximate=await createFood({name:"测试估计丢弃",amountNote:"余少量",locationId:"fridge"});
assert.equal((await get(approximate+"/portion")).status,409);
await go(approximate,{operation:"discard"});
const statsHtml=await html(base+"/stats?since="+relative(0)+"&until="+relative(0));
assert.match(statsHtml,/测试分装鸡肉<\/strong>[\s\S]*?0.2 kg/);
assert.match(statsHtml,/测试分装鸡肉<\/strong>[\s\S]*?1 袋/);
assert.match(statsHtml,/测试分装鸡肉<\/strong>[\s\S]*?0.25 kg/);
assert.match(statsHtml,/测试估计丢弃<\/strong>[\s\S]*?数量未确认/);
assert.doesNotMatch(await html(base+"/stats?since="+relative(-2)+"&until="+relative(-1)),/测试分装鸡肉/);
assert.match(statsHtml,/梨<\/strong>/);
console.log("Food portions and consumption stats passed: conserved balances, inherited reminders and dates, retry guards, unknown amounts and separate units.");
const deleteFood=await createFood({name:"食品删除验收",purchasedAmount:"2",unit:"盒",expiresOn:relative(0),expiryLead:"3"});
const deleteFoodId=deleteFood.split("/").at(-1);
const deleteFoodProfile=sqlite.prepare("SELECT foodId FROM FoodDetail WHERE itemId=?").get(deleteFoodId).foodId;
assert.match(await html(base+"/profiles?id="+deleteFoodProfile),/删除食品档案/);
assert.equal((await post(base+"/profiles",{operation:"delete",id:deleteFoodProfile})).status,409);
await go(deleteFood,{operation:"archive"});
await go(deleteFood+"/edit",{notes:"归档后编辑"});
await go(deleteFood,{operation:"delete"});
assert.equal((await get(deleteFood)).status,404);
assert.doesNotMatch(await inventory("?status=history"),/食品删除验收/);
assert.doesNotMatch(await html("/"),/食品删除验收/);
await go(base+"/profiles",{operation:"delete",id:deleteFoodProfile});
assert.equal((await get(base+"/profiles?id="+deleteFoodProfile)).status,404);
assert.equal((await post(base+"/new",{foodId:deleteFoodProfile,purchasedAmount:"1",unit:"盒"})).status,400);

{
const meds="/items/medicine";
const accountA="drug-smoke-a",accountB="drug-smoke-b";
function medRequest(path,form=null,user=accountA,env={}) {
  const body=form instanceof FormData?form:form?new URLSearchParams(form):undefined;
  return worker.fetch(new Request(origin+path,{method:form?"POST":"GET",body,
    headers:{...(user?{"oai-authenticated-user-id":user}:{}),origin}}),{DB,...env});
}
async function medHtml(path,user=accountA) {
  const response=await medRequest(path,null,user);
  assert.equal(response.status,200,path);
  return response.text();
}
async function medSave(path,form,user=accountA,env={}) {
  const response=await medRequest(path,form,user,env);
  assert.equal(response.status,303,(await response.text()).match(/role="alert">([^<]+)/)?.[1]||path);
  return response.headers.get("location");
}
assert.equal((await medRequest(meds,null,"")).status,401);
assert.match(await medHtml(meds),/演示药品 A/);
assert.doesNotMatch(await medHtml(meds,accountB),/演示药品 A/);
const first=await medSave(meds+"/new",{drugId:"new",name:"测试通用药",tradeName:"测试甲",drugType:"otc",
  categoryId:"drugcat-1-0",form:"片剂",specification:"测试规格A",ingredients:"测试成分X | 1 | mg | 每片 | 测试包装\n测试成分Y | 2 | mg | 每片 | 测试说明书",
  purchasedOn:relative(-5),purchaseTime:"13:30",expiresOn:relative(1),purchasedAmount:"24",remainingAmount:"10",unit:"片",lot:"LOT-A",lowStock:"12"});
const firstId=first.split("?")[0].split("/").at(-1);
const firstRow=sqlite.prepare("SELECT * FROM DrugBatch WHERE itemId=?").get(firstId);
assert.equal(sqlite.prepare("SELECT drugType FROM DrugItem WHERE id=?").get(firstRow.drugId).drugType,"otc");
assert.equal(sqlite.prepare("SELECT count(*) n FROM DrugIngredient WHERE drugId=?").get(firstRow.drugId).n,2);
assert.match(await medHtml(first),/测试成分Y.*每片/s);
const sibling=await medSave(meds+"/new",{drugId:firstRow.drugId,expiresOn:relative(90),purchasedAmount:"8",unit:"片",lot:"LOT-B"});
const siblingId=sibling.split("?")[0].split("/").at(-1);
const siblingBefore=sqlite.prepare("SELECT * FROM DrugBatch WHERE itemId=?").get(siblingId);
const second=await medSave(meds+"/new",{drugId:"new",name:"测试处方药",tradeName:"测试乙",drugType:"rx",form:"胶囊",
  ingredients:"测试成分X | 4 | mg | 每粒 | 测试说明书",purchasedAmount:"12",unit:"粒"});
assert.match(await medHtml(second),/测试成分X/);
assert.equal(sqlite.prepare("SELECT drugType FROM DrugItem WHERE name='测试处方药'").get().drugType,"rx");
const inventoryHtml=await medHtml(meds);
assert.match(inventoryHtml,/同成分库存/);
assert.match(inventoryHtml,/测试通用药 · 测试甲.*测试处方药 · 测试乙/s);
assert.match(inventoryHtml,/达到设置的库存阈值/);
assert.match(await medHtml("/"),/测试甲/);
assert.doesNotMatch(await medHtml("/",accountB),/测试甲/);
assert.equal((await medRequest(first,null,accountB)).status,404);
assert.equal((await medRequest(meds+"/profiles?id="+firstRow.drugId,null,accountB)).status,404);
assert.equal((await medRequest(meds+"/new",{drugId:firstRow.drugId,purchasedAmount:"1",unit:"片"},accountB)).status,400);
const editPath=meds+"/"+firstId+"/edit";
const version=(await medHtml(editPath)).match(/name="version" value="([^"]+)"/)?.[1];
assert.ok(version);
const beforeCreated=sqlite.prepare("SELECT createdAt FROM Item WHERE id=?").get(firstId).createdAt;
await medSave(editPath,{version,purchasedOn:relative(-4),purchaseTime:"08:05",producedOn:relative(-20),expiresOn:relative(50),
  openedOn:relative(-1),openUseUntil:relative(3),purchasedAmount:"24",remainingAmount:"7",unit:"片",
  storage:"包装要求：示例",status:"open",locationId:accountA+":drugloc:1",lot:"LOT-A",expiryLead:"7",notes:"日期与数量复核"});
const updated=sqlite.prepare("SELECT * FROM DrugBatch WHERE itemId=?").get(firstId);
assert.equal(updated.remainingAmount,7);
assert.equal(updated.purchasedAtLocal,relative(-4)+"T08:05");
assert.equal(updated.expiresOn,relative(50));
assert.equal(updated.openUseUntil,relative(3));
assert.equal(updated.locationId,accountA+":drugloc:1");
assert.equal(sqlite.prepare("SELECT createdAt FROM Item WHERE id=?").get(firstId).createdAt,beforeCreated);
assert.deepEqual(sqlite.prepare("SELECT * FROM DrugBatch WHERE itemId=?").get(siblingId),siblingBefore);
assert.match(await medHtml(first),/家庭药箱 → 卧室抽屉/);
assert.match(await medHtml(meds),/开封后使用期限临近/);
assert.doesNotMatch(await medHtml(meds),/包装标注有效期临近/);
await medSave(meds+"/"+firstId,{operation:"consume",amount:"2"});
assert.equal(sqlite.prepare("SELECT remainingAmount FROM DrugBatch WHERE itemId=?").get(firstId).remainingAmount,5);
await medSave(meds+"/"+firstId,{operation:"finished"});
assert.doesNotMatch(await medHtml(meds),/开封后使用期限临近/);
await medSave(meds+"/locations",{name:"临时外用药盒"});
const customMed=sqlite.prepare("SELECT id FROM DrugStorageLocation WHERE name='临时外用药盒'").get().id;
await medSave(meds+"/locations",{id:customMed,name:"外用药盒",notes:"独立位置"});
assert.match(await medHtml(meds+"/locations"),/外用药盒/);
await medSave(meds+"/locations",{id:customMed,operation:"remove"});
assert.doesNotMatch(await medHtml(meds+"/locations"),/外用药盒/);

const medEntry=await medHtml(meds+"/intake");
assert.match(medEntry,/AI 服务未配置/);
assert.equal((await medRequest(meds+"/intake",{method:"photo"})).status,503);
const ruleMed=await medRequest(meds+"/intake",{method:"text",text:"前天买了一盒规则验收药，24片，放在家庭药箱"});
assert.equal(ruleMed.status,200);
const ruleCard=await ruleMed.text();
assert.match(ruleCard,/name="name" value="规则验收药"/);
assert.match(ruleCard,/name="purchasedAmount" value="24"/);
const ruleDraft=idOfDraft(ruleCard);
const medConfirmation={draft:ruleDraft,index:"0",operation:"confirm",drugId:"new",name:"规则验收药",purchasedOn:relative(-2),
  purchasedAmount:"24",unit:"片",locationId:accountA+":drugloc:0",verified:"yes"};
assert.equal((await medRequest(meds+"/intake",medConfirmation,accountB)).status,409);
assert.equal((await medRequest(meds+"/intake",{...medConfirmation,verified:""})).status,400);
const ruleSaved=await medSave(meds+"/intake",medConfirmation);
const ruleId=ruleSaved.split("?")[0].split("/").at(-1);
const ruleProfile=sqlite.prepare("SELECT drugId FROM DrugBatch WHERE itemId=?").get(ruleId).drugId;
const repeat=await medRequest(meds+"/intake",{method:"text",text:"今天又买了一盒规则验收药，24片"}).then((r)=>r.text());
assert.match(repeat,new RegExp('value="'+ruleProfile+'" selected'));
assert.equal((await medRequest(meds+"/intake",medConfirmation)).status,409);

const medNativeFetch=globalThis.fetch;
let medMode="photo";
const medCalls=[];
globalThis.fetch=async (url,options)=>{
  medCalls.push({url,options});
  if (url.endsWith("/audio/transcriptions")) return Response.json({text:"昨天买了一瓶语音试用药，有10毫升"});
  const items=medMode==="photo"?[{intent:"purchase",name:"包装识别验收药",tradeName:"示例商品名",manufacturer:"示例厂家",form:"片剂",
    amount:20,unit:"片",lot:"LOT-PHOTO",expiresOn:"2027-01-01",ingredients:[
      {originalName:"已见成分",amount:"1",unit:"mg",perUnit:"每片",source:"说明书正面"},
      {originalName:"推测成分",amount:"2",unit:"mg",perUnit:"每片",source:null}]}]:
    [{intent:"purchase",name:"语音试用药",amount:10,unit:"毫升",purchasedOn:relative(-1),sourceText:"昨天买了一瓶语音试用药，有10毫升"}];
  return Response.json({output:[{content:[{type:"output_text",text:JSON.stringify({items})}]}]});
};
try {
  const mockEnv={OPENAI_API_KEY:"test-only-med-key",AI_MEDIA:"enabled"};
  const photo=new FormData();
  photo.set("method","photo");
  photo.append("photos",new File([Uint8Array.of(137,80,78,71)],"package.png",{type:"image/png"}));
  photo.append("photos",new File([Uint8Array.of(137,80,78,71)],"leaflet.png",{type:"image/png"}));
  const extracted=await medRequest(meds+"/intake",photo,accountA,mockEnv);
  assert.equal(extracted.status,200);
  const photoCard=await extracted.text();
  assert.match(photoCard,/已见成分/);
  assert.doesNotMatch(photoCard,/推测成分/);
  assert.match(photoCard,/name="expiresOn" value=""/);
  assert.match(photoCard,/包装日期需要核对/);
  assert.equal(sqlite.prepare("SELECT id FROM DrugItem WHERE name='包装识别验收药'").get(),undefined);
  const apiPayload=JSON.parse(medCalls.at(-1).options.body);
  assert.equal(apiPayload.text.format.name,"drug_intake");
  assert.equal(apiPayload.input[0].content.filter((item)=>item.type==="input_image").length,2);
  medMode="voice";
  const voice=new FormData();
  voice.set("method","voice");
  voice.set("audio",new File([1,2,3],"recording.webm",{type:"audio/webm"}));
  const recorded=await medRequest(meds+"/intake",voice,accountA,mockEnv);
  assert.equal(recorded.status,200);
  const voiceCard=await recorded.text();
  assert.match(voiceCard,/name="name" value="语音试用药"/);
  assert.match(voiceCard,/name="purchasedAmount" value="10"/);
  assert.match(voiceCard,new RegExp('name="purchasedOn" value="'+relative(-1)+'"'));
  assert.equal(medCalls.at(-2).options.body.get("file").name,"recording.webm");
} finally { globalThis.fetch=medNativeFetch; }
console.log("Drug M1 passed: OTC and prescription, ingredients, independent batches, reminders, history, scoped storage, owner isolation, and intake.");

const plans=meds+"/plans", logs=meds+"/logs";
const compoundText="买了一盒感冒灵颗粒，一盒12包，一日三次饭后服用。";
const medicationReview=await medRequest(meds+"/intake",{method:"text",text:compoundText,timeZone:"Asia/Shanghai"});
assert.equal(medicationReview.status,200);
const compoundCard=await medicationReview.text();
assert.match(compoundCard,/name="name" value="感冒灵颗粒"/);
assert.match(compoundCard,/name="purchasedAmount" value="12"/);
assert.match(compoundCard,/name="packageSpec" value="12包\/盒"/);
assert.match(compoundCard,/name="unit" value="包"/);
assert.match(compoundCard,/name="plan_frequency" value="3"/);
assert.match(compoundCard,/name="plan_mealTiming" value="饭后"/);
assert.match(compoundCard,/name="plan_dose" value=""/);
assert.match(compoundCard,/name="plan_times" value=""/);
assert.match(compoundCard,/name="enablePlan" value="yes">/);
const compoundDraft=idOfDraft(compoundCard);
const savedDrug=await medSave(meds+"/intake",{draft:compoundDraft,index:"0",drugId:"new",name:"感冒灵颗粒",verified:"yes",
  purchasedAmount:"12",unit:"包",packageSpec:"12包/盒",enablePlan:"yes",plan_frequency:"3",plan_mealTiming:"饭后",plan_timeZone:"Asia/Shanghai"});
const compoundBatch=savedDrug.split("?")[0].split("/").at(-1);
const medBatch=sqlite.prepare("SELECT * FROM DrugBatch WHERE itemId=?").get(compoundBatch);
const plan=sqlite.prepare("SELECT * FROM MedicationPlan WHERE batchId=?").get(compoundBatch);
assert.equal(medBatch.remainingAmount,12);
assert.equal(plan.frequency,3);
assert.equal(plan.mealTiming,"饭后");
assert.equal(plan.dose,null);
assert.deepEqual(JSON.parse(plan.timesJson),[]);
assert.match(await medHtml(plans),/每日 3 次 · 饭后/);
const todayPlanSection=(page)=>page.split("<h2>今日计划</h2>")[1].split("</section>")[0];
assert.match(todayPlanSection(await medHtml(plans)),/感冒灵颗粒[\s\S]*未设置时刻/);
assert.equal((await medRequest(logs+"?plan="+plan.id)).status,200);
assert.doesNotMatch(await medHtml(plans,accountB),/感冒灵颗粒/);
assert.equal((await medRequest(plans+"?id="+plan.id,null,accountB)).status,404);
assert.doesNotMatch(await medHtml("/"),/计划时间待确认/);
const planFields={id:plan.id,version:plan.updatedAt,batchId:compoundBatch,dose:"1",unit:"包",frequency:"3",
  mealTiming:"饭后",times:"08:00,13:00,19:00",startOn:relative(0),endOn:relative(0),timeZone:"Asia/Shanghai",source:"leaflet"};
await medSave(plans,planFields);
const schedule=await medHtml(plans);
assert.match(schedule,/08:00 · 待确认/);
assert.match(schedule,/13:00 · 待确认/);
assert.match(await medHtml(meds),/计划今日结束/);
assert.match(await medHtml("/"),/计划时间待确认/);
assert.doesNotMatch(await medHtml("/",accountB),/计划时间待确认/);

const readQty=()=>sqlite.prepare("SELECT remainingAmount FROM DrugBatch WHERE itemId=?").get(compoundBatch).remainingAmount;
const withOccurrence=(time,status,extra={})=>({planId:plan.id,drugId:medBatch.drugId,batchId:compoundBatch,
  scheduledAtLocal:relative(0)+"T"+time,status,requestKey:crypto.randomUUID(),...extra});
const occurrence=withOccurrence("08:00","taken",{occurredAtLocal:relative(0)+"T08:05",amount:"1",unit:"包"});
assert.equal(readQty(),12);
const logLink=await medSave(logs,occurrence);
const logId=new URL(logLink,origin).searchParams.get("id");
assert.equal(readQty(),11);
assert.equal((await medRequest(logs,occurrence)).status,409);
assert.equal((await medRequest(logs,{...occurrence,requestKey:crypto.randomUUID()})).status,409);
assert.equal(readQty(),11);
assert.equal((await medRequest(logs+"?id="+logId,null,accountB)).status,404);
assert.match(await medHtml(plans),/08:00 · 已服用/);
assert.match(await medHtml(logs+"?date="+relative(0)),/08:05 · 已服用/);
assert.match(await medHtml(meds+"/"+compoundBatch),/记录实际服用/);

const skipped=withOccurrence("13:00","skipped");
await medSave(logs,skipped);
const missed=withOccurrence("19:00","missed");
await medSave(logs,missed);
assert.equal(readQty(),11);
const scheduleAfter=await medHtml(plans);
assert.match(scheduleAfter,/13:00 · 跳过/);
assert.match(scheduleAfter,/19:00 · 漏服/);
assert.doesNotMatch(await medHtml("/"),/计划时间待确认/);

const priorLog=sqlite.prepare("SELECT * FROM MedicationLog WHERE id=?").get(logId);
await medSave(logs,{id:logId,version:priorLog.revision,status:"taken",amount:"2",unit:"包",occurredAtLocal:relative(0)+"T08:05"});
assert.equal(readQty(),10);
const corrected=sqlite.prepare("SELECT * FROM MedicationLog WHERE id=?").get(logId);
assert.equal(corrected.stockApplied,2);
await medSave(logs,{id:logId,version:corrected.revision,status:"skipped"});
assert.equal(readQty(),12);
assert.match(await medHtml(meds+"/"+compoundBatch),/退回 2 包/);
const mismatch=withOccurrence("07:00","taken",{planId:"",scheduledAtLocal:"",occurredAtLocal:relative(0)+"T07:00",amount:"1",unit:"盒"});
assert.equal((await medRequest(logs,mismatch)).status,400);
await medSave(logs,{...mismatch,recordOnly:"yes"});
assert.equal(readQty(),12);
const latestPlan=sqlite.prepare("SELECT * FROM MedicationPlan WHERE id=?").get(plan.id);
await medSave(plans,{...planFields,version:latestPlan.updatedAt,notes:"调整后的计划备注"});
assert.equal(sqlite.prepare("SELECT count(*) n FROM MedicationLog WHERE planId=?").get(plan.id).n,3);
await medSave(plans,{id:plan.id,operation:"paused"});
assert.match(await medHtml(plans),/已暂停/);
assert.doesNotMatch(todayPlanSection(await medHtml(plans)),/感冒灵颗粒/);
await medSave(plans,{id:plan.id,operation:"active"});
await medSave(plans,{id:plan.id,operation:"ended"});
assert.match(await medHtml(plans),/已结束/);
await medSave(plans,{id:plan.id,operation:"delete"});
assert.match(await medHtml(plans),/已删除/);
assert.doesNotMatch(todayPlanSection(await medHtml(plans)),/感冒灵颗粒/);
assert.equal(sqlite.prepare("SELECT count(*) n FROM MedicationLog WHERE planId=?").get(plan.id).n,3);

const repeatNoPlan=await medRequest(meds+"/intake",{method:"text",text:compoundText}).then((r)=>r.text());
const repeatDraft=idOfDraft(repeatNoPlan);
await medSave(meds+"/intake",{draft:repeatDraft,index:"0",drugId:medBatch.drugId, name:"感冒灵颗粒",verified:"yes",
  purchasedAmount:"12",unit:"包",packageSpec:"12包/盒"});
assert.equal(sqlite.prepare("SELECT count(*) n FROM MedicationPlan WHERE drugId=?").get(medBatch.drugId).n,1);
assert.equal(sqlite.prepare("SELECT count(*) n FROM DrugBatch WHERE drugId=?").get(medBatch.drugId).n,2);
assert.equal(readQty(),12);
const futurePlan=await medSave(plans,{drugId:medBatch.drugId,startOn:relative(1),endOn:relative(5)});
assert.ok(futurePlan);
assert.doesNotMatch(todayPlanSection(await medHtml(plans)),/感冒灵颗粒/);
const dateOnly=sqlite.prepare("SELECT id,updatedAt FROM MedicationPlan WHERE drugId=? AND status='active'").get(medBatch.drugId);
await medSave(plans,{id:dateOnly.id,version:dateOnly.updatedAt,startOn:relative(0),endOn:relative(0)});
assert.match(todayPlanSection(await medHtml(plans)),/感冒灵颗粒[\s\S]*未设置时刻/);
await medSave(plans,{id:dateOnly.id,operation:"delete"});
console.log("Drug M2 passed: compound package and plan recognition, optional plan, schedule links, idempotent dosage logs and stock correction.");

const regimenText="我前天买了一盒莲花清瘟胶囊，有12包，每天要吃一包，已经吃了两天，要吃一个星期，今天还没吃。";
const regimenReview=async ()=>{
  const response=await medRequest(meds+"/intake",{method:"text",text:regimenText,timeZone:"Asia/Shanghai"});
  assert.equal(response.status,200);
  return response.text();
};
const regimenCard=await regimenReview();
assert.match(regimenCard,/name="name" value="莲花清瘟胶囊"/);
assert.match(regimenCard,/name="purchasedAmount" value="12"/);
assert.match(regimenCard,new RegExp('name="purchasedOn" value="'+relative(-2)+'"'));
assert.match(regimenCard,/name="plan_dose" value="1"/);
assert.match(regimenCard,/name="plan_unit" value="包"/);
assert.match(regimenCard,/name="plan_durationDays" value="7"/);
assert.match(regimenCard,/name="plan_startOn" value=""/);
assert.match(regimenCard,/自述已服用 2 天，自述今天还没服用/);
assert.match(regimenCard,/name="remainingAmount" value="10"/);
assert.match(regimenCard,/估算剩余 10 包/);
const reportedCard=await medRequest(meds+"/intake",{method:"text",text:regimenText+"实际还剩8包。"}).then((r)=>r.text());
const inOneClause=await medRequest(meds+"/intake",{method:"text",text:regimenText.replace("。","，实际还剩8包。")}).then((r)=>r.text());
assert.match(reportedCard,/name="remainingAmount" value="8"/);
assert.match(inOneClause,/name="purchasedAmount" value="12"/);
assert.match(inOneClause,/name="remainingAmount" value="8"/);
const uncertain=await medRequest(meds+"/intake",{method:"text",text:regimenText.replace("每天要吃一包","每天要吃一粒")}).then((r)=>r.text());
assert.match(uncertain,/name="remainingAmount" value=""/);
const regimenForm={draft:idOfDraft(regimenCard),index:"0",drugId:"new",name:"莲花清瘟胶囊",verified:"yes",
  purchasedOn:relative(-2),purchasedAmount:"12",unit:"包"};
const invalidRegimen=await medRequest(meds+"/intake",{...regimenForm,enablePlan:"yes",plan_durationDays:"7"});
assert.equal(invalidRegimen.status,400);
const regimenOnly=await medSave(meds+"/intake",regimenForm);
const regimenOnlyId=regimenOnly.split("?")[0].split("/").at(-1);
const bought=sqlite.prepare("SELECT * FROM DrugBatch WHERE itemId=?").get(regimenOnlyId);
assert.equal(bought.purchasedAmount,12);
assert.equal(bought.remainingAmount,null);
assert.equal(sqlite.prepare("SELECT count(*) n FROM MedicationPlan WHERE drugId=?").get(bought.drugId).n,0);
const regimenSaved=await medSave(meds+"/intake",{...regimenForm,draft:idOfDraft(await regimenReview()),drugId:bought.drugId,
  remainingAmount:"10",enablePlan:"yes",plan_dose:"1",plan_unit:"包",plan_frequency:"1",plan_durationDays:"7",plan_startOn:relative(-1)});
const regimenId=regimenSaved.split("?")[0].split("/").at(-1);
const regimenPlan=sqlite.prepare("SELECT * FROM MedicationPlan WHERE batchId=?").get(regimenId);
assert.equal(regimenPlan.startOn,relative(-1));
assert.equal(regimenPlan.endOn,relative(5));
assert.equal(regimenPlan.dose,1);
assert.equal(sqlite.prepare("SELECT remainingAmount FROM DrugBatch WHERE itemId=?").get(regimenId).remainingAmount,10);
assert.equal(sqlite.prepare("SELECT count(*) n FROM MedicationLog WHERE drugId=?").get(bought.drugId).n,0);
console.log("Precise drug intake passed: purchase date and quantity, optional seven-day plan, and separate self-reported progress.");

const safety=meds+"/safety";
const safetyDay=relative(0);
const makeSafetyDrug=async (name,ingredients)=>{
  const path=await medSave(meds+"/new",{drugId:"new",name,ingredients,lot:"M3",purchasedAmount:"10",unit:"片"});
  const batchId=path.split("?")[0].split("/").at(-1);
  return sqlite.prepare("SELECT * FROM DrugBatch WHERE itemId=?").get(batchId);
};
const logSafety=(batch,day,time,status="taken",amount="1",unit="片")=>medSave(logs,{
  drugId:batch.drugId,batchId:batch.itemId,requestKey:crypto.randomUUID(),timeZone:"Asia/Shanghai",status,
  occurredAtLocal:day+"T"+time,amount,unit,recordOnly:"yes",
});
const fictional=await makeSafetyDrug("验收剂量甲","验收共同成分 | 2 | mg | 每片 | 测试包装\n验收独立成分 | 1 | mg | 每片 | 测试包装");
const duplicate=await makeSafetyDrug("验收同成分乙","验收共同成分 | 2 | mg | 每片 | 测试包装");
const sildenafil=await makeSafetyDrug("验收组合甲","西地那非 | | | | 测试标签");
const nitro=await makeSafetyDrug("验收组合乙","硝酸甘油 | | | | 测试标签");
const tadalafil=await makeSafetyDrug("验收组合丙","他达拉非 | | | | 测试标签");
const unknown=await makeSafetyDrug("验收未知成分","");
assert.equal((await medRequest(safety,null,"")).status,401);
assert.match(await medHtml(safety),/库存同名成分 · 验收共同成分/);
assert.doesNotMatch(await medHtml(safety),/有来源的相互作用 · 西地那非与硝酸甘油/);
await logSafety(sildenafil,safetyDay,"08:05");
await logSafety(nitro,safetyDay,"08:10");
await logSafety(tadalafil,safetyDay,"08:15","skipped");
await logSafety(duplicate,safetyDay,"01:15");
await logSafety(unknown,safetyDay,"09:10");
await logSafety(fictional,relative(-1),"23:30");
const firstDose=await logSafety(fictional,safetyDay,"00:30","taken","2");
await logSafety(fictional,safetyDay,"01:00","taken","2");
assert.match(await medHtml(safety),/有来源的相互作用 · 西地那非与硝酸甘油/);
assert.match(await medHtml(safety),/实际服用记录存在重复成分 · 验收共同成分/);
assert.doesNotMatch(await medHtml(safety),/潜在同类治疗重复 · 他达拉非与西地那非/);
assert.match(await medHtml(safety),/验收未知成分 的部分记录缺少/);
assert.match(await medHtml(safety),/尚无适用且已核对的剂量规则/);
const planFor=(batch)=>medSave(plans,{drugId:batch.drugId,batchId:batch.itemId,dose:"2",unit:"片",frequency:"2",
  times:"08:00,09:00",timeZone:"Asia/Shanghai",startOn:safetyDay,source:"leaflet"});
await planFor(fictional);
await planFor(sildenafil);
await planFor(tadalafil);
const baseline=await medHtml(safety);
assert.match(baseline,/潜在同类治疗重复 · 他达拉非与西地那非/);
assert.match(baseline,/同日计划：验收组合丙、验收组合甲/);
assert.doesNotMatch(baseline,/同日记录：验收组合丙、验收组合甲/);

const rule={drugId:fictional.drugId,sourceType:"prescription",sourceRef:"测试处方 · 限制核对",
  sourceUrl:"https://example.test/source",appliesTo:"仅自动化测试档案",effectiveOn:relative(-1),timeZone:"Asia/Shanghai",
  unit:"片",maxSingle:"1",maxDaily:"3",maxCount:"1",minIntervalMinutes:"120",verified:"yes"};
assert.equal((await medRequest(safety,{...rule,verified:""})).status,400);
assert.equal((await medRequest(safety,rule,accountB)).status,404);
await medSave(safety,rule);
const evaluated=await medHtml(safety+"?date="+safetyDay);
assert.match(evaluated,/当天记录合计 4 片；日总量上限 3 片/);
assert.match(evaluated,/当天有 2 次服用记录；次数上限 1/);
assert.match(evaluated,/记录间隔 60 分钟/);
assert.match(evaluated,/计划间隔低于核对值/);
assert.match(evaluated,/计划日总量 4 片/);
assert.match(evaluated,/测试处方 · 限制核对/);
assert.match(evaluated,/https:\/\/example.test\/source/);
assert.doesNotMatch(await medHtml(safety,accountB),/验收剂量甲|测试处方/);

const logKey=new URL(firstDose,origin).searchParams.get("id");
const beforeIngredientEdit=sqlite.prepare("SELECT ingredientsSnapshot FROM MedicationLog WHERE id=?").get(logKey).ingredientsSnapshot;
assert.match(beforeIngredientEdit,/验收共同成分/);
await logSafety(fictional,safetyDay,"07:00","taken","1","盒");
const unmatchedUnits=await medHtml(safety);
assert.match(unmatchedUnits,/部分剂量单位或数量无法按此规则比较/);
assert.doesNotMatch(unmatchedUnits,/当天记录合计 4 片/);
await medSave(meds+"/profiles",{id:fictional.drugId,name:"验收剂量甲",ingredients:"验收更换成分 | 2 | mg | 每片 | 测试标签"});
assert.equal(sqlite.prepare("SELECT ingredientsSnapshot FROM MedicationLog WHERE id=?").get(logKey).ingredientsSnapshot,beforeIngredientEdit);
assert.match(await medHtml(safety),/实际服用记录存在重复成分 · 验收共同成分/);
const pausedRule=sqlite.prepare("SELECT active,revision FROM MedicationSafetyRule WHERE drugId=?").get(fictional.drugId);
assert.equal(pausedRule.active,0);
await medSave(safety,{...rule,revision:pausedRule.revision});
const currentRule=sqlite.prepare("SELECT revision FROM MedicationSafetyRule WHERE drugId=?").get(fictional.drugId);
await medSave(safety,{drugId:fictional.drugId,revision:currentRule.revision,operation:"disable"});
assert.doesNotMatch(await medHtml(safety),/当天有 3 次服用记录/);
console.log("Drug M3 passed: labeled combination sources, separate inventory and recorded overlap, user-verified thresholds, cross-day intervals, immutable ingredient history and user isolation.");
const deletion=await makeSafetyDrug("药品删除验收","");
await logSafety(deletion,safetyDay,"10:10");
await planFor(deletion);
const deletionPlan=sqlite.prepare("SELECT id FROM MedicationPlan WHERE drugId=?").get(deletion.drugId).id;
const medDeletePath=meds+"/"+deletion.itemId;
assert.match(await medHtml(medDeletePath),/删除药品批次/);
assert.equal((await medRequest(medDeletePath,{operation:"delete"},accountB)).status,404);
assert.equal((await medRequest(meds+"/profiles",{operation:"delete",id:deletion.drugId})).status,409);
await medSave(medDeletePath,{operation:"delete"});
assert.equal((await medRequest(medDeletePath)).status,404);
assert.equal(sqlite.prepare("SELECT batchId FROM MedicationPlan WHERE id=?").get(deletionPlan).batchId,null);
assert.equal((await medRequest(meds+"/profiles",{operation:"delete",id:deletion.drugId})).status,409);
await medSave(plans,{id:deletionPlan,operation:"ended"});
await medSave(meds+"/profiles",{operation:"delete",id:deletion.drugId});
assert.equal((await medRequest(meds+"/profiles?id="+deletion.drugId)).status,404);
assert.match(await medHtml(logs),/药品删除验收/);
console.log("Record deletion passed: all five modules, dependent records, and drug owner isolation.");
const autoBatch=await makeSafetyDrug("服用联动验收","");
const autoProfile=meds+"/profiles?id="+autoBatch.drugId;
const automatic={drugId:autoBatch.drugId,requestKey:crypto.randomUUID(),status:"taken",
  amount:"2",unit:"片",occurredAtLocal:safetyDay+"T08:00"};
const autoSaved=await medSave(logs,automatic);
assert.match(await medHtml(autoSaved),/库存合计：8 片/);
assert.match(await medHtml(autoProfile),/当前库存合计：8 片/);
assert.equal((await medRequest(logs,automatic)).status,409);
assert.match(await medHtml(autoProfile),/当前库存合计：8 片/);
const secondBatch=await medSave(meds+"/new",{drugId:autoBatch.drugId,purchasedAmount:"4",unit:"片"});
assert.match(await medHtml(autoProfile),/当前库存合计：12 片/);
const unspecified=await medRequest(logs,{...automatic,requestKey:crypto.randomUUID()});
assert.equal(unspecified.status,400);
assert.match(await unspecified.text(),/多个单位一致/);
await medSave(secondBatch.split("?")[0],{operation:"delete"});
assert.match(await medHtml(autoProfile),/当前库存合计：8 片/);
assert.equal(sqlite.prepare("SELECT count(*) n FROM MedicationLog WHERE batchId=?").get(autoBatch.itemId).n,1);
await medSave(meds+"/"+autoBatch.itemId,{operation:"delete"});
assert.match(await medHtml(autoProfile),/当前库存合计：暂无在库数量/);
assert.match(await medHtml(logs),/服用联动验收/);
console.log("Automatic medication stock refresh passed after intake, duplicate protection, and deleting one or all batches.");
}

{
  sqlite.exec(readFileSync("drizzle/0011_demo_auth.sql", "utf8"));
  sqlite.exec(readFileSync("drizzle/0012_demo_workspace.sql", "utf8"));
  const invite = "test-invitation-0000000000000001";
  const invitationHash = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(invite))).toString("hex");
  assert.equal((await hostedDemo.fetch(new Request(origin+"/items/food"),{DB})).status,503);
  assert.equal((await hostedDemo.fetch(new Request(origin+"/items/medicine"),{DB,DEMO_ACCOUNT_MODE:"enabled"})).status,503);
  const demoEnv = { DB, DEMO_ACCOUNT_MODE:"enabled", DEMO_PUBLIC_ORIGIN:origin, DEMO_INVITATION_HASHES:invitationHash };
  const auth = (path, fields, cookie, source=origin, fetchSite) => hostedDemo.fetch(new Request("https://internal-worker.test" + path, {
    method: fields ? "POST" : "GET", body: fields ? new URLSearchParams(fields) : undefined,
    headers:{origin:source, ...(fetchSite ? {"sec-fetch-site":fetchSite}:{}), ...(cookie ? {cookie}:{}), "oai-authenticated-user-id":"untrusted-for-demo"},
  }),demoEnv);
  const password = "an initial test password";
  const account = {username:"course-check",password,invitation:invite};
  const cookieOf = (response) => response.headers.get("set-cookie").split(";")[0];
  assert.equal((await auth("/")).status,200);
  assert.equal((await auth("/items/food")).status,401);
  assert.equal((await auth("/items/medicine/new",{ name:"blocked" })).status,401);
  assert.equal((await auth("/register",account,undefined,"https://bad.test")).status,403);
  assert.equal((await auth("/register",account,undefined,"https://internal-worker.test")).status,403);
  assert.equal((await auth("/register",account,undefined,"null")).status,403);
  assert.equal((await auth("/register",account,undefined,"null","cross-site")).status,403);
  assert.equal((await auth("/register",account,undefined,"null","same-site")).status,403);
  const registered=await auth("/register",{...account,username:"ＣＯＵＲＳＥ－ＣＨＥＣＫ"},undefined,"null","same-origin");
  assert.equal(registered.status,303);
  assert.match(registered.headers.get("set-cookie"),/Secure; HttpOnly; SameSite=Lax/);
  const first=cookieOf(registered);
  assert.equal((await auth("/register",{...account,username:"second-check"})).status,400);
  assert.equal((await auth("/login",{...account,password:"incorrect"})).status,401);
  const signedIn=await auth("/login", account, undefined, "null", "same-origin");
  assert.equal(signedIn.status,303);
  const second=cookieOf(signedIn);
  assert.notEqual(first,second);
  assert.match(await (await auth("/account",null,second)).text(),/course-check/);
  assert.equal((await auth("/items/food",null,second)).status,200);
  const passwordChange=await auth("/account/password",{password,newPassword:"a different test password"},second);
  assert.equal(passwordChange.status,303);
  assert.equal((await auth("/account",null,first)).status,303);
  assert.equal((await auth("/account",null,second)).status,303);
  const latest=cookieOf(passwordChange);
  assert.equal((await auth("/account",null,latest)).status,200);
  assert.match((await auth("/logout",{},latest)).headers.get("set-cookie"),/Max-Age=0/);
  assert.equal((await auth("/account",null,latest)).status,303);
  const currentTime=Date.now;
  const fixedTime=currentTime();
  Date.now=()=>fixedTime;
  try {
    for(let attempts=0;attempts<9;attempts++) {
      const response=await auth("/login",{username:"unknown-user",password:"incorrect"});
      assert.equal(response.status,attempts<8?401:429);
    }
  } finally {
    Date.now=currentTime;
  }

  const secondInvite = "test-invitation-0000000000000002";
  demoEnv.DEMO_TEST_INVITATION_HASHES = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secondInvite))).toString("hex");
  const cCourse = cookieOf(await auth("/login",{username:account.username,password:"a different test password"}));
  const cVisitor = cookieOf(await auth("/register",{username:"visitor-check",password,invitation:secondInvite}));
  const [courseHome, visitorHome] = await Promise.all([auth("/",null,cCourse),auth("/",null,cVisitor)]);
  assert.equal(courseHome.status,200);
  assert.equal(visitorHome.status,200);
  assert.match(await courseHome.text(),/我的账号/);
  const createScoped = async (path, fields, cookie) => {
    const response=await auth(path,fields,cookie,"null","same-origin");
    assert.equal(response.status,303,(await response.text()).match(/role="alert">([^<]+)/)?.[1]||path);
    return response.headers.get("location").split("?")[0];
  };
  const foodPath=await createScoped("/items/food/new",{name:"账号一独立果汁",purchasedAmount:"3",unit:"瓶",expiresOn:relative(1)},cCourse);
  assert.match(await (await auth(foodPath,null,cCourse)).text(),/账号一独立果汁/);
  assert.equal((await auth(foodPath,null,cVisitor)).status,404);
  assert.equal((await auth(foodPath,{operation:"delete"},cVisitor)).status,404);
  assert.equal((await auth(foodPath+"/edit",{remainingAmount:"0"},cVisitor)).status,404);
  const visitorFood=await createScoped("/items/food/new",{name:"账号二独立果汁",purchasedAmount:"1",unit:"瓶"},cVisitor);
  assert.equal((await auth(visitorFood,null,cVisitor)).status,200);
  assert.equal((await auth(visitorFood,null,cCourse)).status,404);
  assert.doesNotMatch(await (await auth("/",null,cVisitor)).text(),/账号一独立果汁/);
  assert.doesNotMatch(await (await auth("/items/food",null,cVisitor)).text(),/账号一独立果汁/);
  const medicinePath=await createScoped("/items/medicine/new",{drugId:"new",name:"账号一独立药品",purchasedAmount:"5",unit:"片"},cCourse);
  assert.equal((await auth(medicinePath,null,cCourse)).status,200);
  assert.equal((await auth(medicinePath,null,cVisitor)).status,404);
  assert.equal((await auth(medicinePath,{operation:"delete"},cVisitor)).status,404);
  assert.equal((await auth(medicinePath+"/edit",{remainingAmount:"0"},cVisitor)).status,404);
  for (const type of ["clothing","device","subscription"]) {
    const path=await createScoped("/items/"+type+"/new",{name:"账号一独立档案"},cCourse);
    assert.equal((await auth(path,null,cCourse)).status,200);
    assert.equal((await auth(path,null,cVisitor)).status,404);
    assert.equal((await auth(path,{operation:"delete"},cVisitor)).status,404);
  }
  const review=await auth("/items/food/intake",{method:"text",text:"今天买了一瓶苹果汁，10天后过期"},cCourse);
  assert.equal(review.status,200);
  const draft=idOfDraft(await review.text());
  const confirmation={operation:"confirm",draft,"candidate-0-foodId":"new","candidate-0-name":"隔离录入果汁",
    "candidate-0-purchasedAmount":"1","candidate-0-unit":"瓶"};
  assert.equal((await auth("/items/food/intake",confirmation,cVisitor)).status,409);
  assert.equal((await auth("/items/food/intake",confirmation,cCourse)).status,303);
  assert.match(await (await auth("/items/food",null,cCourse)).text(),/隔离录入果汁/);
  assert.doesNotMatch(await (await auth("/items/food",null,cVisitor)).text(),/隔离录入果汁/);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM Item WHERE name LIKE '账号一独立%'").get().n,0);
  assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_check").all(),[]);
  console.log("Demo workspaces passed: both accounts seeded, five modules isolated, cross-account deletion and draft confirmation rejected.");
  console.log("Demo account authentication passed: invite reuse, origin, route gate, two sessions, password change, logout, and rate limit.");
}

{
 const root="/items/clothing";
 const response=await post(root+"/new",{name:"衣橱验收外套",purchase:"两年前买的",material:"棉，羊毛",frequency:"经常穿",weather:"晴天",care:"不可漂白",minTemp:"5",maxTemp:"20"});
 assert.equal(response.status,303);
 const path=response.headers.get("location").split("?")[0];
 const id=path.split("/").at(-1);
 const saved=JSON.parse(sqlite.prepare("SELECT wardrobe FROM ClothingDetail WHERE itemId=?").get(id).wardrobe);
 assert.equal(saved.purchase.precision,"estimate");
 assert.equal(saved.purchase.estimated,true);
 assert.match(await html(root+"?material="+encodeURIComponent("羊毛")) ,/衣橱验收外套/);
 assert.doesNotMatch(await html(root+"?temperature=30"),/衣橱验收外套/);
 const edit=await post(path,{name:"衣橱验收外套",purchase:"两年前买的",material:"棉",minTemp:"10",maxTemp:"5"});
 assert.equal(edit.status,400);
 assert.equal(JSON.parse(sqlite.prepare("SELECT wardrobe FROM ClothingDetail WHERE itemId=?").get(id).wardrobe).minTemp,5);
 for(const [value,precision] of [["2024年5月","month"],["2023年","year"],["2024年5月15日","day"],["一年半前","estimate"],["两三年前买的","estimate"]]){
   assert.equal((await post(path,{name:"衣橱验收外套",purchase:value})).status,303);
   assert.equal(JSON.parse(sqlite.prepare("SELECT wardrobe FROM ClothingDetail WHERE itemId=?").get(id).wardrobe).purchase.precision,precision);
 }
 assert.equal((await post(path,{operation:"archive"})).status,303);
 assert.equal((await post(path,{operation:"restore"})).status,303);
 assert.match(await html(root),/衣橱验收外套/);
 console.log("Wardrobe passed: date precision, relative dates, filtering, temperature validation, archive and restore.");
}

{
 const created=await post("/items/clothing/new",{name:"旧精度验证衣物",purchasedOn:"2023-05-01",material:"棉"});
 assert.equal(created.status,303);
 const path=created.headers.get("location");
 const id=path.split("?")[0].split("/").at(-1);
 sqlite.prepare("UPDATE ClothingDetail SET wardrobe=NULL,purchasedOn='2023-05-01' WHERE itemId=?").run(id);
 assert.match(await html(path),/2023-05-01/);
 const multi=new URLSearchParams({name:"旧精度验证衣物",purchase:"2023-05-01",weatherCustom:"雾天"});
 multi.append("material","棉");multi.append("material","羊毛");
 assert.equal((await post(path,multi)).status,303);
 assert.match(await html(path),/name="material" value="羊毛" checked/);
 assert.equal((await post(path,{name:"旧精度验证衣物",purchase:""})).status,303);
 assert.match(await html(path),/购买时间未填写/);
 assert.equal(sqlite.prepare("SELECT purchasedOn FROM ClothingDetail WHERE itemId=?").get(id).purchasedOn,null);
 for(const purchase of ["2024-02-30","0000年","2099年","前几年买的","2024年13月"]){
  assert.equal((await post(path,{name:"旧精度验证衣物",purchase})).status,400,purchase);
 }
 for(const purchase of ["2024年5月购买","2023年购入","买了两年","2024-05-15"]){
  assert.equal((await post(path,{name:"旧精度验证衣物",purchase})).status,303,purchase);
 }
 const before=sqlite.prepare("SELECT wardrobe FROM ClothingDetail WHERE itemId=?").get(id).wardrobe;
 const parsed=JSON.parse(before);
 assert.equal((await post(path,{name:"修改其他字段",purchase:parsed.purchase.raw})).status,303);
 assert.deepEqual(JSON.parse(sqlite.prepare("SELECT wardrobe FROM ClothingDetail WHERE itemId=?").get(id).wardrobe).purchase,parsed.purchase);
 console.log("Wardrobe compatibility passed: legacy dates, explicit clearing, multiselect, invalid dates and stable reference.");
}

{
 const response=await post("/items/clothing/new",{name:"节日购买验收",purchase:"前几年春节买的",confirmedYear:"2022",material:"棉，羊毛"});
 assert.equal(response.status,303);
 const path=response.headers.get("location").split("?")[0],id=path.split("/").at(-1);
 const data=JSON.parse(sqlite.prepare("SELECT wardrobe FROM ClothingDetail WHERE itemId=?").get(id).wardrobe);
 assert.equal(data.purchase.raw,"前几年春节买的");
 assert.equal(data.purchase.value,"2022");
 assert.equal(data.purchase.precision,"year");
 assert.equal(data.purchase.estimated,true);
 assert.equal((await post(path,{name:"节日购买验收",purchase:"前几年春节买的",confirmedYear:"2099"})).status,400);
 assert.match(await html("/items/clothing?material="+encodeURIComponent("棉，羊毛")),/节日购买验收/);
 assert.doesNotMatch(await html("/items/clothing?material="+encodeURIComponent("棉，真丝")),/节日购买验收/);
 console.log("Wardrobe confirmation passed: ambiguous time keeps original text and confirmed year; combined tags require all selections.");
}

{
 const formPage=await html("/items/clothing/new");
 assert.match(formPage,/快速录入/);
 assert.doesNotMatch(formPage,/<textarea/);
 const manualPage=await html("/items/clothing/new?mode=manual");
 assert.doesNotMatch(manualPage,/记得多准确|大概几年前|模糊时间可/);
 assert.match(formPage,/手动录入/);
 assert.match(manualPage,/type="date"/);
 assert.doesNotMatch(manualPage,/type="month"/);
 assert.match(manualPage,/<option >经常穿/);
 const before=sqlite.prepare("SELECT count(*) n FROM Item WHERE category='clothing'").get().n;
 const review=await post("/items/clothing/intake",{text:"两年前买了一件羊毛外套，花了399元，经常穿，需要干洗。"});
 assert.equal(review.status,200);
 const content=await review.text();
 assert.match(content,/value="羊毛外套"/);
 assert.match(content,/value="399"/);
 assert.match(content,/value="羊毛" checked/);
 assert.match(content,/action="\/items\/clothing\/new"/);
 assert.equal(sqlite.prepare("SELECT count(*) n FROM Item WHERE category='clothing'").get().n,before);
 const saved=await post("/items/clothing/new",{name:"时间选择验收",purchaseMode:"manual",purchaseDay:"2024-05-15",material:"棉"});
 assert.equal(saved.status,303);
 const id=saved.headers.get("location").split("/").at(-1);
 assert.equal(JSON.parse(sqlite.prepare("SELECT wardrobe FROM ClothingDetail WHERE itemId=?").get(id).wardrobe).purchase.precision,"day");
 console.log("Wardrobe intake passed: natural text extraction, editable review without writes, date/month picker save.");
}

{
 const day="2026-11-19";
 for(const [text,expected] of [
  ["记得3天内吃完","2026-11-22"],["两天之内喝完","2026-11-21"],
  ["一周内吃完","2026-11-26"],["一个星期内用完","2026-11-26"],
  ["十天后到期","2026-11-29"],["明天到期","2026-11-20"],
  ["保质期10天",""],["两天内吃完，三天内吃完",""],
 ]){
  assert.equal(resolveFoodDates(text,day).expiresOn,expected,text);
 }
 const review=await post("/items/food/intake",{method:"text",timeZone:"Asia/Shanghai",text:"记录：今天买了两斤饺子，放冰箱了，记得3天内吃完。"});
 assert.equal(review.status,200);
 const page=await review.text();
 assert.match(page,/name="candidate-0-name"[^>]*value="饺子"/);
 assert.match(page,/name="candidate-0-purchasedAmount"[^>]*value="2"/);
 assert.match(page,/name="candidate-0-unit"[^>]*value="斤"/);
 assert.match(page,new RegExp('name="candidate-0-expiresOn"[^>]*value="'+relative(3)+'"'));
 assert.match(page,/按用户描述计算到期日期/);
 assert.match(page,/请确认储存位置/);
 for(const [text,name,unit] of [
   ["帮我记一下：刚才买了两桶方便面，放柜子里了","方便面","桶"],
   ["记录 今天买了三盒酸奶，放冷藏了，明天到期","酸奶","盒"],
   ["记一下：昨天买了一袋大米，保质期10天","大米","袋"],
 ]){
  const r=await post("/items/food/intake",{method:"text",text,timeZone:"Asia/Shanghai"});
  assert.equal(r.status,200);
  const html=await r.text();
  assert.ok(html.includes('value="'+name+'"'),text);
  assert.ok(html.includes('value="'+unit+'"'),text);
 }
 const clothing=await post("/items/clothing/intake",{text:"帮我记录：两年前入手了一件羊毛外套，总共399元，不怎么穿，收在衣柜里。"});
 assert.equal(clothing.status,200);
 const card=await clothing.text();
 assert.match(card,/value="羊毛外套"/);
 assert.match(card,/value="399"/);
 assert.match(card,/很少穿/);
 console.log("Colloquial food and wardrobe passed: prefixes, use-by deadlines, duration ambiguity, units, locations, purchase synonyms and frequency.");
}

{
 for(const text of [
   "记录：刚才买了一盒感冒灵颗粒，12包，每天三次，每次一包，饭后服用",
   "帮我记一下：今天买了一盒测试药片，24片，每日两次，每次一片",
   "记一下：昨天买了两盒测试胶囊，每盒12粒",
 ]){
  const response=await worker.fetch(new Request(origin+"/items/medicine/intake",{method:"POST",
    headers:{origin,"oai-authenticated-user-id":"drug-speech-audit"},
    body:new URLSearchParams({method:"text",text,timeZone:"Asia/Shanghai"})}),{DB});
  assert.equal(response.status,200,text);
  const html=await response.text();
  assert.match(html,/name="name"/);
  assert.doesNotMatch(html,/value="记录|value="帮我记|value="记一下/);
  if(text.includes("感冒灵"))assert.match(html,/value="感冒灵颗粒"/);
 }
 console.log("Colloquial medication passed: dictation prefixes, just-purchased batches, package quantities and dosage instructions.");
}

{
 const review=await post("/items/food/intake",{method:"text",timeZone:"Asia/Shanghai",text:"记录：今天买了两斤饺子，放冰箱了，记得3天内吃完。"});
 const text=await review.text(),draft=idOfDraft(text);
 const response=await post("/items/food/intake",{operation:"confirm",draft,
  "candidate-0-foodId":"new","candidate-0-name":"口语验收饺子","candidate-0-purchasedAmount":"2",
  "candidate-0-unit":"斤","candidate-0-locationId":"fridge","candidate-0-expiresOn":relative(3)});
 assert.equal(response.status,303);
 const row=sqlite.prepare("SELECT f.*,i.id FROM FoodDetail f JOIN Item i ON i.id=f.itemId WHERE i.name='口语验收饺子'").get();
 assert.equal(row.expiresOn,relative(3));
 assert.equal(row.stockUnit,"斤");
 assert.match(await html("/items/food"),/口语验收饺子/);
 assert.match(await html("/items/food/"+row.id),new RegExp(relative(3)));
 console.log("Use-by deadline persisted with batch and appears in inventory and detail after confirmation.");
}

{
 const fields={foodId:"new",name:"生产日计算验收",purchasedAmount:"1",unit:"袋",locationId:"cupboard",
  expiryMode:"duration",shelfLifeDays:"10",producedOn:"2026-11-01"};
 assert.equal((await post(base+"/new",{...fields,producedOn:""})).status,400);
 const saved=await post(base+"/new",fields);
 assert.equal(saved.status,303);
 const path=saved.headers.get("location").split("?")[0];
 const id=path.split("/").at(-1);
 let row=sqlite.prepare("SELECT * FROM FoodDetail WHERE itemId=?").get(id);
 assert.equal(row.expiresOn,"2026-11-11");
 assert.equal(row.shelfLifeBase,"production");
 assert.doesNotMatch(await html(path+"/edit"),/保质期计算起点/);
 assert.equal((await post(path+"/edit",{expiryMode:"date",expiresOn:"2026-12-01"})).status,303);
 row=sqlite.prepare("SELECT * FROM FoodDetail WHERE itemId=?").get(id);
 assert.equal(row.expiresOn,"2026-12-01");
 assert.equal(row.shelfLifeBase,null);
 assert.equal(row.shelfLifeDays,null);
 const review=await post(base+"/intake",{method:"text",text:"买了一袋面粉，生产日期2026年11月1日，保质期10天",timeZone:"Asia/Shanghai"});
 assert.equal(review.status,200);
 assert.match(await review.text(),/name="candidate-0-expiresOn"[^>]*value="2026-11-11"/);
 console.log("Food date modes passed: production-based calculation, missing production rejected, direct date switch, and intake calculation.");
}

{
 const created=await post(base+"/new",{foodId:"new",name:"开封简化验收",purchasedAmount:"2",unit:"盒",locationId:"cupboard",openedState:"opened",timeZone:"Asia/Shanghai"});
 assert.equal(created.status,303);
 const path=created.headers.get("location").split("?")[0],id=path.split("/").at(-1);
 let row=sqlite.prepare("SELECT * FROM FoodDetail WHERE itemId=?").get(id);
 assert.equal(row.packaging,"opened");
 assert.equal(row.openedOn,relative(0));
 const rules=sqlite.prepare("SELECT count(*) n FROM ReminderRule WHERE itemId=?").get(id).n;
 const edit=await html(path+"/edit");
 assert.match(edit,/是否开封/);
 assert.doesNotMatch(edit,/name="frozenOn"|冷冻日期/);
 assert.equal((await post(path+"/edit",{openedState:"opened",openedOn:relative(-1)})).status,303);
 assert.equal(sqlite.prepare("SELECT openedOn FROM FoodDetail WHERE itemId=?").get(id).openedOn,relative(-1));
 assert.equal((await post(path+"/edit",{openedState:"sealed"})).status,303);
 row=sqlite.prepare("SELECT * FROM FoodDetail WHERE itemId=?").get(id);
 assert.equal(row.openedOn,null);
 assert.equal(row.packaging,"sealed");
 assert.equal(sqlite.prepare("SELECT count(*) n FROM ReminderRule WHERE itemId=?").get(id).n,rules);
 console.log("Food opening selector passed: today default, editable date, sealed reset, frozen date removed, no extra reminder.");
}
