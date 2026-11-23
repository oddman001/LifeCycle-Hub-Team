import { subscriptionExtract } from "./subscription-intake.mjs";
import { deviceExtract } from "./device-intake.mjs";
import { wardrobeRoute } from "./wardrobe.mjs";
import { demoAuthRoute } from "./demo-auth.mjs";
import { localAuthRoute } from "./local-auth.mjs";
import { catalog, styles, browser } from "./generated.mjs";
import { parseQuantity } from "./quantity.mjs";
import { allFoodRows, ensureFoodData, foodActive, foodTasks, foodTitle, foodRoute } from "./food.mjs";
import { drugHomeData, drugRoute } from "./drug.mjs";

const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) =>
  ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[ch]);
const tables = { food: "FoodDetail", medicine: "MedicineDetail", clothing: "ClothingDetail", device: "DeviceDetail", subscription: "SubscriptionDetail" };
const dateField = (key) => /On$|Until$|By$/.test(key);
const cycles = { 年: "年", 季度: "季度", 月: "月" };
const legacyCycle = { 每年: "年", 每季度: "季度", 季: "季度", 每季: "季度", 每月: "月" };
const stockOf = (detail) => detail?.stockCount == null
  ? parseQuantity(detail?.quantity)
  : { amount: detail.stockCount, unit: detail.stockUnit };
const link = (href, title, cls = "", attrs = "") => `<a class="${cls}" href="${href}"${attrs?" "+attrs:""}>${title}</a>`;
const subscriptionStatuses = {active:"使用中",paused:"已暂停",cancelled:"已取消"};
const subscriptionDue = rows => rows.filter(r=>!r.lifecycleStatus||r.lifecycleStatus==="active").flatMap(r=>[
  ["cancel-notice",r.cancelBy,"取消通知截止"],
  ["renewal",r.nextChargeOn,"续费 / 扣费"],
  ["expiry",r.endsOn,"订阅到期"]
].filter(([,date])=>foodDate(date)).map(([kind,date,title])=>({id:r.id||r.itemId,category:"subscription",name:r.name,kind,title,dueOn:date}))).sort((a,b)=>a.dueOn.localeCompare(b.dueOn)||a.kind.localeCompare(b.kind));
const deviceStatuses = {using:"使用中",idle:"闲置",repair:"维修中",retired:"已停用"};
const moduleIcons = {food:"refrigerator",medicine:"pill",clothing:"shirt",device:"laptop",subscription:"credit-card"};
const uiIcon = (name) => uiIcons[name] || uiIcons.house;
const emptyInventory = (message,base,label,description="可以调整上方条件查看已有记录，或添加新内容。可选信息可以稍后补充。") => `<div class="empty guided-empty"><p>${escape(message)}</p><small>${escape(description)}</small><div class="food-toolbar">${link(base+"/new",escape(label),"button secondary")}</div></div>`;
const filterSummary = (count,href,params) => {
  const active=[...params.entries()].filter(([key,value])=>["q","category","location","packaging","status","sort","usage","warranty","lifecycle","kind","material","frequency","weather","care","temperature"].includes(key)&&value&&!(key==="status"&&value==="active")&&!(key==="sort"&&["updated","expiry"].includes(value)));
  return `<div class="filter-summary" role="status"><span>找到 <strong>${count}</strong> 条结果${active.length?` · 已应用 ${active.length} 项条件`:""}</span>${active.length?link(href,"清除筛选","filter-reset"):""}</div>`;
};
const backLink = (href,label) => link(href,uiIcon("arrow-left")+`<span>${escape(label)}</span>`,"back-link");
const hero = (title, description, action = "") => `<header class="hero"><div><h1>${title}</h1><p>${description}</p></div>${action}</header>`;
const entryButton = (href,label,variant="primary",disabled=false) => disabled
  ? `<span class="btn btn-${variant}" role="link" aria-disabled="true">${label}</span>`
  : link(href,label,"btn btn-"+variant);
const moduleEntry = (quick,manual,active="") => {
  const standard=["/items/food/","/items/medicine/","/items/clothing/","/items/device/","/items/subscription/"].some(prefix=>quick.startsWith(prefix));
  const button=(href,label,variant)=>standard?entryButton(href,label,variant):link(href,label,variant==="primary"?"button":"button secondary");
  return `<div class="module-entry mode-switch${standard?" entry-actions":""}" role="group" aria-label="选择录入方式">${active==="quick"?"":button(quick,(standard?uiIcon("plus"):"＋ ")+"快速录入","primary")}${active==="manual"?"":button(manual,"手动录入","secondary")}</div>`;
};
function deleteControl(label,name,fields="") {
  return `<details class="archive"><summary>删除${label}</summary><form method="post">${fields}
    <p>确认删除「${escape(name)}」？删除后将从相应列表中移除。</p>
    <button class="button secondary" name="operation" value="delete">确认删除${label}</button></form></details>`;
}
async function deleteItem(db,id,category,user=null) {
  const now=new Date().toISOString();
  const owner=user?" AND EXISTS(SELECT 1 FROM DrugBatch b WHERE b.itemId=Item.id AND b.userId=?)":"";
  const where="id=? AND category=? AND deletedAt IS NULL"+owner;
  const keys=user?[id,category,user]:[id,category];
  const statements=[
    foodRead(db,`INSERT INTO LifecycleEvent (id,itemId,kind,occurredAt)
      SELECT ?,id,'delete',? FROM Item WHERE ${where}`,crypto.randomUUID(),now,...keys),
    foodRead(db,`UPDATE Item SET deletedAt=?,archivedAt=coalesce(archivedAt,?),updatedAt=? WHERE ${where}`,now,now,now,...keys),
  ];
  if (user) statements.push(foodRead(db,`UPDATE MedicationPlan SET batchId=NULL,updatedAt=? WHERE userId=? AND batchId=?
    AND EXISTS(SELECT 1 FROM Item WHERE id=? AND deletedAt=?)`,now,user,id,id,now));
  return (await db.batch(statements))[1].meta.changes>0;
}

