const intakeCleanSpeech = (text) => String(text ?? "").normalize("NFKC").trim().replace(/^(?:帮我记一下|帮我记录|记一下|记录)(?:一下)?\s*[:：]?\s*/, "");
const foodRoot = "/items/food";
const foodSubtypes = {
  produce: ["新鲜蔬菜水果", "叶菜类", "根茎类", "瓜果类", "浆果类", "其他水果"],
  meat: ["肉类与水产品", "猪肉", "牛羊肉", "禽肉", "鱼类", "虾蟹及其他水产品"],
  dairy: ["乳制品与蛋类", "牛奶", "酸奶", "奶酪", "黄油", "鸡蛋", "其他乳制品"],
  prepared: ["烘焙食品与熟食", "面包", "蛋糕", "熟食", "剩菜", "预制食品"],
  dry: ["谷物与干货", "大米", "面粉", "燕麦", "豆类", "干菌菇", "坚果", "其他干货"],
  frozen: ["冷冻食品", "速冻水饺", "冷冻肉类", "冷冻蔬菜", "冰淇淋", "其他冷冻食品"],
  packaged: ["罐头与包装食品", "罐头", "方便食品", "包装零食", "即食食品"],
  seasoning: ["调味品与食用油", "酱油", "食醋", "食用油", "调味酱", "香料", "其他调味品"],
  drinks: ["饮料与冲调食品", "果汁", "饮料", "咖啡", "茶", "奶粉", "其他冲调食品"],
};
const foodLocations = [
  ["fridge","冰箱冷藏室","冷藏"], ["freezer","冰箱冷冻室","冷冻"],
  ["drawer","冷藏抽屉","冷藏"], ["cupboard","厨房储物柜","常温"],
  ["shelf","常温储物架","常温"], ["dry-cabinet","干货储存柜","常温"],
  ["unassigned","待归位",null],
];
const foodPackages = {sealed:"未开封", opened:"已开封", portioned:"已分装", unknown:"未知"};
const foodDispositions = {active:"在库", consumed:"已消耗", discarded:"已丢弃", portioned:"已全部分装"};
const foodEventLabels = { purchase:"购买", intake:"入库", open:"开封", move:"转移位置", freeze:"冷冻",
  thaw:"解冻", portion:"分装", consume:"部分消耗", consumeAll:"全部消耗", adjust:"数量调整",
  discard:"丢弃", check:"储存检查", archive:"归档", packaging:"更新包装状态", batchEdit:"编辑批次", restore:"恢复在库" };