function render(content, status = 200) {
  const nav = Object.entries(catalog).map(([key, meta]) => link("/items/" + key, uiIcon(moduleIcons[key]) + " " + meta.title)).join("");
  return new Response(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>LifeCycle Hub · 团队本地版</title><style>${styles}</style><script type="module" src="/assets/forms.js"></script><body class="personal-ui"><a class="skip-link" href="#main-content">跳到主要内容</a><header class="app-topbar"><button class="button secondary menu-button" type="button" data-nav-open aria-controls="app-navigation" aria-expanded="false">${uiIcon("menu")} 菜单</button>${link("/","LifeCycle Hub","brand")}</header><dialog id="app-navigation" class="app-drawer" aria-label="导航菜单"><div class="drawer-heading"><strong>LifeCycle Hub</strong><button class="button secondary" type="button" data-nav-close aria-label="关闭导航">${uiIcon("x")} 关闭</button></div><nav aria-label="主导航">${link("/",uiIcon("house")+" 总览")}${nav}</nav></dialog><main id="main-content" tabindex="-1">${content}</main></body></html>`, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; form-action 'self'; base-uri 'none'" },
  });
}

async function seed(db) {
  if (await db.prepare("SELECT id FROM Item WHERE id = 'demo-milk'").first()) return;
  const now = new Date();
  const day = (offset) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(new Date(+now + offset * 86400000));
  const examples = [
    ["milk", "鲜牛奶", "food", { batch: "M-021", expiresOn: day(4), storage: "冷藏", quantity: "1 箱 × 12 瓶", stockCount: 12, stockUnit: "瓶" }],
    ["rice", "东北大米", "food", { batch: "R-008", storage: "密封，置于阴凉干燥处" }],
    ["medicine", "演示药品 A", "medicine", { ingredient: "示例成分", expiresOn: day(90) }],
    ["coat", "羊毛大衣", "clothing", { material: "羊毛", frequency: "冬季每周两次" }],
    ["laptop", "日常笔记本", "device", { brand: "示例品牌", model: "L14", configuration: "16 GB 内存 / 512 GB SSD" }],
    ["stream", "影音会员", "subscription", { billingInterval: "每月", feeCents: 2500, autoRenew: 1, nextChargeOn: day(10), cancelBy: day(8) }],
  ];
  const queries = examples.flatMap(([key, name, category, fields]) => {
    const id = "demo-" + key;
    return [
      db.prepare("INSERT OR IGNORE INTO Item (id,name,category,updatedAt) VALUES (?,?,?,?)").bind(id, name, category, now.toISOString()),
      writeDetail(db, category, id, fields, true),
    ];
  });
  for (const [key, title, kind, offset] of [
    ["milk", "检查牛奶有效期", "expiry", 2],
    ["rice", "检查干货储存", "inspection", 7],
    ["stream", "确认是否继续订阅", "cancel-notice", 7],
  ]) {
    queries.push(db.prepare("INSERT OR IGNORE INTO ReminderRule (id,itemId,kind,title) VALUES (?,?,?,?)")
      .bind("rule-" + key, "demo-" + key, kind, title));
    queries.push(db.prepare("INSERT OR IGNORE INTO Notification (id,ruleId,dueOn) VALUES (?,?,?)")
      .bind("reminder-" + key, "rule-" + key, day(offset)));
  }
  await db.batch(queries);
}

function writeDetail(db, category, id, fields, insertOnly = false) {
  const keys = Object.keys(fields);
  const updates = keys.map((key) => `${key}=excluded.${key}`).join(",");
  return db.prepare(`INSERT ${insertOnly ? "OR IGNORE " : ""}INTO ${tables[category]} (itemId,${keys.join(",")})
    VALUES (${["itemId", ...keys].map(() => "?").join(",")})${insertOnly ? "" :
      " ON CONFLICT(itemId) DO UPDATE SET " + updates + " WHERE EXISTS (SELECT 1 FROM Item WHERE id=excluded.itemId AND deletedAt IS NULL)"}`)
    .bind(id, ...Object.values(fields));
}

async function home(db,user) {
  const [counts, reminders, subscriptions] = await db.batch([
    db.prepare("SELECT category, count(*) AS count FROM Item WHERE archivedAt IS NULL AND deletedAt IS NULL AND category<>'medicine' GROUP BY category"),
    db.prepare(`SELECT i.id, i.category, i.name, r.kind, r.title, n.dueOn FROM Notification n
      JOIN ReminderRule r ON r.id=n.ruleId JOIN Item i ON i.id=r.itemId
      WHERE n.status='pending' AND i.archivedAt IS NULL AND i.deletedAt IS NULL AND i.category NOT IN ('food','medicine') ORDER BY n.dueOn`),
    db.prepare(`SELECT i.id,i.name,s.* FROM Item i JOIN SubscriptionDetail s ON s.itemId=i.id
      WHERE i.category='subscription' AND i.archivedAt IS NULL AND i.deletedAt IS NULL AND coalesce(s.lifecycleStatus,'active')='active'`),
  ]);
  const foods = await allFoodRows(db);
  const drugs = await drugHomeData(db,user);
  const today = todayFood();
  const activeFoods = foods.filter(foodActive);
  const subscriptionTasks=subscriptionDue(subscriptions.results);
  const taskMap=new Map();
  for (const task of [...reminders.results.filter(r=>r.category!=="subscription"||(subscriptions.results.some(s=>s.id===r.id)&&!["cancel-notice","renewal","billing","expiry"].includes(r.kind))),...drugs.tasks,...foodTasks(foods).map(({r,day,text})=>({id:r.id,category:"food",name:foodTitle(r),title:text,dueOn:day})),...subscriptionTasks]) {
    const key=[task.category,task.href||task.id,task.dueOn.slice(0,10),task.kind||""].join("|");
    if (!taskMap.has(key)) taskMap.set(key,task);
  }
  const tasks=[...taskMap.values()].sort((a,b)=>a.dueOn.localeCompare(b.dueOn));
  const recent=tasks.filter(t=>t.dueOn.slice(0,10)<=foodAddDays(today,7));
  const later=tasks.filter(t=>t.dueOn.slice(0,10)>foodAddDays(today,7));
  const timelineRows=rows=>rows.map((r,index)=>{
    const date=r.dueOn.slice(0,10),overdue=date<today;
    const heading=index===0||rows[index-1].dueOn.slice(0,10)!==date?`<h3 class="timeline-date">${escape(date)}</h3>`:"";
    return heading+link(r.href||`/items/${r.category}/${encodeURIComponent(r.id)}`,`<time>${escape(r.dueOn.slice(11)||"全天")}</time><span><strong>${escape(r.name)}</strong><small>${escape(catalog[r.category]?.title||"其他")} · ${escape(r.title)}</small></span><span class="reminder-state${overdue?" overdue":""}">${overdue?"已逾期":"待处理"}</span>`,"timeline-entry");
  }).join("");
  const timeline=timelineRows(recent.slice(0,8))+(recent.length>8||later.length?`<details class="home-more"><summary>展开更多事项（${Math.max(0,recent.length-8)+later.length}）</summary>${timelineRows([...recent.slice(8),...later])}</details>`:"");
  // Home is a read-only projection of existing records and plan date rules.
  const plans = user ? (await drugPlans(db,user)).filter(p=>planEffective(p,intakeClock(p.timeZone).day)) : [];
  const fresh = activeFoods.filter(r => (foodDate(r.expiresOn) && r.expiresOn <= foodAddDays(today,3)) || ["produce","meat","dairy","prepared"].includes(r.parentId||r.categoryId) ||
    (foodDate(r.producedOn)&&foodDate(r.expiresOn)&&r.expiresOn>=r.producedOn&&r.expiresOn<=foodAddDays(r.producedOn,7)))
    .sort((a,b)=>(a.expiresOn||"9999").localeCompare(b.expiresOn||"9999"));
  const freshRows = fresh.map(r=>{
    const days=foodDate(r.expiresOn)?Math.round((Date.parse(r.expiresOn)-Date.parse(today))/86400000):null;
    const urgency=days==null?"none":days<=1?"urgent":days===2?"soon":days===3?"watch":"none";
    const label=days==null?"日期未记录":days<0?"已过期 "+(-days)+" 天":days===0?"今天到期":days+" 天后到期";
    return link(foodHref(r),`<span><strong>${escape(foodTitle(r))}</strong><small>${escape(r.locationName||"位置未记录")}${r.packaging==="opened"?" · 已开封":""}</small></span><span class="dashboard-row-end"><strong>${escape(foodAmount(r))}</strong><small class="expiry-badge expiry-${urgency}">${escape(label)}</small>${r.expiresOn?`<small>${escape(r.expiresOn)}</small>`:""}</span>`);
  });
  const foodRows=freshRows.slice(0,6).join("")+(freshRows.length>6?`<details class="home-more"><summary>查看更多食品（${freshRows.length-6}）</summary><div class="dashboard-list">${freshRows.slice(6).join("")}</div></details>`:"");
  const schedule=user?await drugSchedule(db,user,plans,{includeUntimed:true}):[];
  const planRows = schedule.map(({p,time,state})=>{
    const status=state?logStatuses[state]||"待确认":"时间未设置";
    return link("/items/medicine/plans?id="+encodeURIComponent(p.id),`<time class="plan-time">${escape(time||"未定时")}</time><span><strong>${escape([p.name,p.tradeName].filter(Boolean).join(" · "))}</strong><small>${escape(p.dose==null?"剂量未记录":p.dose+" "+(p.unit||""))}${p.mealTiming?" · "+escape(p.mealTiming):""}</small><small>${escape(time||"未定时")} · ${escape(status)}</small></span><span class="plan-state plan-state-${escape(state||"unset")}">${escape(status)}</span>`,"home-plan-row");
  }).join("");
  const subscriptionDate = r => [r.cancelBy,r.nextChargeOn,r.endsOn].filter(foodDate).sort()[0]||"";
  const subscriptionRows = subscriptions.results.sort((a,b)=>(subscriptionDate(a)||"9999").localeCompare(subscriptionDate(b)||"9999")).map(r=>{
    const date=subscriptionDate(r),near=date&&date<=foodAddDays(today,7);
    const status=r.cancelStatus|| (r.endsOn&&r.endsOn<today?"已到期":r.autoRenew?"自动续费":"在用");
    return `<tr${near?' class="subscription-due"':""}><th scope="row">${link("/items/subscription/"+encodeURIComponent(r.id),escape(r.name))}</th><td>${r.feeCents!=null?"¥"+(r.feeCents/100).toFixed(2):"未记录"}<small>${escape(r.billingInterval||"周期未设置")}</small></td><td>${escape(date||"未设置")}<small>${date&&date===r.cancelBy?"取消提醒":date&&date===r.nextChargeOn?"下次扣费":"到期日期"}${near?" · 需关注":""}</small></td><td>${escape(status)}</td></tr>`;
  }).join("");
  const section = (id,title,description,href,rows,empty,action="查看全部 →") => `<section class="panel dashboard-section" id="${id}"><div class="dashboard-section-heading"><div><h2 class="home-icon-title icon-${id}">${uiIcon(id==="fresh-food"?"refrigerator":"pill")}${title}</h2><p class="muted">${description}</p></div>${link(href,action,"dashboard-text-link")}</div><div class="dashboard-list">${rows||`<p class="empty">${empty}</p>`}</div></section>`;
  return render(`<div class="dashboard">`+hero("生活总览", "关注今天需要处理的事，让手头的物品有条不紊。", `<button class="button" type="button" data-quick-open aria-haspopup="dialog">${uiIcon("plus")}快速录入</button>`)+
    `<div class="dashboard-metrics" aria-label="库存与计划概览">${[["在库食品",activeFoods.length,"/items/food"],["已开封食品",activeFoods.filter(r=>r.packaging==="opened").length,"/items/food?packaging=opened"],["当前用药计划",plans.length,"/items/medicine/plans"],["在用订阅",subscriptions.results.length,"/items/subscription"]].map(([label,count,href],index)=>link(href,`<span class="stat-icon-label">${uiIcon(["refrigerator","package-open","pill","credit-card"][index])}${label}</span><strong>${count}</strong>`,"panel dashboard-metric")).join("")}</div>
    <a class="dashboard-reminder-summary" id="pending-reminders" href="#recent-reminders">待处理提醒 · ${tasks.length} 项<span>未来 7 天及逾期 ${recent.length} 项 · 查看近期事项 ↓</span></a>
    <dialog id="quick-entry" class="quick-entry-dialog" aria-labelledby="quick-entry-title"><div class="drawer-heading"><div><h2 id="quick-entry-title">快速录入</h2><p class="muted">选择要记录的模块</p></div><button class="button secondary" type="button" data-quick-close aria-label="关闭快速录入">${uiIcon("x")} 关闭</button></div><div class="quick-module-options">${link("/items/food/intake","<strong>食品</strong><small>采购、消耗与储存</small>")}${link("/items/medicine/intake","<strong>药品</strong><small>购买、库存与用药信息</small>")}${link("/items/clothing/new?mode=quick","<strong>衣物</strong><small>购买时间与衣物标签</small>")}${link("/items/device/new?mode=quick","<strong>电子设备</strong><small>购买、配置与保修信息</small>")}${link("/items/subscription/new?mode=quick","<strong>会员订阅</strong><small>费用、周期与续费日期</small>")}</div></dialog>
    <div class="dashboard-columns">
    ${section("fresh-food","短保与生鲜","生鲜、乳制品、熟食及已记录 7 天内保质期的食品。","/items/food",foodRows,"暂无食品库存记录。")}
    ${section("current-medication","当前用药计划","仅展示各计划时区内日期覆盖今天的进行中计划。","/items/medicine/plans",planRows,"今天没有进行中的用药计划。")}
    <section class="panel dashboard-section" id="active-subscriptions"><div class="dashboard-section-heading"><h2 class="home-icon-title icon-subscription">${uiIcon("credit-card")}会员与订阅 <small>${subscriptions.results.length}</small></h2>${link("/items/subscription","管理订阅 →","dashboard-text-link")}</div><div class="subscription-table-wrap"><table class="subscription-table"><thead><tr><th>订阅</th><th>费用 / 周期</th><th>提醒日期</th><th>状态</th></tr></thead><tbody>${subscriptionRows||'<tr><td colspan="4" class="empty">暂无在用订阅。</td></tr>'}</tbody></table></div></section>
    </div><section class="panel home-timeline" id="recent-reminders"><div class="dashboard-section-heading"><div><h2 class="home-icon-title icon-reminder">${uiIcon("calendar-clock")}近期提醒</h2><p class="muted">逾期及未来 7 天事项，按日期排列。</p></div></div>${timeline||'<p class="empty">近期暂无待处理事项。</p>'}</section></div>`);
}

async function list(db, category, url) {
  const meta = catalog[category];
  const base = "/items/" + category;
  const archived = url.searchParams.get("status") === "archived";
  const query = (url.searchParams.get("q") ?? "").trim().slice(0, 120);
  const { results } = await db.prepare(`SELECT id,name,notes FROM Item WHERE category=? AND deletedAt IS NULL AND
    archivedAt IS ${archived ? "NOT " : ""}NULL AND instr(lower(name), lower(?)) > 0 ORDER BY updatedAt DESC`).bind(category, query).all();
  const scopeCount = await db.prepare(`SELECT count(*) AS n FROM Item WHERE category=? AND deletedAt IS NULL AND archivedAt IS ${archived ? "NOT " : ""}NULL`).bind(category).first();
  const emptyMessage = scopeCount.n ? "无匹配结果。" : archived ? "暂无已归档记录。" : category === "device" ? "暂无设备记录。" : "暂无订阅记录。";
  const subscriptionFilter=category==="subscription"?url.searchParams.get("lifecycle")||"":"";
  const subscriptionRows=category==="subscription"?await foodAll(db,"SELECT i.id,i.name,s.* FROM SubscriptionDetail s JOIN Item i ON i.id=s.itemId WHERE i.deletedAt IS NULL"):[];
  const subscriptionReminders=category==="subscription"&&!archived?subscriptionDue(subscriptionRows.filter(r=>results.some(i=>i.id===r.id)&&(!subscriptionFilter||(r.lifecycleStatus||"active")===subscriptionFilter))):[];
  const reminderPanel=category==="subscription"&&!archived?`<section><div class="section-heading"><h2>续费与取消提醒</h2></div><div class="panel reminder-list">${subscriptionReminders.map(r=>link(base+"/"+encodeURIComponent(r.id),`<span class="marker"></span><span><strong>${escape(r.name)}</strong><small>${escape(r.title)} · ${r.dueOn<todayFood()?"已逾期":"待处理"}</small></span><time>${escape(r.dueOn)}</time>`)).join("")||'<p class="empty">暂无使用中订阅的日期提醒。</p>'}</div></section>`:"";
  const warrantyFilter=category==="device"?url.searchParams.get("warranty")||"":"";
  const usageFilter=category==="device"?url.searchParams.get("usage")||"":"";
  const deviceDetails=category==="device"?await foodAll(db,"SELECT d.* FROM DeviceDetail d JOIN Item i ON i.id=d.itemId WHERE i.category='device' AND i.deletedAt IS NULL"):[];
  const warrantyState=d=>!d?.warrantyUntil?"unknown":d.warrantyUntil<todayFood()?"expired":"valid";
  const warrantyLabels={unknown:"保修日期未记录",expired:"已过保",valid:"保修期内"};
  const detailById=new Map(deviceDetails.map(d=>[d.itemId,d]));
  const subscriptionById=new Map(subscriptionRows.map(r=>[r.id,r]));
  const filtered=results.filter(item=>(!subscriptionFilter||(subscriptionById.get(item.id)?.lifecycleStatus||"active")===subscriptionFilter)&&(!warrantyFilter||warrantyState(detailById.get(item.id))===warrantyFilter)&&(!usageFilter||(detailById.get(item.id)?.usageStatus||"unknown")===usageFilter));
  const records = filtered.map((item) => {
    const device=detailById.get(item.id);
    const subscription=subscriptionById.get(item.id);
    const description=category==="device"?[device?.brand,device?.model,device?.configuration,deviceStatuses[device?.usageStatus]||"状态未记录",warrantyLabels[warrantyState(device)],device?.warrantyUntil].filter(Boolean).join(" · "):category==="subscription"?[subscription?.provider,subscription?.feeCents==null?"费用未记录":"¥"+(subscription.feeCents/100).toFixed(2),subscription?.billingInterval,subscriptionStatuses[subscription?.lifecycleStatus||"active"]].filter(Boolean).join(" · "):item.notes;
    return link(`${base}/${escape(item.id)}`,
      `<span class="category-icon">${meta.icon}</span><span><strong>${escape(item.name)}</strong><small>${escape(description)}</small></span><span>›</span>`);
  }).join("");
  return render(hero(meta.title, meta.description, ["device","subscription"].includes(category)?moduleEntry(base+"/new?mode=quick",base+"/new?mode=manual"):link(base + "/new", "＋ 新增档案", "button")) +
    (url.searchParams.has("deleted") ? '<p class="notice" role="status">档案已删除。</p>' : "") +
    (url.searchParams.has("archived") ? '<p class="notice" role="status">档案已归档。</p>' : "") +
    `<form class="filters"><input name="q" aria-label="按名称搜索" placeholder="按名称搜索" value="${escape(query)}"><select name="status" aria-label="档案状态"><option value="active">在用档案</option><option value="archived" ${archived ? "selected" : ""}>已归档</option></select>${category==="subscription"?`<select name="lifecycle" aria-label="订阅使用状态">${[["","全部使用状态"],...Object.entries(subscriptionStatuses)].map(([value,label])=>`<option value="${value}"${value===subscriptionFilter?" selected":""}>${label}</option>`).join("")}</select>`:""}${category==="device"?`<select name="usage" aria-label="设备使用状态">${[["","全部使用状态"],["unknown","状态未记录"],...Object.entries(deviceStatuses)].map(([value,label])=>`<option value="${value}"${value===usageFilter?" selected":""}>${label}</option>`).join("")}</select><select name="warranty" aria-label="保修状态">${[["","全部保修状态"],["valid","保修期内"],["expired","已过保"],["unknown","日期未记录"]].map(([value,label])=>`<option value="${value}"${value===warrantyFilter?" selected":""}>${label}</option>`).join("")}</select>`:""}<button class="button secondary">筛选</button></form>
    ${filterSummary(filtered.length,base,url.searchParams)}<div class="panel reminder-list">${records || emptyInventory(emptyMessage,base,category==='device'?'添加设备':'添加订阅',scopeCount.n?'请调整或清除筛选条件。':'可通过快速录入或手动录入添加记录。')}</div>${reminderPanel}`);
}

function editor(category, id, item, detail, flags = {}) {
  const base = "/items/" + category;
  const meta = catalog[category];
  const sharedForm = ["device", "subscription"].includes(category);
  const input = (key, label, value = "", kind = "text", opts = "") =>
    `<label>${label}<input name="${key}" value="${escape(value)}" type="${kind}" ${opts}></label>`;
  const inputs = Object.entries(meta.fields).filter(([key]) => !["quantity", "billingInterval", ...(category==="device"?["usageStatus"]:[]),...(category==="subscription"?["lifecycleStatus"]:[])].includes(key))
    .map(([key, label]) => input(key, category==="device"&&key==="purchasedOn"?"购入日期":label, detail[key], dateField(key) ? "date" : "text", 'maxlength="240"')).join("");
  const savedCycle = detail.billingInterval ?? "";
  const cycle = Object.hasOwn(legacyCycle, savedCycle) ? legacyCycle[savedCycle] : savedCycle;
  const custom = flags.customCycle ? savedCycle : Object.hasOwn(cycles, cycle) ? "" : cycle;
  const showCustom = Boolean(custom) || flags.customCycle;
  const subscription = category === "subscription" ? `<label>使用状态<select name="lifecycleStatus">${Object.entries(subscriptionStatuses).map(([value,label])=>`<option value="${value}"${(detail.lifecycleStatus||"active")===value?" selected":""}>${label}</option>`).join("")}</select></label><label>账单周期<select name="billingInterval" data-billing-cycle>
    <option value="">请选择</option>${Object.keys(cycles).map((option) => `<option ${cycle === option ? "selected" : ""}>${option}</option>`).join("")}
    <option value="custom" ${showCustom ? "selected" : ""}>其他</option></select></label>
    <label data-custom-cycle ${showCustom ? "" : "hidden"}>自定义周期<input name="customCycle" maxlength="80" value="${escape(custom)}" placeholder="例如：每两周" ${showCustom ? "required" : "disabled"}></label>`
    + input("fee", "周期费用（元）", detail.fee ?? (detail.feeCents == null ? "" : detail.feeCents / 100), "number", 'min="0" max="9999999.99" step="0.01"') +
    `<label>自动续费<select name="autoRenew"><option value="">未知</option><option value="yes" ${detail.autoRenew === 1 ? "selected" : ""}>开启</option><option value="no" ${detail.autoRenew === 0 ? "selected" : ""}>关闭</option></select></label>` : "";
  const deviceFields=category==="device"?`<label>使用状态<select name="usageStatus"><option value="">未记录</option>${Object.entries(deviceStatuses).map(([value,label])=>`<option value="${value}"${detail.usageStatus===value?" selected":""}>${label}</option>`).join("")}</select></label>`+input("purchasePrice","购买价格（元，选填）",detail.purchasePrice??(detail.purchasePriceCents==null?"":detail.purchasePriceCents/100),"number",'min="0" max="9999999.99" step="0.01"'):"";
  const warrantyDays=foodDate(detail.warrantyUntil)?Math.round((Date.parse(detail.warrantyUntil)-Date.parse(todayFood()))/86400000):null;
  const deviceSummary=category==="device"&&id!=="new"?`<div class="notice"><strong>${escape(deviceStatuses[detail.usageStatus]||"使用状态未记录")}</strong> · ${warrantyDays==null?"保修日期未记录":warrantyDays<0?"已过保 "+(-warrantyDays)+" 天":warrantyDays===0?"保修今天到期":"保修剩余 "+warrantyDays+" 天"}${detail.warrantyUntil?"（"+escape(detail.warrantyUntil)+"）":""}</div>`:"";
  const deviceHistory=category==="device"&&id!=="new"?`<section><div class="section-heading"><h2>维修与维护记录</h2></div><div class="panel food-list">${(flags.deviceEvents||[]).map(event=>`<div><span><strong>${escape(event.kind==="deviceRepair"?"维修":"维护")}</strong><small>${escape(event.notes)}</small></span><time>${escape(event.occurredAt.slice(0,10))}</time></div>`).join("")||'<p class="empty">暂无维修或维护记录。</p>'}</div>${item.archivedAt?'<p class="archive">已归档设备仅保留维护历史。</p>':`<form class="panel editor component-form" method="post"><input type="hidden" name="operation" value="deviceMaintenance"><input type="hidden" name="eventId" value="${crypto.randomUUID()}"><fieldset><label>类型<select name="kind"><option value="deviceMaintenance">维护</option><option value="deviceRepair">维修</option></select></label>${input("occurredOn","发生日期",todayFood(),"date","required")}<label class="wide">处理内容<textarea name="maintenanceNotes" rows="3" maxlength="2000" required></textarea></label></fieldset><button class="btn btn-primary">保存记录</button></form>`}</section>`:"";
  const archived = Boolean(item.archivedAt);
  const reviewNotice = (kind) => {
    const ai = flags[kind+"Source"] === "ai";
    const fallback = flags[kind+"Fallback"] ? "（AI 识别暂时失败，已改用本地规则。）" : "";
    return kind === "subscription"
      ? `<p class="notice" role="status">${ai?"AI 识别":"文字规则提取"}，请核对费用、周期及日期。未识别的续费和取消截止日期不会自动推算。${fallback}</p>`
      : `<p class="notice" role="status">${ai?"AI 识别":"文字规则提取"}结果，请核对。未识别字段可留空；保修时长不会自动换算截止日期。${fallback}</p>`;
  };
  const notice = flags.invalid ? `<p class="notice error" role="alert">${category==="device"?"请检查设备名称、日期、购买价格及字段格式。":"请检查订阅名称、日期、周期费用及账单周期。"}</p>`
    : flags.saved ? '<p class="notice" role="status">档案已保存。</p>' : "";
  return render(hero(item.name ? escape(item.name) : "新增" + meta.title + "档案", (sharedForm?backLink(base,category==="device"?"返回电子设备":"返回会员订阅"):link(base, "‹ " + meta.title, "muted")) + (archived ? " · 已归档" : ""), ["device","subscription"].includes(category)&&id==="new"?moduleEntry(base+"/new?mode=quick",base+"/new?mode=manual",flags.deviceReview||flags.subscriptionReview?"quick":"manual"):"") +
    notice + (flags.subscriptionReview?reviewNotice("subscription"):"") + (flags.deviceReview?reviewNotice("device"):"") + deviceSummary +
    `<form class="panel editor${sharedForm?" component-form":""}" method="post"><fieldset>${input("name",category==="device"?"设备名称":category==="subscription"?"订阅名称":"名称",item.name,"text",'required maxlength="120"')}${inputs}${subscription}${deviceFields}
    <label class="wide">备注<textarea name="notes" rows="4" maxlength="2000">${escape(item.notes)}</textarea></label></fieldset><div class="module-entry"><button class="${sharedForm?"btn btn-primary":"button"}">${["device","subscription"].includes(category)?(id==="new"?(category==="device"?"确认保存设备":"确认保存订阅"):"保存修改"):"保存档案"}</button>${sharedForm?entryButton(base,"取消","secondary"):""}</div></form>` +
    (id !== "new" && !archived ? '<details class="archive"><summary>归档档案</summary><form method="post"><p>归档后可在分类页查看。</p><button class="button secondary" name="operation" value="archive">确认归档</button></form></details>' : "") + (["device","subscription"].includes(category)&&archived?'<form class="archive" method="post"><button class="button secondary" name="operation" value="restore">恢复档案</button></form>':"") + (id!=="new"?deleteControl("档案",item.name):"") + deviceHistory, flags.invalid ? 400 : 200);
}

async function record(request, env, category, id, url) {
  const db = env.DB;
  const base = "/items/" + category;
  const existing = id === "new" ? null : await db.prepare("SELECT * FROM Item WHERE id=? AND category=? AND deletedAt IS NULL").bind(id, category).first();
  if (id !== "new" && !existing) return render(hero("找不到档案", link(base, "返回分类")), 404);
  const details = existing && await db.prepare(`SELECT * FROM ${tables[category]} WHERE itemId=?`).bind(id).first();
  const deviceEvents=category==="device"&&existing?await foodAll(db,"SELECT kind,occurredAt,notes FROM LifecycleEvent WHERE itemId=? AND kind IN ('deviceRepair','deviceMaintenance') ORDER BY occurredAt DESC,id DESC",id):[];
  const quickHint = intakeConfigured(env)
    ? `<p class="notice">已启用 AI 识别（${escape(intakeLabel(env))}），调用失败时自动改用本地规则。识别结果需核对后才会保存。</p>`
    : '<p class="notice">未配置 AI 识别，本次使用本地文字规则提取。识别结果需核对后才会保存。</p>';
  if (category==="device"&&id==="new"&&request.method==="GET"&&url.searchParams.get("mode")!=="manual") {
    return render(hero("新增设备",backLink(base,"返回电子设备"),moduleEntry(base+"/new?mode=quick",base+"/new?mode=manual",url.searchParams.get("mode")==="quick"?"quick":""))+
      (url.searchParams.get("mode")==="quick"?quickHint+`<form class="panel editor component-form" method="post" action="${base}/new"><input type="hidden" name="operation" value="deviceExtract"><input type="hidden" name="timeZone" data-intake-zone><label>描述设备<textarea name="text" rows="4" maxlength="2000" required placeholder="昨天买了一台笔记本，花了4999元，型号是A1，配置16GB，购买渠道是官方商城。"></textarea></label><div class="food-toolbar"><button class="btn btn-primary">提取信息</button>${entryButton(base,"取消","secondary")}</div></form>`:'<p class="notice">请选择快速录入或手动录入。</p>'));
  }
  if(category==="subscription"&&id==="new"&&request.method==="GET"&&url.searchParams.get("mode")!=="manual") {
    return render(hero("新增订阅",backLink(base,"返回会员订阅"),moduleEntry(base+"/new?mode=quick",base+"/new?mode=manual",url.searchParams.get("mode")==="quick"?"quick":""))+
    (url.searchParams.get("mode")==="quick"?quickHint+`<form class="panel editor component-form" method="post" action="${base}/new"><input type="hidden" name="operation" value="subscriptionExtract"><input type="hidden" name="timeZone" data-intake-zone><label>描述订阅<textarea name="text" rows="4" maxlength="2000" required placeholder="今天开通了音乐会员，每月25元，自动续费，下次扣费日期2027年1月20日。"></textarea></label><div class="food-toolbar"><button class="btn btn-primary">提取信息</button>${entryButton(base,"取消","secondary")}</div></form>`:'<p class="notice">请选择快速录入或手动录入。</p>'));
  }
  if (request.method === "GET") {
    return editor(category, id, existing ?? {}, details ?? {}, {
      saved: url.searchParams.has("saved"),
      deviceEvents,
    });
  }
  if (request.headers.get("origin") !== url.origin) return new Response("请求来源无效", { status: 403 });
  const form = await request.formData();
  const value = (key) => String(form.get(key) ?? "").trim();
  const operation = value("operation");
  const now = new Date().toISOString();
  if(category==="subscription"&&id==="new"&&operation==="subscriptionExtract") {
    try {
      const parsed=await subscriptionIntakeExtract(env,value("text"),intakeClock(intakeZone(value("timeZone"))).day);
      return editor(category,id,parsed.item,parsed.detail,{subscriptionReview:true,subscriptionSource:parsed.source,subscriptionFallback:parsed.fallback});
    }
    catch(error){return render(hero("请检查订阅描述",escape(error.message),link(base+"/new?mode=quick","返回快速录入","button")),400);}
  }
  if (category==="device"&&id==="new"&&operation==="deviceExtract") {
    try {
      const parsed=await deviceIntakeExtract(env,value("text"),intakeClock(intakeZone(value("timeZone"))).day);
      return editor(category,id,parsed.item,parsed.detail,{deviceReview:true,deviceSource:parsed.source,deviceFallback:parsed.fallback});
    } catch(error) { return render(hero("请检查设备描述",escape(error.message),link(base+"/new?mode=quick","返回快速录入","button")),400); }
  }
  if (category==="device" && operation==="deviceMaintenance") {
    if (!existing || existing.archivedAt) return new Response("请先选择在用设备",{status:409});
    const kind=value("kind"),date=value("occurredOn"),notes=value("maintenanceNotes"),eventId=value("eventId");
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(eventId)) return new Response("记录凭据无效，请刷新页面后重试",{status:400});
    const priorEvent=await foodOne(db,"SELECT itemId,kind,occurredAt,notes FROM LifecycleEvent WHERE id=?",eventId);
    if (priorEvent && (priorEvent.itemId!==id||priorEvent.kind!==kind||priorEvent.occurredAt!==date||priorEvent.notes!==notes)) return new Response("记录凭据已被使用，请刷新页面",{status:409});
    if (!["deviceRepair","deviceMaintenance"].includes(kind)||!foodDate(date)||date>todayFood()||!notes||notes.length>2000) return render(hero("请检查维护记录","请选择有效类型、非未来日期并填写处理内容。",link(base+"/"+id,"返回设备","button")),400);
    await db.batch([
      foodRead(db,`INSERT OR IGNORE INTO LifecycleEvent(id,itemId,kind,occurredAt,notes) SELECT ?,id,?,?,? FROM Item WHERE id=? AND category='device' AND archivedAt IS NULL AND deletedAt IS NULL`,eventId,kind,date,notes,id),
      foodRead(db,"UPDATE Item SET updatedAt=? WHERE id=? AND category='device' AND archivedAt IS NULL AND deletedAt IS NULL",now,id)
    ]);
    return foodRedirect(base+"/"+id+"?saved=1");
  }
  if (existing && operation === "delete") {
    await deleteItem(db,id,category);
    return foodRedirect(base+"?deleted=1");
  }
  if (["device","subscription"].includes(category) && existing && operation==="restore") {
    await db.batch([
      foodRead(db,"INSERT INTO LifecycleEvent(id,itemId,kind,occurredAt) SELECT ?,id,'restore',? FROM Item WHERE id=? AND category=? AND archivedAt IS NOT NULL AND deletedAt IS NULL",crypto.randomUUID(),now,id,category),
      foodRead(db,"UPDATE Item SET archivedAt=NULL,updatedAt=? WHERE id=? AND category=? AND archivedAt IS NOT NULL AND deletedAt IS NULL",now,id,category)
    ]);
    return foodRedirect(base+"/"+id+"?saved=1");
  }
  if (existing && operation === "archive") {
    await db.batch([
      db.prepare("INSERT INTO LifecycleEvent (id,itemId,kind,occurredAt) SELECT ?,id,'archive',? FROM Item WHERE id=? AND archivedAt IS NULL").bind(crypto.randomUUID(), now, id),
      db.prepare("UPDATE Item SET archivedAt=?,updatedAt=? WHERE id=? AND archivedAt IS NULL").bind(now, now, id),
    ]);
    return new Response(null, {status:303,headers:{location:base + "?archived=1"}});
  }
  const item = { name: value("name"), notes: value("notes") };
  const detail = Object.fromEntries(Object.keys(catalog[category].fields).map((key) => [key, value(key) || null]));
  const purchasePrice=value("purchasePrice");
  if (category==="device") {
    if ((value("usageStatus")&&!Object.hasOwn(deviceStatuses,value("usageStatus"))) || (purchasePrice&&!/^\d{1,7}(\.\d{1,2})?$/.test(purchasePrice))) return editor(category,id,{...item,archivedAt:existing?.archivedAt},{...detail,purchasePrice},{invalid:true,deviceEvents});
  }
  const fee = value("fee");
  const selectedCycle = value("billingInterval");
  const customCycle = selectedCycle === "custom";
  const invalidCycle = category === "subscription" && (customCycle
    ? !value("customCycle") || value("customCycle").length > 80
    : selectedCycle && !Object.hasOwn(cycles, selectedCycle));
  if (category === "subscription" && customCycle) detail.billingInterval = value("customCycle");
  const validDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !v.startsWith("0000") &&
    Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
  if (!item.name || item.name.length > 120 || item.notes.length > 2000 ||
      Object.entries(detail).some(([k, v]) => v && (v.length > 240 || (dateField(k) && !validDate(v)))) ||
      invalidCycle || (category === "subscription" && fee && !/^\d{1,7}(\.\d{1,2})?$/.test(fee))) {
    return editor(category, id, {...item,archivedAt:existing?.archivedAt}, { ...detail, fee, purchasePrice }, { invalid: true, customCycle,deviceEvents });
  }
  if (category === "subscription") {
    detail.lifecycleStatus=value("lifecycleStatus")||"active";
    if (!Object.hasOwn(subscriptionStatuses,detail.lifecycleStatus)||(detail.startsOn&&detail.endsOn&&detail.endsOn<detail.startsOn)) return editor(category,id,item,{...detail,fee},{invalid:true,customCycle});
    detail.feeCents = fee ? Math.round(Number(fee) * 100) : null;
    detail.autoRenew = value("autoRenew") === "yes" ? 1 : value("autoRenew") === "no" ? 0 : null;
  }
  if (category==="device") detail.purchasePriceCents=purchasePrice?Math.round(Number(purchasePrice)*100):null;
  const recordId = existing ? id : crypto.randomUUID();
  const writeItem = existing
    ? db.prepare("UPDATE Item SET name=?,notes=?,updatedAt=? WHERE id=? AND deletedAt IS NULL").bind(item.name,item.notes,now,id)
    : db.prepare("INSERT INTO Item (id,name,category,notes,updatedAt) VALUES (?,?,?,?,?)").bind(recordId,item.name,category,item.notes,now);
  const [saved] = await db.batch([writeItem, writeDetail(db, category, recordId, detail)]);
  if (!saved.meta.changes) return new Response("档案已归档", { status: 409 });
  return new Response(null, {status:303,headers:{location:`${base}/${recordId}?saved=1`}});
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (!["GET", "POST"].includes(request.method)) return new Response(null, {status:405});
      if (url.pathname === "/assets/forms.js" && request.method === "GET") {
        return new Response(browser, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" } });
      }
      if (env.LOCAL_INSTANCE === true) {
        // Local accounts are opt-in: tests and plain local runs keep the fixed local-device
        // identity, while the packaged app enables the login gate by default.
        if (/^(1|true|on|enabled|yes)$/i.test(String(env.LOCAL_ACCOUNTS ?? "").trim())) {
          return await localAuthRoute(request, env, url);
        }
        const headers = new Headers(request.headers);
        headers.set("oai-authenticated-user-id", "local-device");
        return await businessRoute(new Request(request, {headers}), env, url, "local-device");
      }
      if (requireDemoAuth && (env.DEMO_ACCOUNT_MODE !== "enabled" || !env.DEMO_PUBLIC_ORIGIN)) {
        return new Response("演示站登录暂不可用", {status:503, headers:{"cache-control":"no-store"}});
      }
      if (env.DEMO_ACCOUNT_MODE === "enabled") return await demoAuthRoute(request, env, url);
      return await businessRoute(request, env, url, request.headers.get("oai-authenticated-user-id"));
    } catch (error) {
      console.error(error instanceof Error ? error.name : "Worker error");
      return render(hero("暂时无法读取或保存档案", link("/", "返回总览")), 500);
    }
  },
};


async function businessRoute(request, env, url, identity) {
  const seedDemo = () => env.LOCAL_INSTANCE === true && env.LOCAL_DEMO_SEED !== true ? undefined : seed(env.DB);
  if (url.pathname === "/" && request.method === "GET") {
    await seedDemo();
    await ensureFoodData(env.DB);
    return await home(env.DB,identity);
  }
  if (url.pathname === "/items/food" || url.pathname.startsWith("/items/food/")) {
    await seedDemo();
    await ensureFoodData(env.DB);
    return await foodRoute(request,env,url);
  }
  if (url.pathname === "/items/medicine" || url.pathname.startsWith("/items/medicine/")) {
    if (identity) await seedDemo();
    return await drugRoute(request,env,url);
  }
  if (url.pathname === "/items/clothing" || url.pathname.startsWith("/items/clothing/")) {
    await seedDemo();
    return await wardrobeRoute(request,env,url);
  }
  const [, category, id] = url.pathname.match(/^\/items\/([a-z]+)(?:\/([a-z0-9-]+))?\/?$/) ?? [];
  if (category && Object.hasOwn(catalog, category)) {
    await seedDemo();
    if (id) return await record(request, env, category, id, url);
    if (request.method === "GET") return await list(env.DB, category, url);
  }
  return render(hero("找不到这个页面", link("/", "返回总览")), 404);
}