const todayFood = () => new Intl.DateTimeFormat("sv-SE", {timeZone:"Asia/Shanghai"}).format(new Date());
const localTimeFood = () => new Intl.DateTimeFormat("sv-SE", {timeZone:"Asia/Shanghai",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(new Date());
const foodDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !value.startsWith("0000") &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
const foodAddDays = (day, offset) => new Date(Date.parse(day) + offset * 86400000).toISOString().slice(0,10);
const foodOption = (value, label, current) => `<option value="${escape(value)}"${value === current ? " selected" : ""}>${escape(label)}</option>`;
const foodOptions = (rows, selected) => rows.map((r) => foodOption(r.id, r.id==="unassigned"?"待指定存储位置":r.name, selected)).join("");
const foodDropdown = (name, label, options, attrs = "") => `<label>${label}<select name="${name}" ${attrs}>${options}</select></label>`;
const foodInput = (name, label, value, attrs = "") =>
  `<label>${label}<input name="${name}" value="${escape(value)}" ${attrs}></label>`;
const foodForm = (content, button, action = "", component = "") => `<form class="panel editor food-form${component?" "+component:""}" method="post" ${action ? `action="${action}"` : ""}>
  <fieldset>${content}</fieldset><button class="${component?"btn btn-primary":"button"}">${button}</button></form>`;
const foodModuleForm = (content,button,action="") => foodForm(content,button,action,"component-form");
const foodButton = (url, label) => link(url, label, "button");
const foodBack = (title, description = "", action = "") => hero(title, backLink(foodRoot,"返回食品库存") + (description ? " · " + description : ""), action);
const foodRedirect = (location) => new Response(null, {status:303,headers:{location}});
const foodError = (message, back = foodRoot, status = 400) =>
  render(foodBack("请检查输入", escape(message), foodButton(back, "返回")), status);
const foodValue = (form, key) => String(form.get(key) ?? "").trim();
const foodRead = (db, sql, ...args) => db.prepare(sql).bind(...args);
const foodAll = async (db, sql, ...args) => (await foodRead(db, sql, ...args).all()).results;
const foodOne = (db, sql, ...args) => foodRead(db, sql, ...args).first();

async function ensureFoodData(db) {
  if (!await foodOne(db, "SELECT id FROM StorageLocation WHERE id='unassigned'")) {
    const statements = foodLocations.map(([id,name,kind]) =>
      foodRead(db, "INSERT OR IGNORE INTO StorageLocation (id,name,kind,builtIn) VALUES (?,?,?,1)", id,name,kind));
    for (const [id,[name,...children]] of Object.entries(foodSubtypes)) {
      statements.push(foodRead(db, "INSERT OR IGNORE INTO FoodCategory(id,name) VALUES (?,?)",id,name));
      children.forEach((child,index) => statements.push(foodRead(db,
        "INSERT OR IGNORE INTO FoodCategory(id,name,parentId) VALUES (?,?,?)",id+"-"+index,child,id)));
    }
    await db.batch(statements);
  }
  const legacy = await foodAll(db,`SELECT i.id,i.name,f.* FROM FoodDetail f JOIN Item i ON i.id=f.itemId
    WHERE f.foodId IS NULL OR f.locationId IS NULL LIMIT 30`);
  if (!legacy.length) return;
  const statements = legacy.flatMap((row) => {
    const id = "legacy-" + row.id;
    const sample = row.id === "demo-milk" ? ["dairy-0","fridge",3,null] :
      row.id === "demo-rice" ? ["dry-0","dry-cabinet",null,30] : [null,"unassigned",null,null];
    const stock = stockOf(row);
    return [
      foodRead(db,"INSERT OR IGNORE INTO FoodItem (id,name,categoryId,specification) VALUES (?,?,?,?)",id,row.name,sample[0],row.quantity),
      foodRead(db,`UPDATE FoodDetail SET foodId=coalesce(foodId,?), locationId=coalesce(locationId,?),
        purchasedAmount=coalesce(purchasedAmount,?), purchasedUnit=coalesce(purchasedUnit,?), remainingAmount=coalesce(remainingAmount,?),
        stockUnit=coalesce(stockUnit,?), packaging=CASE WHEN openedOn IS NOT NULL THEN 'opened' ELSE packaging END,
        disposition=CASE WHEN stockCount=0 THEN 'consumed' ELSE disposition END,
        expiryLead=coalesce(expiryLead,?), checkDays=coalesce(checkDays,?)
        WHERE itemId=? AND (foodId IS NULL OR locationId IS NULL)`,
      id,sample[1],parseQuantity(row.quantity)?.amount ?? null,parseQuantity(row.quantity)?.unit ?? null,
      stock?.amount ?? null,stock?.unit ?? null,sample[2],sample[3],row.id),
    ];
  });
  await db.batch(statements);
}

const foodRowsSql = `SELECT f.*, i.id,i.name AS oldName,i.notes,i.archivedAt,i.createdAt,
  i.updatedAt,p.name,p.brand,p.categoryId,p.specification,p.storageAdvice,p.imageUrl,
  c.name AS categoryName,c.parentId,CASE WHEN sl.id='unassigned' THEN '待指定存储位置' ELSE sl.name END AS locationName,
  nullif(max(coalesce(f.portionCheckAnchor,''),coalesce((SELECT MAX(checkedOn) FROM FoodInspection WHERE itemId=i.id),'')),'') AS checkedOn
  FROM FoodDetail f JOIN Item i ON i.id=f.itemId
  LEFT JOIN FoodItem p ON p.id=f.foodId LEFT JOIN FoodCategory c ON c.id=p.categoryId
  LEFT JOIN StorageLocation sl ON sl.id=f.locationId`;
const foodRow = (db, id) => foodOne(db, foodRowsSql + " WHERE i.id=? AND i.deletedAt IS NULL", id);
const allFoodRows = (db) => foodAll(db,foodRowsSql+" WHERE i.deletedAt IS NULL");
const foodActive = (r) => !r.archivedAt && r.disposition === "active";
const foodExpiryLabel = (r) => !r.expirySource || r.expirySource==="label" ? "包装标注日期" : "到期日期";
const foodExpiryReminderOn = (r) => foodDate(r.expiresOn)&&r.expiryLead!=null
  ? foodAddDays(r.expiresOn,-r.expiryLead) : null;
const foodAmount = (r) => r.amountNote ||
  (r.remainingAmount == null ? "数量未记录" : `${r.remainingAmount} ${r.stockUnit ?? ""}`);
const foodTitle = (r) => r.name || r.oldName;
const foodHref = (r) => foodRoot + "/" + encodeURIComponent(r.id);

function foodTasks(rows, today = todayFood()) {
  const week = foodAddDays(today, (7 - new Date(today).getUTCDay()) % 7);
  return rows.filter(foodActive).flatMap((r) => {
    const tasks = [];
    if (foodDate(r.expiresOn)) {
      const days = Math.round((Date.parse(r.expiresOn) - Date.parse(today)) / 86400000);
      if (days < 0 || (r.expiryLead != null && days <= r.expiryLead)) {
        const label=foodExpiryLabel(r);
        tasks.push({ r, kind: "expiry", day: r.expiresOn, days,
          text: days < 0 ? "已超过"+label : days === 0 ? label+"为今天" : `距${label}还有 ${days} 天` });
      }
    }
    if (r.checkDays) {
      const base = r.checkedOn || r.purchasedOn || r.createdAt.slice(0,10);
      const day = foodAddDays(base, r.checkDays);
      if (day <= week) tasks.push({ r, kind: "check", day,
        text: day < today ? "储存检查已逾期" : day === today ? "今天检查储存状态" : "本周检查储存状态" });
    }
    return tasks;
  }).sort((a,b) => a.day.localeCompare(b.day));
}

function foodCalendar(rows, requested, today) {
  const month=/^[2-9]\d{3}-(?:0[1-9]|1[0-2])$/.test(requested||"")?requested:today.slice(0,7);
  const first=new Date(month+"-01T00:00:00Z");
  const change=(step)=>{
    const date=new Date(first);
    date.setUTCMonth(date.getUTCMonth()+step);
    return date.toISOString().slice(0,7);
  };
  const events=new Map();
  const add=(day,row,label)=>{
    if (!foodDate(day)||!day.startsWith(month+"-")) return;
    if (!events.has(day)) events.set(day,[]);
    events.get(day).push({row,label});
  };
  for (const row of rows) {
    add(row.expiresOn,row,foodExpiryLabel(row));
    if (row.checkDays) add(foodAddDays(row.checkedOn||row.purchasedOn||row.createdAt.slice(0,10),row.checkDays),row,"储存检查");
  }
  const days=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();
  const cells=Array.from({length:days},(_,i)=>{
    const day=month+"-"+String(i+1).padStart(2,"0");
    const count=events.get(day)?.length??0;
    return count?link("#calendar-"+day,`<time datetime="${day}">${i+1}</time><small>${count} 项</small>`,"calendar-day has-event"):
      `<div class="calendar-day"><time datetime="${day}">${i+1}</time></div>`;
  }).join("");
  const agenda=[...events.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([day,list])=>
    `<div id="calendar-${day}"><time datetime="${day}">${day.slice(5)}</time><span>${list.map(({row,label})=>
      link(foodHref(row),escape(foodTitle(row))+" · "+label)).join("<br>")}</span></div>`).join("");
  return `<section id="calendar"><div class="section-heading"><h2>到期日历</h2><div class="food-toolbar">
    ${link("?month="+change(-1)+"#calendar","上月")} <strong>${month}</strong>${link("?month="+change(1)+"#calendar","下月")}</div></div>
    <div class="panel calendar-grid"><div class="calendar-weekdays" aria-label="星期">${["一","二","三","四","五","六","日"].map((label)=>'<small>'+label+'</small>').join("")}</div>
    ${"<span></span>".repeat((first.getUTCDay()+6)%7)}${cells}</div>
    <div class="panel food-list">${agenda||'<p class="empty">本月暂无到期或检查事件。</p>'}</div></section>`;
}

async function foodHome(db, url) {
  const [rows, locations, groups] = await Promise.all([allFoodRows(db),
    foodAll(db, "SELECT * FROM StorageLocation WHERE retired=0 ORDER BY builtIn DESC,rowid"),
    foodAll(db, "SELECT * FROM FoodCategory ORDER BY rowid")]);
  const active = rows.filter(foodActive);
  const today = todayFood();
  const tasks = foodTasks(active, today);
  const q = url.searchParams;
  const location = q.get("location") ?? "";
  const category = q.get("category") ?? "";
  const packaging = q.get("packaging") ?? "";
  const sort = q.get("sort") ?? "expiry";
  const status = q.get("status") === "archived" ? "history" : q.get("status") ?? "active";
  const search = (q.get("q") ?? "").trim().slice(0,120);
  const inventory = rows.filter((r) => (status === "history" ? !foodActive(r) : foodActive(r)) &&
    (!location || r.locationId === location) && (!category || r.categoryId === category || r.parentId === category) &&
    (!packaging || r.packaging === packaging) && foodTitle(r).toLowerCase().includes(search.toLowerCase()));
  inventory.sort((a,b) => sort === "purchase"
    ? (b.purchasedOn || "").localeCompare(a.purchasedOn || "")
    : (a.expiresOn || "9999").localeCompare(b.expiresOn || "9999"));
  const taskBlock = (list) => `<div class="panel reminder-list">${list.map(({r,day,text}) =>
    link(foodHref(r), `<span class="marker"></span><span><strong>${escape(foodTitle(r))}</strong><small>${escape(text)} · ${escape(r.locationName)}</small></span><time>${escape(day)}</time>`)
  ).join("") || '<p class="empty">暂无待处理事项。</p>'}</div>`;
  const due = tasks.filter((t) => t.kind === "expiry");
  const checks = tasks.filter((t) => t.kind === "check");
  const metrics = [["在库批次",active.length],["临期批次",due.filter((t) => t.days >= 0).length],
    ["待检查批次",checks.length],["已开封批次",active.filter((r) => r.openedOn || r.packaging === "opened").length]];
  const badge = (r) => foodActive(r) && r.expiresOn && r.expiresOn < today
    ? "已超过"+foodExpiryLabel(r) : foodActive(r) ? foodPackages[r.packaging] : (r.archivedAt ? "已归档" : foodDispositions[r.disposition]);
  return render(hero("食品库存", "查看食品库存、批次及存储信息。", moduleEntry(foodRoot+"/intake",foodRoot+"/new"))
    + `<div class="food-toolbar">${link(foodRoot+"/profiles","食品档案与分类","button secondary")}${link(foodRoot+"/locations","管理存储位置","button secondary")}${link(foodStatsPath,"消耗统计","button secondary")}</div>
    <section class="food-metrics">${metrics.map(([label,count]) => `<div class="panel"><small>${label}</small><strong>${count}</strong></div>`).join("")}</section>
    <section><div class="section-heading"><h2>优先处理</h2></div>${taskBlock(tasks.filter((t) => t.kind === "expiry" || t.day <= today).slice(0,8))}</section>
    <section><div class="section-heading"><h2>存储位置</h2></div><div class="category-grid">${locations.map((r) =>
      link(foodRoot+"?location="+encodeURIComponent(r.id)+"#inventory", `<strong>${escape(r.id==="unassigned"?"待指定存储位置":r.name)}</strong><small>${active.filter((a) => a.locationId===r.id).length} 个批次${location===r.id?" · 已选择":""}</small>`,"panel category",location===r.id?'aria-current="true"':"")).join("")}</div></section>
    ${q.has("deleted")?'<p class="notice" role="status">食品批次已删除。</p>':""}
    <section id="inventory"><div class="section-heading"><h2>库存批次</h2></div>
    ${q.has("imported") ? '<p class="notice" role="status">已保存确认的食品批次。</p>' : ""}
    <form class="filters">
      <input name="q" aria-label="搜索食品名称" placeholder="搜索食品名称" value="${escape(search)}">
      ${foodDropdown("category","分类",foodCategoryOptions(groups,category).replace("暂未分类","全部分类"))}
      ${foodDropdown("location","位置",foodOption("","全部位置",location)+foodOptions(locations,location))}
      ${foodDropdown("packaging","包装",foodOption("","全部包装状态",packaging)+Object.entries(foodPackages).map(([id,label])=>foodOption(id,label,packaging)).join(""))}
      ${foodDropdown("sort","排序",foodOption("expiry","到期日期",sort)+foodOption("purchase","购买日期",sort))}
      ${foodDropdown("status","记录",foodOption("active","当前库存",status)+foodOption("history","历史批次",status))}
      <button class="button secondary">筛选</button></form>
      ${filterSummary(inventory.length,foodRoot+"#inventory",q)}<div class="panel food-list">${inventory.map((r) => link(foodHref(r), `<span><strong>${escape(foodTitle(r))}</strong><small>${escape(r.locationName)} · ${escape(badge(r))}${r.purchasedOn ? " · 购买 "+escape(r.purchasedOn) : ""}${r.expiresOn ? " · 到期 "+escape(r.expiresOn) : ""}</small></span><strong>${escape(foodAmount(r))}</strong>`)).join("") || emptyInventory(rows.some(r=>status==="history"?!foodActive(r):foodActive(r))?'无匹配结果。':status==="history"?'暂无历史库存记录。':'暂无库存记录。',foodRoot,'添加食品',rows.some(r=>status==="history"?!foodActive(r):foodActive(r))?'请调整或清除筛选条件后重试。':'可添加食品并记录数量、日期和存储位置。')}</div></section>
    <section><div class="section-heading"><h2>周期检查</h2></div>${taskBlock(checks)}</section>
    ${foodCalendar(active,q.get("month"),today)}
    <p class="food-muted">到期日期以确认记录为准。储存检查日期用于库存管理。</p>`);
}

const foodFields = (form, specification, editing = false, source = "label") => {
  const get = (key) => foodValue(form,key);
  const spec = get("quantity") || specification || "";
  const detected = parseQuantity(spec);
  const unit = get("unit") || detected?.unit || null;
  const amount = get("purchasedAmount") ? Number(get("purchasedAmount")) : editing ? null : detected?.amount ?? null;
  const remaining = get("remainingAmount") ? Number(get("remainingAmount")) : editing ? null : amount;
  const purchasedUnit = form.has("purchasedUnit") ? get("purchasedUnit") || null : unit;
  const note = get("amountNote");
  if (form.has("openedState")) {
    if (!["sealed","opened"].includes(get("openedState"))) return null;
    if (get("openedState")==="sealed") {
      form.set("openedOn","");
      if (get("packaging")!=="portioned") form.set("packaging","sealed");
    } else {
      form.set("openedOn",get("openedOn") || intakeClock(get("timeZone") || "Asia/Shanghai").day);
      form.set("packaging","opened");
    }
  }
  const requestedPackaging = get("packaging") || "sealed";
  const packaging = get("openedOn")&&requestedPackaging==="sealed" ? "opened" : requestedPackaging;
  const dates = ["purchasedOn","producedOn","expiresOn","openedOn","frozenOn"];
  const expiryLead = get("expiryLead") === "" ? null : Number(get("expiryLead"));
  const checkDays = get("checkDays") === "" ? null : Number(get("checkDays"));
  const shelfLifeDays = get("expiryMode")==="date" || get("shelfLifeDays")==="" ? null : Number(get("shelfLifeDays"));
  const mode = get("expiryMode");
  const shelfLifeBase = mode === "duration" ? (get("shelfLifeBase")==="purchase" ? "purchase" : "production") : mode === "date" ? "" : get("shelfLifeBase");
  const baseDate = shelfLifeBase==="production" ? get("producedOn") : get("purchasedOn");
  const validAmount = (v) => v == null || (Number.isFinite(v) && v >= 0 && v <= 1000000);
  if (dates.some((key) => get(key) && !foodDate(get(key))) ||
      !Object.hasOwn(foodPackages,packaging) ||
      !validAmount(amount) || !validAmount(remaining) || (amount!=null&&!purchasedUnit) || (remaining!=null&&!unit) ||
      !["","production","purchase"].includes(shelfLifeBase) ||
      (shelfLifeDays!=null && (!Number.isInteger(shelfLifeDays)||shelfLifeDays<1||shelfLifeDays>36500)) ||
      (shelfLifeBase && (!shelfLifeDays || !foodDate(baseDate))) ||
      (expiryLead != null && (!Number.isInteger(expiryLead) || expiryLead < 0 || expiryLead > 3650)) ||
      (checkDays != null && (!Number.isInteger(checkDays) || checkDays < 1 || checkDays > 3650)) ||
      [spec,note,get("storage"),get("batch")].some((v) => v.length > 240) || (unit?.length ?? 0) > 20 || (purchasedUnit?.length ?? 0) > 20) return null;
  const fromShelf=shelfLifeBase ? foodAddDays(baseDate,shelfLifeDays) : "";
  if (fromShelf&&!foodDate(fromShelf)) return null;
  const expiresOn=fromShelf||get("expiresOn")||null;
  return {
    batch:get("batch") || null, quantity:spec || null, storage:get("storage") || null,
    purchasedOn:get("purchasedOn") || null, producedOn:get("producedOn") || null,
    expiresOn, expirySource:expiresOn ? fromShelf?"shelf":source : null,
    shelfLifeDays,shelfLifeBase:shelfLifeBase||null, openedOn:get("openedOn") || null,
    frozenOn:get("frozenOn") || null, purchasedAmount:amount, purchasedUnit, remainingAmount:remaining, amountNote:note || null,
    stockUnit:unit, packaging, disposition:remaining === 0 && !note ? "consumed" : "active",
    expiryLead,checkDays,
  };
};
const foodEvent = (db,id,kind,now,notes = null) =>
  foodRead(db,"INSERT INTO LifecycleEvent (id,itemId,kind,occurredAt,notes) VALUES (?,?,?,?,?)",
    crypto.randomUUID(),id,kind,now,notes);

const foodCategoryOptions = (rows, current) => foodOption("","暂未分类",current) + rows.filter((r) => !r.parentId).map((root) =>
  `<optgroup label="${escape(root.name)}">${foodOption(root.id,root.name,current)}${foodOptions(rows.filter((child) => child.parentId===root.id),current)}</optgroup>`).join("");
const foodUnits = ["个","盒","袋","瓶","罐","克","千克","毫升","升","kg","g","mL","L"];
const foodNumberAttrs = 'type="number" step="any" min="0" max="1000000"';
const foodUnitInput = (name,value) => foodInput(name,"数量单位",value,'list="food-units" maxlength="20"') +
  `<datalist id="food-units">${foodUnits.map((u) => `<option value="${u}">`).join("")}</datalist>`;
const foodShelfFields = (key,row) =>
  foodDropdown(key("expiryMode"),"有效期填写方式",
    foodOption("date","到期日期",row?.expirySource==="shelf" ? "duration" : row?.expiresOn ? "date" : row?.shelfLifeDays ? "duration" : "date")+
    foodOption("duration","保质期",row?.expirySource==="shelf" ? "duration" : row?.expiresOn ? "date" : row?.shelfLifeDays ? "duration" : "date"),'data-food-expiry-mode')+
  foodInput(key("shelfLifeDays"),"保质期（天）",row?.shelfLifeDays,'type="number" min="1" max="36500"')+
  foodDropdown(key("shelfLifeBase"),"保质期起点",
    foodOption("production","生产日期",row?.shelfLifeBase==="purchase" ? "purchase" : "production")+
    foodOption("purchase","购买日期",row?.shelfLifeBase==="purchase" ? "purchase" : "production"),'data-food-expiry-base');

async function foodReferenceData(db) {
  return Promise.all([
    foodAll(db,"SELECT * FROM FoodItem WHERE deletedAt IS NULL ORDER BY name"),
    foodAll(db,"SELECT * FROM StorageLocation WHERE retired=0 ORDER BY builtIn DESC,rowid"),
    foodAll(db,"SELECT * FROM FoodCategory ORDER BY rowid"),
  ]);
}

function foodProfileFields(profile, categories, required = true, compact = false) {
  const name=foodInput("name","食品名称",profile?.name,'maxlength="120"'+ (required ? " required" : ""));
  const brand=foodInput("brand","品牌",profile?.brand,'maxlength="120"');
  const basics=foodDropdown("categoryId","食品分类",foodCategoryOptions(categories,profile?.categoryId ?? ""))+
    foodInput("specification","默认规格",profile?.specification,'maxlength="240" placeholder="例如：1 箱 × 12 瓶"');
  const extra=foodInput("storageAdvice","默认储存说明",profile?.storageAdvice,'maxlength="240" placeholder="可记录包装说明及出处"')+
    foodInput("imageUrl","图片链接",profile?.imageUrl,'type="url" maxlength="500"')+
    foodInput("profileNotes",compact?"食品备注":"档案备注",profile?.notes,'maxlength="500"');
  return compact?name+basics+'<details class="wide intake-more"><summary>更多食品信息（选填，可稍后补充）</summary><div>'+brand+extra+'</div></details>':name+brand+basics+extra;
}

function foodBatchFields(row, locations, editing = false) {
  const presets = ["1 瓶","1 箱 × 6 瓶","1 箱 × 12 瓶","1 箱 × 24 瓶","1 盒","1 袋"];
  return foodDropdown("locationId","存储位置",foodOptions(locations,row?.locationId || "unassigned"),"required") +
    foodInput("storage","储存方式与条件",row?.storage,'maxlength="240" placeholder="例如：密封、避光，核对包装说明"') +
    foodInput("batch","批次编号",row?.batch,'maxlength="240"') +
    foodDropdown("openedState","是否开封",
      foodOption("sealed","未开封",row?.openedOn || row?.packaging==="opened" ? "opened" : "sealed")+
      foodOption("opened","已开封",row?.openedOn || row?.packaging==="opened" ? "opened" : "sealed"),'data-food-open-state')+
    (row?.packaging==="portioned" ? '<input type="hidden" name="packaging" value="portioned">' : "") +
    foodInput("purchasedOn","购买或制作日期",row?.purchasedOn,'type="date"'+(editing ? "" : " data-purchase-date")) +
    foodInput("purchaseTime","购买时间",row?.purchasedAtLocal?.slice(11) ?? "",'type="time"'+(editing ? "" : " data-purchase-time")) +
    `<input type="hidden" name="timeZone" value="${escape(row?.purchaseTimeZone || "Asia/Shanghai")}" ${editing ? "" : "data-intake-zone"}>` +
    foodInput("producedOn","生产日期",row?.producedOn,'type="date"') +
    foodInput("expiresOn","到期日期",row?.expiresOn,'type="date"') +
    foodShelfFields((key)=>key,row) +
    foodInput("openedOn","开封日期",row?.openedOn,'type="date" data-food-open-date') +
    '<label>常用包装<select data-package-preset><option value="">自定义规格</option>' +
    presets.map((value)=>foodOption(value,value,row?.quantity)).join("") + '</select></label>' +
    `<div>${foodInput("quantity","包装规格",row?.quantity,'data-package-spec maxlength="240" placeholder="例如：2 箱 × 12 瓶"')}
      <small data-stock-preview aria-live="polite"></small></div>` +
    foodInput("purchasedAmount","购买数量",row?.purchasedAmount,foodNumberAttrs) +
    (editing ? foodInput("purchasedUnit","购买单位",row?.purchasedUnit,'list="food-units" maxlength="20"') : "") +
    foodInput("remainingAmount","当前剩余数量",row?.remainingAmount,foodNumberAttrs+(editing?"":' placeholder="默认同购买数量"')) +
    foodUnitInput("unit",row?.stockUnit) +
    foodInput("amountNote","模糊数量",row?.amountNote,'maxlength="240" placeholder="例如：半袋、剩余少量"') +
    (editing ? row.disposition==="portioned"?intakeHidden("disposition","portioned"):
      foodDropdown("disposition","库存状态",Object.entries(foodDispositions).filter(([key])=>key!=="portioned")
      .map(([k,v])=>foodOption(k,v,row.disposition)).join("")) : "") +
    foodInput("expiryLead","提前提醒天数",row?.expiryLead,'type="number" min="0" max="3650" placeholder="留空不提醒临期"') +
    foodInput("checkDays","储存检查周期（天）",row?.checkDays,'type="number" min="1" max="3650" placeholder="留空不启用"') +
    foodInput("notes","批次备注",row?.notes,'maxlength="2000"');
}

async function foodProfileData(form, db) {
  const read = (key) => foodValue(form,key);
  const profile = {name:read("name"),brand:read("brand"),categoryId:read("categoryId") || null,
    specification:read("specification"),storageAdvice:read("storageAdvice"),imageUrl:read("imageUrl"),notes:read("profileNotes")};
  if (!profile.name || profile.name.length > 120 || profile.brand.length > 120 ||
    profile.specification.length > 240 || profile.storageAdvice.length > 240 || profile.notes.length > 500 ||
    (profile.imageUrl && (profile.imageUrl.length > 500 || !/^https:\/\/[^\s]+$/i.test(profile.imageUrl))) ||
    (profile.categoryId && !await foodOne(db,"SELECT id FROM FoodCategory WHERE id=?",profile.categoryId))) return null;
  return profile;
}

function foodWriteProfile(db,id,profile,update = false) {
  const fields = Object.keys(profile);
  return update
    ? foodRead(db,`UPDATE FoodItem SET ${fields.map((f)=>f+"=?").join(",")} WHERE id=?`,...Object.values(profile),id)
    : foodRead(db,`INSERT INTO FoodItem (id,${fields.join(",")}) VALUES (${["id",...fields].map(()=>"?").join(",")})`,id,...Object.values(profile));
}

async function foodCreate(db, form, now = new Date().toISOString(), stageOnly = false, sources = null, stagedProfileId = null, followup = null) {
  const choice = foodValue(form,"foodId");
  const selected = choice==="new" ? "" : choice;
  const loc = foodValue(form,"locationId") || "unassigned";
  const profile = selected ? await foodOne(db,"SELECT * FROM FoodItem WHERE id=? AND deletedAt IS NULL",selected) : await foodProfileData(form,db);
  const fields = foodFields(form,profile?.specification,false,sources?.expirySource||"label");
  const notes = foodValue(form,"notes");
  if (!profile || !fields || notes.length > 2000 || !await foodOne(db,"SELECT id FROM StorageLocation WHERE id=? AND retired=0",loc)) return null;
  const time = foodValue(form,"purchaseTime");
  if (time && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const manualSources=Object.fromEntries(Object.keys(fields).filter((key)=>fields[key]!=null).map((key)=>[key,"user"]));
  if (fields.purchasedOn===foodValue(form,"defaultPurchasedOn")) manualSources.purchasedOn="system";
  if (time) manualSources.purchaseTime=time===foodValue(form,"defaultPurchaseTime")?"system":"user";
  manualSources.locationId=loc==="unassigned"?"system":"user";
  const pid = selected || stagedProfileId || crypto.randomUUID();
  const id = crypto.randomUUID();
  const detail = {...fields,foodId:pid,locationId:loc,
    ...(followup ? {intakeInitialAmount:followup.initialAmount,intakeInitialUnit:followup.initialUnit||null} : {}),
    purchasedAtLocal:fields.purchasedOn && time ? fields.purchasedOn+"T"+time : null,
    purchaseTimeZone:fields.purchasedOn ? intakeZone(foodValue(form,"timeZone")) : null,
    sourceJson:JSON.stringify(sources ?? {method:"manual",fields:manualSources})};
  const keys = Object.keys(detail);
  const create = [
    ...(!selected && !stagedProfileId ? [foodWriteProfile(db,pid,profile)] : []),
    foodRead(db,"INSERT INTO Item(id,name,category,notes,updatedAt) VALUES (?,?,'food',?,?)",id,profile.name,notes,now),
    foodRead(db,`INSERT INTO FoodDetail(itemId,${keys.join(",")}) VALUES (${["id",...keys].map(()=>"?").join(",")})`,id,...Object.values(detail)),
    foodEvent(db,id,"purchase",now,[fields.purchasedOn,
      followup&&fields.purchasedAmount!=null?fields.purchasedAmount+" "+fields.purchasedUnit:null].filter(Boolean).join(" · ")||null),
    foodEvent(db,id,"intake",now),
  ];
  if (fields.openedOn || fields.packaging === "opened") create.push(foodEvent(db,id,"open",now,fields.openedOn));
  if (followup || fields.disposition === "consumed") {
    const notes=followup?.consumedAmount!=null
      ? `${followup.consumedAmount} ${followup.consumedUnit} · 本批次剩余 ${followup.remaining} ${fields.stockUnit||""}` : null;
    create.push(foodEvent(db,id,fields.disposition==="consumed"?"consumeAll":"consume",now,notes));
  }
  if (followup) create.push(foodMovement(db,{id,foodId:pid},"consume",followup.consumedAmount,followup.consumedUnit,now));
  if (stageOnly) return {id,pid,writes:create};
  await db.batch(create);
  return id;
}

async function foodNew(db, form, url) {
  if (form) {
    const id = await foodCreate(db,form);
    return id ? foodRedirect(foodRoot+"/"+id+"?saved=1&added=1") :
      foodError("请检查食品档案、位置、日期和数量。填写数字数量时也需要填写单位；选择保质期时，请填写保质期天数并补上起点日期（生产日期或购买日期）。",foodRoot+"/new");
  }
  const [profiles,locations,categories] = await foodReferenceData(db);
  const requested=url?.searchParams.get("foodId")||"";
  const selected=profiles.find(p=>p.id===requested);
  if(requested&&!selected)return foodError("找不到要补充的食品，请返回重新选择。",foodRoot,404);
  const choice=selected?.id||"new";
  const choices=foodOption("new","添加一种食品",choice)+foodOptions(profiles,choice);
  return render(foodBack(selected?"补充库存":"添加食品",selected?"本次购买单独保存，原有库存不会覆盖。":"填写食品信息、购买数量与存储位置。",moduleEntry(foodRoot+"/intake",foodRoot+"/new","manual")) +
    foodModuleForm('<div class="wide food-subhead"><h2>食品名称</h2></div>' +
      (profiles.length?foodDropdown("foodId","食品",choices,"required data-profile-picker"):'<input type="hidden" name="foodId" value="new">') +
      `<fieldset class="wide intake-fields" data-new-profile ${selected?"hidden disabled":""}>${foodProfileFields(null,categories,true,true)}</fieldset>
      <input type="hidden" name="defaultPurchasedOn" data-default-purchase-date value="${todayFood()}">
      <input type="hidden" name="defaultPurchaseTime" data-default-purchase-time value="${localTimeFood()}">
      <div class="wide food-subhead"><h2>本次购买信息</h2><p>记录数量、日期和存放位置。</p></div>` +
      foodBatchFields({purchasedOn:todayFood(),purchasedAtLocal:todayFood()+"T"+localTimeFood(),expiryLead:3},locations),selected?"确认补充库存":"保存食品","","component-form"));
}

async function foodManageLocations(db, form) {
  const locations = await foodAll(db,"SELECT * FROM StorageLocation WHERE retired=0 ORDER BY builtIn DESC,rowid");
  if (form) {
    const id = foodValue(form,"id");
    const action = foodValue(form,"operation");
    const row = locations.find((r)=>r.id===id);
    if (action === "remove") {
      if (!row || row.builtIn) return foodError("只能删除自定义位置。",foodRoot+"/locations");
      const result = await foodRead(db,`UPDATE StorageLocation SET retired=1 WHERE id=? AND builtIn=0 AND retired=0
        AND NOT EXISTS(SELECT 1 FROM FoodDetail f JOIN Item i ON i.id=f.itemId
        WHERE f.locationId=? AND f.disposition='active' AND i.archivedAt IS NULL)`,id,id).run();
      return result.meta.changes ? foodRedirect(foodRoot+"/locations") :
        foodError("该位置有关联批次。请先转移仍在库的批次，保留历史记录的位置。",foodRoot+"/locations",409);
    }
    const name = foodValue(form,"name"), kind = foodValue(form,"kind"), temperature = foodValue(form,"temperature"), notes = foodValue(form,"notes");
    if ((id && !row) || !name || name.length > 80 || !["","常温","冷藏","冷冻"].includes(kind) ||
        temperature.length > 80 || notes.length > 500) return foodError("请检查位置名称和属性。",foodRoot+"/locations");
    if (await foodOne(db,"SELECT id FROM StorageLocation WHERE name=? AND id<>?",name,id)) return foodError("已存在这个位置名称。",foodRoot+"/locations");
    if (id) await foodRead(db,"UPDATE StorageLocation SET name=?,kind=?,temperature=?,notes=? WHERE id=?",name,kind||null,temperature,notes,id).run();
    else await foodRead(db,"INSERT INTO StorageLocation(id,name,kind,temperature,notes) VALUES (?,?,?,?,?)",crypto.randomUUID(),name,kind||null,temperature,notes).run();
    return foodRedirect(foodRoot+"/locations");
  }
  const fields = (r = {}) => `<input type="hidden" name="id" value="${escape(r.id)}">` +
    foodInput("name","位置名称",r.name,'required maxlength="80"') +
    foodDropdown("kind","储存类型",["","常温","冷藏","冷冻"].map((k)=>foodOption(k,k||"未指定",r.kind||"")).join("")) +
    foodInput("temperature","温度范围",r.temperature,'maxlength="80"') +
    foodInput("notes","说明",r.notes,'maxlength="500"');
  return render(foodBack("存储位置","位置表示实际存放地点。") +
    `<section><div class="section-heading"><h2>新增位置</h2></div>${foodModuleForm(fields(),"新增位置")}</section>` +
    locations.map((r) => `<section><div class="section-heading"><h2>${escape(r.name)}</h2>
      ${link(foodRoot+"?location="+encodeURIComponent(r.id)+"#inventory","查看库存")}</div>${foodModuleForm(fields(r),"保存位置")}
      ${r.builtIn ? "" : `<form method="post" class="food-inline"><input type="hidden" name="id" value="${escape(r.id)}">
      <button class="button secondary" name="operation" value="remove">删除自定义位置</button></form>`}</section>`).join(""));
}

async function foodManageProfiles(db, form, url) {
  const [profiles,,categories] = await foodReferenceData(db);
  const roots = categories.filter((r)=>!r.parentId);
  if (form) {
    if (foodValue(form,"operation") === "subcategory") {
      const name = foodValue(form,"childName"), parentId = foodValue(form,"parentId");
      if (!name || name.length > 80 || !roots.some((r)=>r.id===parentId) ||
          categories.some((r)=>r.parentId===parentId && r.name===name)) return foodError("请检查子分类名称，且避免同组重名。",foodRoot+"/profiles");
      await foodRead(db,"INSERT INTO FoodCategory (id,name,parentId) VALUES (?,?,?)",crypto.randomUUID(),name,parentId).run();
      return foodRedirect(foodRoot+"/profiles");
    }
    const id = foodValue(form,"id");
    if (foodValue(form,"operation")==="delete") {
      const result=await foodRead(db,`UPDATE FoodItem SET deletedAt=? WHERE id=? AND deletedAt IS NULL AND NOT EXISTS(
        SELECT 1 FROM FoodDetail f JOIN Item i ON i.id=f.itemId WHERE f.foodId=? AND i.deletedAt IS NULL)`,
        new Date().toISOString(),id,id).run();
      return result.meta.changes?foodRedirect(foodRoot+"/profiles?deleted=1"):
        foodError("请先删除关联批次，或确认档案仍存在。",foodRoot+"/profiles?id="+encodeURIComponent(id),409);
    }
    const profile = await foodProfileData(form,db);
    if (!profile || (id && !profiles.some((r)=>r.id===id))) return foodError("请检查食品档案字段。",foodRoot+"/profiles");
    if (id) await db.batch([
      foodWriteProfile(db,id,profile,true),
      foodRead(db,"UPDATE Item SET name=? WHERE id IN (SELECT itemId FROM FoodDetail WHERE foodId=?)",profile.name,id),
    ]);
    else await foodWriteProfile(db,crypto.randomUUID(),profile).run();
    return foodRedirect(foodRoot+"/profiles");
  }
  const current = profiles.find((r)=>r.id===url.searchParams.get("id"));
  if (url.searchParams.has("id")&&!current) return foodError("找不到该食品档案。",foodRoot+"/profiles",404);
  const batches=current?await foodAll(db,foodRowsSql+" WHERE f.foodId=? AND i.deletedAt IS NULL ORDER BY i.createdAt DESC",current.id):[];
  const customField = '<input type="hidden" name="operation" value="subcategory">' +
    foodDropdown("parentId","一级分类",foodOptions(roots,"")) + foodInput("childName","子分类名称","",'required maxlength="80"');
  return render(foodBack("食品档案与分类","一个食品档案可以关联多个购买批次。") +
    (url.searchParams.has("deleted")?'<p class="notice" role="status">食品档案已删除。</p>':"")+
    `<section><div class="section-heading"><h2>食品信息</h2>${current ? link(foodRoot+"/profiles","添加食品信息") : ""}</div>
    <div class="panel food-list">${profiles.map((r)=>link(foodRoot+"/profiles?id="+encodeURIComponent(r.id),escape(r.name)+(r.brand ? " · "+escape(r.brand) : ""))).join("") || '<p class="empty">暂无食品档案。</p>'}</div>
    ${foodModuleForm(`<input type="hidden" name="id" value="${escape(current?.id)}">`+foodProfileFields(current,categories),current?"保存食品信息":"添加食品信息")}
    ${current?`<div class="section-heading"><h2>关联批次</h2></div><div class="panel food-list">${batches.map((row)=>
      link(foodHref(row),escape([row.batch||row.purchasedOn||"库存批次",row.locationName,foodAmount(row)].filter(Boolean).join(" · ")))).join("")||'<p class="empty">暂无关联批次。</p>'}</div>`+
      deleteControl("食品档案",current.name,intakeHidden("id",current.id)):""}</section>
    <section><div class="section-heading"><h2>自定义子分类</h2></div>${foodModuleForm(customField,"添加子分类")}</section>`);
}

const foodActionPath = (row) => foodHref(row);
const foodActionForm = (operation, content, button) =>
  foodModuleForm(`<input type="hidden" name="operation" value="${operation}">`+content,button);
const foodQuick = (operation,label) => `<form method="post"><button class="button secondary" name="operation" value="${operation}">${label}</button></form>`;

async function foodDetailPage(db,row,url) {
  const [locations,events,links] = await Promise.all([
    foodAll(db,"SELECT * FROM StorageLocation WHERE retired=0 ORDER BY builtIn DESC,rowid"),
    foodAll(db,"SELECT kind,occurredAt,notes FROM LifecycleEvent WHERE itemId=? ORDER BY occurredAt DESC,rowid DESC LIMIT 40",row.id),
    foodPortionLinks(db,row),
  ]);
  const display = (value) => escape(value || "—");
  const metric = (label,value) => `<div><dt>${label}</dt><dd>${display(value)}</dd></div>`;
  const active = foodActive(row);
  const days = active && foodDate(row.expiresOn) ? Math.round((Date.parse(row.expiresOn)-Date.parse(todayFood()))/86400000) : null;
  const expiryLabel=foodExpiryLabel(row);
  const expiryText = days == null ? "" : days < 0 ? `已超过${expiryLabel} ${-days} 天` :
    days === 0 ? expiryLabel+"为今天" : `距${expiryLabel}还有 ${days} 天`;
  const basics = `<dl class="food-details panel">
    ${metric("当前库存",foodAmount(row))}${metric("存储位置",row.locationName)}${metric("储存方式",row.storage)}
    ${metric("包装状态",foodPackages[row.packaging])}${metric("购买时间",row.purchasedAtLocal?.replace("T"," ") || row.purchasedOn)}
    ${metric("记录创建时间",row.createdAt?.replace("T"," ").slice(0,19)+" UTC")}
    ${metric("购买数量",row.purchasedAmount == null ? null : row.purchasedAmount+" "+(row.purchasedUnit||""))}
    ${row.intakeInitialAmount!=null ? metric("消耗前库存",row.intakeInitialAmount+" "+row.intakeInitialUnit) : ""}
    ${metric("批次编号",row.batch)}${metric("生产日期",row.producedOn)}${metric("批次备注",row.notes)}
    ${metric(expiryLabel,row.expiresOn)}${metric("保质期",row.shelfLifeDays?row.shelfLifeDays+" 天":"")}

    ${metric("到期提醒开始日期",active?foodExpiryReminderOn(row):null)}
    ${metric("开封日期",row.openedOn)}
    ${metric(row.portionParentId?"上次检查（含来源批次）":"上次检查",row.checkedOn)}${metric("下次检查",row.checkDays ? foodAddDays(row.checkedOn || row.purchasedOn || row.createdAt.slice(0,10),row.checkDays) : null)}
    ${metric("储存说明",row.storageAdvice)}</dl>`;
  const operationInput = '<input type="hidden" name="operation" value="move">';
  const move = foodModuleForm(operationInput + foodDropdown("locationId","目的位置",foodOptions(locations,row.locationId),"required") +
    foodDropdown("transition","记录状态事件",["move","freeze","thaw"].map((k)=>foodOption(k,foodEventLabels[k],"move")).join("")),"保存位置与状态");
  const adjust = foodActionForm("adjust",
    foodInput("amount","调整后的剩余量",row.remainingAmount,foodNumberAttrs) +
    foodUnitInput("unit",row.stockUnit) +
    foodInput("amountNote","模糊数量",row.amountNote,'placeholder="例如：约 3 kg" maxlength="240"'),"更新数量");
  const check = row.checkDays ? foodActionForm("check",
    foodInput("checkedOn","检查日期",todayFood(),'type="date" required') +
    foodInput("inspectionNotes","检查备注","",'maxlength="500" placeholder="例如：检查了密封、受潮和异味情况"'),"记录检查") : "";
  const controls = active ? `<div class="food-toolbar">
    ${foodCanPortion(row)?foodButton(foodPortionPath(row),"分装批次"):""}
    ${row.remainingAmount >= 1 ? foodQuick("consume",row.stockUnit==="瓶"?"喝掉 1 瓶":"消耗 1 "+escape(row.stockUnit)) : ""}
    ${row.packaging==="sealed" ? foodQuick("open","标记开封") : ""}${foodQuick("consumeAll","全部消耗")}
    <details><summary>更多操作</summary><div class="food-toolbar">${foodQuick("discard","标记丢弃")}${foodQuick("archive","归档")}</div></details>
    </div><div class="food-edit-grid"><section><h2>位置和状态</h2>${move}</section><section><h2>数量调整</h2>${adjust}</section></div>
    ${check ? "<section><div class='section-heading'><h2>储存检查</h2></div>"+check+"</section>" : ""}` : "";
  const message = url.searchParams.has("added") ? `<p class="notice" role="status">已记录这次购买的「${escape(foodTitle(row))}」，本次剩余 ${escape(foodAmount(row))}，位置：${escape(row.locationName||"待指定存储位置")}。其他购买记录保持不变。</p>` : url.searchParams.has("saved") ? '<p class="notice" role="status">操作已保存。</p>' : "";
  return render(foodBack(escape(foodTitle(row)),escape(row.archivedAt ? "已归档" : foodDispositions[row.disposition]),
    foodButton(foodHref(row)+"/edit","编辑批次")) + message +
    (row.foodId ? `<div class="food-toolbar">${link(foodRoot+"/profiles?id="+encodeURIComponent(row.foodId),"查看食品信息")}${link(foodRoot+"/new?foodId="+encodeURIComponent(row.foodId),"补充库存","button secondary")}</div>` : "") +
    (expiryText ? `<p class="notice">${escape(expiryText)}</p>` : "") + basics + controls + links +
    deleteControl("食品批次",foodTitle(row)+(row.batch?" · "+row.batch:""))+
    `<section><div class="section-heading"><h2>批次事件</h2></div><div class="panel food-list">
      ${events.map((event)=>`<div><span><strong>${escape(foodEventLabels[event.kind]||event.kind)}</strong><small>${escape(event.notes)}</small></span><time>${escape(event.occurredAt.slice(0,10))}</time></div>`).join("") || '<p class="empty">暂无事件。</p>'}
    </div></section>`);
}

async function foodEditPage(db,row) {
  const locations=await foodAll(db,"SELECT * FROM StorageLocation WHERE retired=0 OR id=? ORDER BY builtIn DESC,rowid",row.locationId);
  return render(foodBack("编辑批次",escape(foodTitle(row)),link(foodHref(row),"取消","button secondary"))+
    foodModuleForm(intakeHidden("operation","edit")+intakeHidden("version",row.updatedAt)+
      '<p class="wide food-muted">修改到期日期会改用手填日期。选择新的保质期起点可按天数重新计算。</p>'+
      (row.disposition==="portioned"?'<p class="wide notice">已全部分装，编辑本批次仅修改资料，库存请在子批次中编辑。</p>':"")+
      foodBatchFields(row,locations,true),"保存批次"));
}

async function foodUpdateBatch(db,row,form,intake=null) {
  const r = (k)=>foodValue(form,k);
  const operation = r("operation") || "edit";
  const now = new Date(Math.max(Date.now(),(Date.parse(row.updatedAt)||0)+1)).toISOString();
  const day = todayFood();
  const back = foodActionPath(row);
  if (operation==="delete") {
    await deleteItem(db,row.id,"food");
    return foodRedirect(foodRoot+"?deleted=1");
  }
  if (operation!=="edit"&&!foodActive(row)) return foodError("该历史批次的库存已关闭。",back,409);
  const fields = {};
  const logged = [];
  let inspection = null;
  let movement = null;
  if (operation === "move") {
    const location = await foodOne(db,"SELECT * FROM StorageLocation WHERE id=? AND retired=0",r("locationId"));
    const transition = r("transition") || "move";
    if (!location || !["move","freeze","thaw"].includes(transition)) return foodError("请检查目的位置及状态。",back);
    fields.locationId = location.id;
    if (location.id !== row.locationId) logged.push(["move",`${row.locationName} → ${location.name}`]);
    if (transition !== "move") {
      logged.push([transition,location.name]);
      if (transition === "freeze") fields.frozenOn = day;
      if (transition === "thaw") fields.frozenOn = null;
    }
  } else if (operation === "open") {
    if (row.packaging !== "sealed") return foodError("该批次已经开封或分装。",back,409);
    fields.openedOn = day;
    fields.packaging = "opened";
    logged.push(["open",day]);
    if (r("locationId") && r("locationId")!==row.locationId) {
      const location = await foodOne(db,"SELECT id,name FROM StorageLocation WHERE id=? AND retired=0",r("locationId"));
      if (!location) return foodError("请确认储存位置。",back);
      fields.locationId=location.id;
      logged.push(["move",`${row.locationName} → ${location.name}`]);
    }
  } else if (operation === "consumeAll" || operation === "discard") {
    Object.assign(fields,{remainingAmount:0,amountNote:null,disposition:operation==="discard" ? "discarded" : "consumed"});
    logged.push([operation,foodAmount(row)]);
    movement={kind:operation==="discard"?"discard":"consume",amount:row.amountNote?null:row.remainingAmount};
  } else if (operation === "archive") {
    logged.push(["archive",null]);
  } else if (operation === "consume") {
    const amount = r("amount") ? Number(r("amount")) : intake ? NaN : 1;
    if (!Number.isFinite(amount)||amount<=0||row.remainingAmount==null||row.remainingAmount<amount||
      (r("unit")&&r("unit")!==row.stockUnit)) return foodError("请确认消耗数量和单位，数量不能超过库存。",back,409);
    const remaining = Number((row.remainingAmount-amount).toFixed(6));
    Object.assign(fields,{remainingAmount:remaining,amountNote:null,disposition:remaining===0 ? "consumed" : "active"});
    logged.push([remaining===0?"consumeAll":"consume",`${amount} ${row.stockUnit || ""}`]);
    movement={kind:"consume",amount};
  } else if (operation === "adjust") {
    const amount = r("amount")==="" ? null : Number(r("amount"));
    const unit = r("unit") || row.stockUnit || null;
    const note = r("amountNote");
    if ((amount == null && !note) || (amount != null && (!unit || !Number.isFinite(amount) || amount < 0 || amount > 1000000)) ||
        (unit?.length || 0)>20 || note.length>240) return foodError("请填写有效的数量、单位或模糊数量说明。",back);
    const consumed = amount===0 && !note;
    Object.assign(fields,{remainingAmount:amount,stockUnit:unit,amountNote:note||null,disposition:consumed?"consumed":"active"});
    logged.push([consumed?"consumeAll":"adjust",`${foodAmount(row)} → ${note || `${amount} ${unit}`}`]);
  } else if (operation === "check") {
    const date = r("checkedOn"), notes = r("inspectionNotes");
    if (!row.checkDays || !foodDate(date) || date>day || notes.length>500) return foodError("请填写一个有效且不晚于今天的检查日期。",back);
    inspection = {date,notes};
    logged.push(["check",`${date}${notes ? " · "+notes : ""}`]);
  } else if (operation === "edit") {
    const editPath=back+"/edit";
    if (r("version") && r("version")!==row.updatedAt) return foodError("批次已有新变化，请重新打开编辑页面。",editPath,409);
    const current={...row,unit:row.stockUnit,purchaseTime:row.purchasedAtLocal?.slice(11),timeZone:row.purchaseTimeZone};
    for (const key of ["batch","quantity","storage","packaging","purchasedOn","purchaseTime","timeZone","producedOn",
      "expiresOn","shelfLifeDays","shelfLifeBase","expiryMode","openedOn","frozenOn","purchasedAmount","purchasedUnit","remainingAmount",
      "unit","amountNote","disposition","expiryLead","checkDays","notes","locationId"]) {
      if (!form.has(key)) form.set(key,current[key]??"");
    }
    const expiryUnchanged=r("expiresOn")===(row.expiresOn||"");
    if (!expiryUnchanged && r("shelfLifeBase")===(row.shelfLifeBase||"")) form.set("shelfLifeBase","");
    const expirySource=expiryUnchanged ? row.expirySource||"label" : "stated";
    const changed=foodFields(form,row.specification,true,expirySource);
    const location=await foodOne(db,"SELECT id,name FROM StorageLocation WHERE id=? AND (retired=0 OR id=?)",
      r("locationId"),row.locationId);
    const disposition=r("disposition");
    if (!changed||!location||r("notes").length>2000||
      (!["active","consumed","discarded"].includes(disposition)&&!(disposition==="portioned"&&row.disposition==="portioned"))) {
      return foodError("请检查数量、日期、保质期天数和计算起点（生产日期或购买日期），以及储存位置。",editPath);
    }
    Object.assign(fields,changed,{locationId:location.id,disposition:disposition==="active"?changed.disposition:disposition});
    if (row.disposition==="portioned") {
      Object.assign(fields,{disposition:"portioned",stockUnit:row.stockUnit,remainingAmount:0,amountNote:null});
    }
    if (fields.disposition!=="active") Object.assign(fields,{remainingAmount:0,amountNote:null});
    if (fields.expiresOn&&!row.expiresOn&&fields.expiryLead==null) fields.expiryLead=3;
    const time=r("purchaseTime");
    if (time&&!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return foodError("请核对购买时间。",editPath);
    fields.purchasedAtLocal=fields.purchasedOn&&time?fields.purchasedOn+"T"+time:null;
    fields.purchaseTimeZone=fields.purchasedOn?intakeZone(r("timeZone")||row.purchaseTimeZone):null;
    const source=row.sourceJson?JSON.parse(row.sourceJson):{method:"manual",fields:{}};
    for (const [key,value] of Object.entries(fields)) {
      if (value!==row[key]) source.fields[key]="user";
    }
    if (fields.purchasedAtLocal!==row.purchasedAtLocal) source.fields.purchaseTime="user";
    fields.sourceJson=JSON.stringify(source);
    if (location.id !== row.locationId) logged.push(["move",`${row.locationName} → ${location.name}`]);
    if (fields.packaging !== row.packaging || fields.openedOn !== row.openedOn) logged.push([
      fields.packaging==="opened" ? "open" : "packaging",foodPackages[fields.packaging],
    ]);
    if (fields.frozenOn && fields.frozenOn!==row.frozenOn) logged.push(["freeze",fields.frozenOn]);
    if (fields.disposition!==row.disposition) logged.push([
      {active:"restore",consumed:"consumeAll",discarded:"discard"}[fields.disposition],foodAmount(row),
    ]);
    else if (["remainingAmount","stockUnit","amountNote"].some((key)=>fields[key]!==row[key])) {
      logged.push(["adjust",`${foodAmount(row)} → ${foodAmount(fields)}`]);
    }
    if (fields.expiresOn!==row.expiresOn) logged.push(["batchEdit",`到期日期：${row.expiresOn||"未填写"} → ${fields.expiresOn||"未填写"}`]);
  } else return foodError("未知操作。",back);
  const guard = "EXISTS(SELECT 1 FROM Item WHERE id=? AND updatedAt=? AND archivedAt IS ? AND deletedAt IS NULL)";
  const key = [row.id,row.updatedAt,row.archivedAt];
  const writes = logged.map(([kind,notes])=>foodRead(db,`INSERT INTO LifecycleEvent(id,itemId,kind,occurredAt,notes)
    SELECT ?,?,?,?,? WHERE ${guard}`,crypto.randomUUID(),row.id,kind,now,
    intake ? [notes,"来源："+intake.source].filter(Boolean).join(" · ") : notes,...key));
  if (intake) writes.unshift(intakeClaim(db,intake.draftId,intake.index,now,guard,key));
  if (movement) writes.push(foodMovement(db,row,movement.kind,movement.amount,row.stockUnit,now,guard,key));
  if (inspection) writes.push(foodRead(db,`INSERT INTO FoodInspection(id,itemId,checkedOn,notes)
    SELECT ?,?,?,? WHERE ${guard}`,crypto.randomUUID(),row.id,inspection.date,inspection.notes,...key));
  if (Object.keys(fields).length) writes.push(foodRead(db,`UPDATE FoodDetail
    SET ${Object.keys(fields).map((k)=>k+"=?").join(",")} WHERE itemId=? AND ${guard}`,...Object.values(fields),row.id,...key));
  writes.push(foodRead(db,`UPDATE Item SET updatedAt=?,notes=?,archivedAt=? WHERE id=? AND updatedAt=? AND archivedAt IS ? AND deletedAt IS NULL`,
    now,operation==="edit" ? r("notes") : row.notes,operation==="archive" ? now : row.archivedAt,...key));
  const result = (await db.batch(writes)).at(-1);
  if (!result.meta.changes) return foodError("批次已有新变化，请刷新后重试。",back,409);
  return foodRedirect(back+"?saved=1");
}

const foodPurchaseLead = /^我?\s*(?:(?:今天|昨天|前天)\s*)?(?:刚刚|刚才|刚|刚买回来|又)?\s*(?:购买了?|买了?|购入了?|添了)/;
const foodPurchaseVerb = /(?:购买(?:了)?|买了?|购入(?:了)?|添了|买回(?:来|家)?|带回(?:来|家)?|入手(?:了)?|下单(?:了)?|收到(?:了)?|领了)/;
const foodQuantityUnit = "千克|公斤|毫升|斤|克|升|个|颗|盒|袋|瓶|罐|桶|箱|包|片|把|只|条|块|根|支|听|提|串|杯|碗|份|张|双";
const foodQuantityCount = "[0-9]+(?:\\.[0-9]+)?|[零一二两三四五六七八九十]+|半";
const foodStopWords = /^(?:我|我们|今天|昨天|前天|刚才|刚刚|下午|上午|晚上|早上|下班|上班|周末|路过|去了?|在|从|把|这|那|又|还|就|也|才|正好|刚好|顺手|顺便|因为|所以|然后|接着|最后|看到|看见|发现|遇到|超市|商店|商场|菜市场|市场|网上|家里|另外|此外|还有|再)$/;
const foodItemSeparator = /[，,。；;、：:]|放在|放入|放到|冷藏|冷冻|储存|保质期|有效期|生产日期|到期|过期|吃完|喝完|用了|开封/;
function foodCleanItem(value) {
  let name = String(value ?? "").trim();
  name = name.split(foodItemSeparator)[0].trim();
  name = name.replace(/^[，,、。；;：:\s]+/,"");
  name = name.replace(/^(?:的|了|在|是|有|这|那)\s*/,"");
  name = name.replace(/\s*(?:已经?|正)?(?:在)?(?:打折|促销|特价|优惠|便宜|搞活动)\s*$/,"").trim();
  return name;
}
function foodNameFromPart(part) {
  const match = part.match(new RegExp(`(${foodQuantityCount})\\s*(${foodQuantityUnit})\\s*(.*)$`));
  if (match) {
    const amount = /^[0-9]/.test(match[1]) ? Number(match[1]) : numberOf(match[1]);
    let name = foodCleanItem(match[3]);
    if (!name) {
      const before = part.slice(0, match.index);
      const seen = before.match(/(?:看到|看见|发现|遇到|家里有|还剩|剩了|常买|常喝|常吃|用的是)\s*([^，,。；;、]{1,40}?)(?=在|打折|促销|特价|卖|就|，|,|$)/);
      if (seen) name = foodCleanItem(seen[1]);
    }
    if (!name) {
      const before = part.slice(0, match.index).split(/[，,。；;]/).filter(Boolean).at(-1) ?? "";
      name = foodCleanItem(before.replace(foodPurchaseVerb,"").replace(/^(?:就|又|还|也|才|顺手|顺便)\s*/,""));
    }
    return { name, amount:Number.isFinite(amount)?amount:"", unit:match[2] };
  }
  const verb = part.match(foodPurchaseVerb);
  if (verb) return { name:foodCleanItem(part.slice(verb.index + verb[0].length)), amount:"", unit:"" };
  // No quantity and no purchase verb: accept a short plain item name such as "牛奶保质期3天"
  // or a bare "酸奶", but never narrative fragments like "今天下午下班路过超市".
  const plain = foodCleanItem(part);
  if (plain && plain.length <= 24 && !/[买购放吃喝用查看剩]|超市|下班|上班|路过|今天|昨天|刚才|下午|晚上|打折|促销/.test(plain)) {
    return { name:plain, amount:"", unit:"" };
  }
  return null;
}
function foodTextCandidates(text, locations, today) {
  const offset = {今天:0, 昨天:-1, 前天:-2};
  const rows = [];
  const sentences = intakeCleanSpeech(text).split(/[\n；;。！!？?]+/).map((v)=>v.trim()).filter(Boolean);
  for (const sentence of sentences) {
    const where = [...locations].sort((a,b)=>b.name.length-a.name.length).find((loc)=>sentence.includes(loc.name));
    const relative = Object.keys(offset).find((word)=>sentence.includes(word));
    const purchase = relative ? foodAddDays(today,offset[relative]) : "";
    // 查询句要整句判断，否则会被下面的"还有"拆词切成"牛奶 / 多少"两个候选，
    // 两个候选又都按整句解析成同一个查询，核对待确认列表里就会出现两张重复卡片。
    if (/还有多少|查(?:看|询)|还剩多少/.test(sentence)) {
      rows.push({ name:sentence.replace(/^(查看|查询|冰箱里有)/,"").replace(/还有多少.*$|还剩多少.*$/,"").trim(),
        purchase, amount:"", unit:"", location:where?.id ?? "unassigned", source:sentence });
      continue;
    }
    const parts = sentence.split(/(?:另外|此外|还有|同时)/)
      .flatMap((part)=>part.split(new RegExp(`(?:和|跟|以及)(?=(?:${foodQuantityCount})\\s*(?:${foodQuantityUnit}))`)));
    for (const part of parts) {
      if (/还有多少|查(?:看|询)|还剩多少/.test(part)) {
        rows.push({ name:part.replace(/^(查看|查询|冰箱里有)/,"").trim(), purchase, amount:"", unit:"", location:where?.id ?? "unassigned", source:sentence });
        continue;
      }
      const item = foodNameFromPart(part.trim());
      if (!item) continue;
      const name = item.name.slice(0,120);
      if (!name || foodStopWords.test(name)) continue;
      if (/(?:超市|打折|促销|路过|下班|上班)/.test(name) && !foodPurchaseVerb.test(name)) continue;
      rows.push({ name, purchase, amount:item.amount, unit:item.unit, location:where?.id ?? "unassigned", source:sentence });
    }
  }
  return rows.slice(0,8);
}

async function foodRoute(request, env, url) {
  const db = env.DB;
  const [part,subpage,...rest] = url.pathname.slice(foodRoot.length).replace(/^\/|\/$/g,"").split("/");
  if (rest.length || (subpage && !["edit","portion"].includes(subpage))) return render(foodBack("找不到页面"),404);
  if (request.method==="POST" && request.headers.get("origin")!==url.origin) return new Response("请求来源无效",{status:403});
  const form = request.method==="POST" ? await request.formData() : null;
  if (!part) return form ? new Response(null,{status:405}) : foodHome(db,url);
  if (!subpage && part==="new") return foodNew(db,form,url);
  if (!subpage && part==="locations") return foodManageLocations(db,form);
  if (!subpage && part==="profiles") return foodManageProfiles(db,form,url);
  if (!subpage && part==="intake") return foodIntake(request,env,form);
  if (!subpage && part==="stats") return form?new Response(null,{status:405}):foodStatsPage(db,url);
  const row = await foodRow(db,part);
  if (!row) return render(foodBack("找不到批次"),404);
  if (subpage==="portion") return foodPortionPage(db,row,form);
  if (subpage==="edit") {
    if (!form) return foodEditPage(db,row);
    form.set("operation","edit");
  }
  return form ? foodUpdateBatch(db,row,form) : foodDetailPage(db,row,url);
}
